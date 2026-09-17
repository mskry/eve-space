CREATE TABLE deployment_module_sections (
  module_id text NOT NULL,
  section_id text NOT NULL,
  kind text NOT NULL,
  enabled boolean DEFAULT false NOT NULL,
  declaration_revision integer,
  disclosure_version integer DEFAULT 0 NOT NULL,
  activation_version integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT deployment_module_sections_pkey PRIMARY KEY (module_id, section_id),
  CONSTRAINT deployment_module_sections_module_id_fkey FOREIGN KEY (module_id)
    REFERENCES deployment_modules(module_id) ON DELETE CASCADE,
  CONSTRAINT deployment_module_sections_module_id_check
    CHECK (is_valid_module_id(module_id) AND module_id <> 'core'),
  CONSTRAINT deployment_module_sections_section_id_check
    CHECK (is_valid_platform_identifier(section_id)),
  CONSTRAINT deployment_module_sections_kind_check
    CHECK (kind IN ('workspace', 'sensitive-evidence', 'access-management')),
  CONSTRAINT deployment_module_sections_versions_check
    CHECK (disclosure_version >= 0 AND activation_version >= 0),
  CONSTRAINT deployment_module_sections_disclosure_check CHECK (
    (kind = 'sensitive-evidence' AND declaration_revision IS NOT NULL AND declaration_revision > 0)
    OR
    (kind <> 'sensitive-evidence' AND declaration_revision IS NULL AND disclosure_version = 0)
  )
);

