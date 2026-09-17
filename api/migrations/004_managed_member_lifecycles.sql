CREATE TABLE organization_managed_member_lifecycles (
  managed_member_lifecycle_id uuid DEFAULT gen_random_uuid() PRIMARY KEY NOT NULL,
  deployment_id smallint DEFAULT 1 NOT NULL,
  organization_version bigint NOT NULL,
  user_id uuid NOT NULL,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  ended_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT organization_managed_member_lifecycles_binding_key UNIQUE (
    managed_member_lifecycle_id, deployment_id, organization_version, user_id
  ),
  CONSTRAINT organization_managed_member_lifecycles_epoch_fkey
    FOREIGN KEY (deployment_id, organization_version)
    REFERENCES organization_epochs(deployment_id, organization_version) ON DELETE RESTRICT,
  CONSTRAINT organization_managed_member_lifecycles_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT organization_managed_member_lifecycles_interval_check
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE UNIQUE INDEX organization_managed_member_lifecycles_active_key
  ON organization_managed_member_lifecycles (deployment_id, organization_version, user_id)
  WHERE ended_at IS NULL;

ALTER TABLE platform_collection_state
  ADD COLUMN organization_deployment_id integer,
  ADD COLUMN organization_version bigint,
  ADD COLUMN target_user_id uuid,
  ADD COLUMN managed_member_lifecycle_id uuid,
  ADD COLUMN section_id text,
  ADD COLUMN disclosure_version integer,
  ADD COLUMN section_activation_version integer,
  ADD CONSTRAINT platform_collection_state_managed_member_lifecycle_fkey
    FOREIGN KEY (
      managed_member_lifecycle_id,
      organization_deployment_id,
      organization_version,
      target_user_id
    ) REFERENCES organization_managed_member_lifecycles (
      managed_member_lifecycle_id,
      deployment_id,
      organization_version,
      user_id
    ) ON DELETE CASCADE,
  ADD CONSTRAINT platform_collection_state_section_fkey
    FOREIGN KEY (module_id, section_id)
    REFERENCES deployment_module_sections(module_id, section_id) ON DELETE RESTRICT,
  ADD CONSTRAINT platform_collection_state_managed_authority_check CHECK (
    (
      organization_deployment_id IS NULL
      AND organization_version IS NULL
      AND target_user_id IS NULL
      AND managed_member_lifecycle_id IS NULL
      AND section_id IS NULL
      AND disclosure_version IS NULL
      AND section_activation_version IS NULL
    ) OR (
      organization_deployment_id IS NOT NULL
      AND organization_version IS NOT NULL
      AND target_user_id IS NOT NULL
      AND managed_member_lifecycle_id IS NOT NULL
      AND section_id IS NOT NULL
      AND disclosure_version > 0
      AND section_activation_version > 0
      AND authorization_generation IS NOT NULL
    )
  );

INSERT INTO organization_managed_member_lifecycles (
  deployment_id,
  organization_version,
  user_id,
  started_at,
  updated_at
)
SELECT
  settings.id,
  settings.organization_version,
  character.user_id,
  now(),
  now()
FROM deployment_settings settings
JOIN characters character
  ON character.affiliation_resolution_state = 'resolved'
  AND character.affiliation_checked_at IS NOT NULL
  AND character.next_affiliation_check > now()
JOIN organization_managed_corporations managed
  ON managed.deployment_id = settings.id
  AND managed.organization_version = settings.organization_version
  AND managed.corporation_id = character.corporation_id
  AND managed.is_current
WHERE settings.id = 1
  AND (
    settings.organization_type = 'corporation'
    OR EXISTS (
      SELECT 1
      FROM platform_subject_lifecycles organization_lifecycle
      JOIN platform_collection_state managed_state
        ON managed_state.module_id = 'core'
        AND managed_state.resource_id = 'managed-corporations'
        AND managed_state.subject_kind = 'alliance'
        AND managed_state.subject_lifecycle_id = organization_lifecycle.subject_lifecycle_id
        AND managed_state.subject_id = organization_lifecycle.subject_id
      WHERE organization_lifecycle.organization_deployment_id = settings.id
        AND organization_lifecycle.organization_version = settings.organization_version
        AND organization_lifecycle.subject_kind = 'alliance'
        AND organization_lifecycle.subject_id = settings.organization_id::text
        AND managed_state.validated_at IS NOT NULL
        AND managed_state.next_eligible_at > now()
        AND managed_state.last_failure_class IS NULL
    )
  )
GROUP BY settings.id, settings.organization_version, character.user_id;

DROP FUNCTION public.platform_classify_resources(
  jsonb,
  timestamp with time zone,
  text,
  text,
  text,
  uuid,
  text
);

CREATE FUNCTION public.platform_classify_resources(
  resources jsonb,
  effective_at timestamp with time zone,
  filter_module_id text DEFAULT NULL,
  filter_resource_id text DEFAULT NULL,
  filter_subject_kind text DEFAULT NULL,
  filter_subject_lifecycle_id uuid DEFAULT NULL,
  filter_subject_id text DEFAULT NULL
) RETURNS TABLE(
  module_id text,
  resource_id text,
  subject_kind text,
  subject_lifecycle_id uuid,
  subject_id text,
  operation_id text,
  eligibility_status text,
  expected_authorization_generation integer,
  authorization_character_id bigint,
  authorization_character_lifecycle_id uuid,
  required_scope text,
  organization_deployment_id integer,
  organization_version bigint,
  target_user_id uuid,
  managed_member_lifecycle_id uuid,
  authority_section_id text,
  disclosure_version integer,
  section_activation_version integer,
  due_reason text,
  scheduling_key timestamp with time zone,
  next_eligible_at timestamp with time zone,
  validated_at timestamp with time zone,
  last_failure_class text
)
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
      true as durable_authorization_valid,
      null::integer as organization_deployment_id,
      null::bigint as organization_version,
      null::uuid as target_user_id,
      null::uuid as managed_member_lifecycle_id,
      null::text as authority_section_id,
      null::integer as disclosure_version,
      null::integer as section_activation_version
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
      character.character_id,
      lifecycle.subject_lifecycle_id,
      token.token_version,
      token.scopes,
      acceptance.disclosure_version is not distinct from section.disclosure_version
        and acceptance.authorization_generation is not distinct from token.token_version,
      settings.id,
      settings.organization_version,
      member.user_id,
      member.managed_member_lifecycle_id,
      section.section_id,
      section.disclosure_version,
      section.activation_version
    from installed_resources resource
    join deployment_settings settings
      on settings.id = 1
    join organization_managed_member_lifecycles member
      on member.deployment_id = settings.id
      and member.organization_version = settings.organization_version
      and member.ended_at is null
    join characters character
      on character.user_id = member.user_id
    join platform_subject_lifecycles lifecycle
      on lifecycle.character_id = character.character_id
      and lifecycle.subject_kind = 'character'
    join deployment_module_sections section
      on section.module_id = resource.module_id
      and section.section_id = resource.section_id
      and section.kind = 'sensitive-evidence'
    left join eve_tokens token
      on token.character_id = character.character_id
    left join character_reviewer_disclosure_acceptances acceptance
      on acceptance.character_id = character.character_id
      and acceptance.module_id = resource.module_id
      and acceptance.section_id = resource.section_id
    where resource.subject_kind = 'character'
      and resource.eligibility_kind = 'current-managed-member-character'
      and (
        (
          character.affiliation_resolution_state = 'resolved'
          and character.affiliation_checked_at is not null
          and character.next_affiliation_check > effective_at
          and exists (
            select 1
            from organization_managed_corporations managed
            where managed.deployment_id = settings.id
              and managed.organization_version = settings.organization_version
              and managed.corporation_id = character.corporation_id
              and managed.is_current
          )
        ) or exists (
          select 1
          from organization_character_exceptions exception
          where exception.deployment_id = settings.id
            and exception.organization_version = settings.organization_version
            and exception.user_id = member.user_id
            and exception.character_id = character.character_id
            and exception.revoked_at is null
            and exception.expired_at is null
            and (exception.expires_at is null or exception.expires_at > effective_at)
        )
      )
      and exists (
        select 1
        from characters managed_character
        join organization_managed_corporations managed
          on managed.deployment_id = settings.id
          and managed.organization_version = settings.organization_version
          and managed.corporation_id = managed_character.corporation_id
          and managed.is_current
        where managed_character.user_id = member.user_id
          and managed_character.affiliation_resolution_state = 'resolved'
          and managed_character.affiliation_checked_at is not null
          and managed_character.next_affiliation_check > effective_at
      )
      and (
        settings.organization_type = 'corporation'
        or exists (
          select 1
          from platform_subject_lifecycles organization_lifecycle
          join platform_collection_state managed_state
            on managed_state.module_id = 'core'
            and managed_state.resource_id = 'managed-corporations'
            and managed_state.subject_kind = 'alliance'
            and managed_state.subject_lifecycle_id = organization_lifecycle.subject_lifecycle_id
            and managed_state.subject_id = organization_lifecycle.subject_id
          where settings.organization_type = 'alliance'
            and organization_lifecycle.organization_deployment_id = settings.id
            and organization_lifecycle.organization_version = settings.organization_version
            and organization_lifecycle.subject_kind = 'alliance'
            and organization_lifecycle.subject_id = settings.organization_id::text
            and managed_state.validated_at is not null
            and managed_state.next_eligible_at > effective_at
            and managed_state.last_failure_class is null
        )
      )

    union all

    select
      resource.*,
      lifecycle.subject_lifecycle_id,
      lifecycle.subject_id,
      null::bigint,
      null::uuid,
      null::integer,
      null::jsonb,
      true,
      null::integer,
      null::bigint,
      null::uuid,
      null::uuid,
      null::text,
      null::integer,
      null::integer
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
        and character_lifecycle.subject_lifecycle_id is not null,
      null::integer,
      null::bigint,
      null::uuid,
      null::uuid,
      null::text,
      null::integer,
      null::integer
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

    select
      resource.*,
      lifecycle.subject_lifecycle_id,
      lifecycle.subject_id,
      null::bigint,
      null::uuid,
      null::integer,
      null::jsonb,
      true,
      null::integer,
      null::bigint,
      null::uuid,
      null::uuid,
      null::text,
      null::integer,
      null::integer
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
      resource.organization_deployment_id,
      resource.organization_version,
      resource.target_user_id,
      resource.managed_member_lifecycle_id,
      resource.authority_section_id,
      resource.disclosure_version,
      resource.section_activation_version,
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
      and state.organization_deployment_id is not distinct from resource.organization_deployment_id
      and state.organization_version is not distinct from resource.organization_version
      and state.target_user_id is not distinct from resource.target_user_id
      and state.managed_member_lifecycle_id is not distinct from resource.managed_member_lifecycle_id
      and state.section_id is not distinct from resource.authority_section_id
      and state.disclosure_version is not distinct from resource.disclosure_version
      and state.section_activation_version is not distinct from resource.section_activation_version
      and (
        resource.managed_member_lifecycle_id is null
        or state.authorization_generation is not distinct from resource.token_version
      )
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
    classified.organization_deployment_id,
    classified.organization_version,
    classified.target_user_id,
    classified.managed_member_lifecycle_id,
    classified.authority_section_id,
    classified.disclosure_version,
    classified.section_activation_version,
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

REVOKE ALL ON FUNCTION public.platform_classify_resources(
  jsonb,
  timestamp with time zone,
  text,
  text,
  text,
  uuid,
  text
) FROM PUBLIC;