CREATE OR REPLACE FUNCTION public.platform_classify_resources(resources jsonb, effective_at timestamp with time zone, filter_module_id text DEFAULT NULL::text, filter_resource_id text DEFAULT NULL::text, filter_subject_kind text DEFAULT NULL::text, filter_subject_lifecycle_id uuid DEFAULT NULL::uuid, filter_subject_id text DEFAULT NULL::text) RETURNS TABLE(module_id text, resource_id text, subject_kind text, subject_lifecycle_id uuid, subject_id text, operation_id text, eligibility_status text, expected_authorization_generation integer, authorization_character_id bigint, authorization_character_lifecycle_id uuid, required_scope text, due_reason text, scheduling_key timestamp with time zone, next_eligible_at timestamp with time zone, validated_at timestamp with time zone, last_failure_class text)
    LANGUAGE sql STABLE
    AS $$
  with installed_resources as (
    select
      resource.module_id,
      resource.section_id,
      resource.resource_id,
      resource.subject_kind,
      resource.operation_id,
      resource.required_scope,
      resource.eligibility_kind
    from jsonb_to_recordset(resources) as resource (
      module_id text,
      section_id text,
      resource_id text,
      subject_kind text,
      operation_id text,
      required_scope text,
      eligibility_kind text
    )
  ), subject_resources as (
    select
      resource.*,
      lifecycle.subject_lifecycle_id,
      lifecycle.subject_id,
      character.character_id as authorization_character_id,
      lifecycle.subject_lifecycle_id as authorization_character_lifecycle_id,
      token.token_version,
      token.scopes,
      true as durable_authorization_valid
    from installed_resources resource
    join platform_subject_lifecycles lifecycle
      on lifecycle.subject_kind = 'character'
    join characters character
      on character.character_id = lifecycle.character_id
    left join eve_tokens token
      on token.character_id = character.character_id
    where resource.subject_kind = 'character'
      and resource.eligibility_kind = 'current-owned-character'

    union all

    select
      resource.*,
      lifecycle.subject_lifecycle_id,
      lifecycle.subject_id,
      null::bigint,
      null::uuid,
      null::integer,
      null::jsonb,
      true
    from installed_resources resource
    join deployment_settings settings
      on settings.id = 1
      and settings.organization_type = 'alliance'
    join organization_epochs epoch
      on epoch.deployment_id = settings.id
      and epoch.organization_version = settings.organization_version
      and epoch.organization_type = 'alliance'
      and epoch.organization_id = settings.organization_id
    join platform_subject_lifecycles lifecycle
      on lifecycle.organization_deployment_id = epoch.deployment_id
      and lifecycle.organization_version = epoch.organization_version
      and lifecycle.subject_kind = 'alliance'
      and lifecycle.subject_id = epoch.organization_id::text
    where resource.subject_kind = 'alliance'
      and resource.eligibility_kind = 'current-managed-alliance'

    union all

    select
      resource.*,
      lifecycle.subject_lifecycle_id,
      lifecycle.subject_id,
      source.character_id,
      character_lifecycle.subject_lifecycle_id,
      token.token_version,
      token.scopes,
      character.user_id is not null
        and character.corporation_id = source.corporation_id
        and character.affiliation_resolution_state = 'resolved'
        and character.affiliation_checked_at is not null
        and character.next_affiliation_check > effective_at
        and character_lifecycle.subject_lifecycle_id is not null
    from installed_resources resource
    join deployment_settings settings
      on settings.id = 1
    join organization_managed_corporations corporation
      on corporation.deployment_id = settings.id
      and corporation.organization_version = settings.organization_version
      and corporation.is_current
    join organization_corporation_sources source
      on source.deployment_id = corporation.deployment_id
      and source.organization_version = corporation.organization_version
      and source.corporation_id = corporation.corporation_id
      and source.revoked_at is null
    join platform_subject_lifecycles lifecycle
      on lifecycle.corporation_source_id = source.source_id
      and lifecycle.subject_kind = 'corporation'
      and lifecycle.subject_id = source.corporation_id::text
    left join characters character
      on character.character_id = source.character_id
    left join platform_subject_lifecycles character_lifecycle
      on character_lifecycle.character_id = source.character_id
      and is_character_subject_kind(character_lifecycle.subject_kind)
    left join eve_tokens token
      on token.character_id = source.character_id
    where resource.subject_kind = 'corporation'
      and resource.eligibility_kind = 'current-managed-corporation-source'

    union all

    select resource.*, lifecycle.subject_lifecycle_id, lifecycle.subject_id,
      null::bigint, null::uuid, null::integer, null::jsonb, true
    from installed_resources resource
    join deployment_settings settings on settings.id = 1
    join platform_subject_lifecycles lifecycle
      on lifecycle.subject_kind = 'deployment'
      and lifecycle.subject_id = settings.id::text
      and lifecycle.organization_deployment_id = settings.id
      and lifecycle.organization_version = settings.organization_version
    where resource.subject_kind = 'deployment'
      and resource.eligibility_kind = 'current-deployment'
      and resource.required_scope is null
  ), classified as (
    select
      resource.module_id,
      resource.resource_id,
      resource.subject_kind,
      resource.subject_lifecycle_id,
      resource.subject_id,
      resource.operation_id,
      case
        when module_setting.enabled is distinct from true then 'disabled'
        when resource.section_id is not null
          and section_setting.enabled is distinct from true then 'disabled'
        when not resource.durable_authorization_valid then 'authorization-required'
        when resource.required_scope is not null and (
          resource.token_version is null
          or not resource.scopes @> jsonb_build_array(resource.required_scope)
        ) then 'authorization-required'
        when state.last_failure_class = 'authorization-required'
          and state.authorization_generation is not distinct from resource.token_version
          then 'authorization-required'
        when state.last_failure_class in (
          'response-invalid',
          'mapping-failed',
          'persistence-failed',
          'unknown'
        ) and state.authorization_generation is not distinct from (
          case when resource.required_scope is null then null else resource.token_version end
        ) then 'suppressed'
        else 'eligible'
      end as eligibility_status,
      case when resource.required_scope is null then null else resource.token_version end
        as expected_authorization_generation,
      resource.authorization_character_id,
      resource.authorization_character_lifecycle_id,
      resource.required_scope,
      state.module_id is null as state_missing,
      state.authorization_generation,
      state.next_eligible_at,
      state.validated_at,
      state.last_failure_class
    from subject_resources resource
    left join deployment_modules module_setting
      on module_setting.module_id = resource.module_id
    left join deployment_module_sections section_setting
      on section_setting.module_id = resource.module_id
      and section_setting.section_id = resource.section_id
    left join platform_collection_state state
      on state.module_id = resource.module_id
      and state.resource_id = resource.resource_id
      and state.subject_kind = resource.subject_kind
      and state.subject_lifecycle_id = resource.subject_lifecycle_id
      and state.subject_id = resource.subject_id
    where (filter_module_id is null or resource.module_id = filter_module_id)
      and (filter_resource_id is null or resource.resource_id = filter_resource_id)
      and (filter_subject_kind is null or resource.subject_kind = filter_subject_kind)
      and (
        filter_subject_lifecycle_id is null
        or resource.subject_lifecycle_id = filter_subject_lifecycle_id
      )
      and (filter_subject_id is null or resource.subject_id = filter_subject_id)
  )
  select
    classified.module_id,
    classified.resource_id,
    classified.subject_kind,
    classified.subject_lifecycle_id,
    classified.subject_id,
    classified.operation_id,
    classified.eligibility_status,
    classified.expected_authorization_generation,
    classified.authorization_character_id,
    classified.authorization_character_lifecycle_id,
    classified.required_scope,
    case
      when classified.eligibility_status <> 'eligible' then null
      when classified.state_missing then 'never-collected'
      when classified.authorization_generation is distinct from
        classified.expected_authorization_generation then 'authorization-changed'
      when classified.next_eligible_at is null then 'unscheduled'
      when classified.next_eligible_at <= effective_at then 'elapsed'
      else 'future'
    end as due_reason,
    case
      when classified.eligibility_status <> 'eligible' then null
      when classified.state_missing
        or classified.authorization_generation is distinct from
          classified.expected_authorization_generation
        or classified.next_eligible_at is null then 'epoch'::timestamptz
      else classified.next_eligible_at
    end as scheduling_key,
    classified.next_eligible_at,
    classified.validated_at,
    classified.last_failure_class
  from classified;
$$;
