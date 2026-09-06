alter table deployment_modules
  drop constraint deployment_modules_module_id_check,
  add constraint deployment_modules_module_id_check check (
    module_id = 'core'
    or (
      is_valid_module_id(module_id)
      and length(module_id) <= 44
      and module_id <> 'platform'
    )
  ),
  add constraint deployment_modules_core_enabled_check check (
    module_id <> 'core' or enabled
  );

insert into deployment_modules (module_id, enabled)
values ('core', true)
on conflict (module_id) do update set enabled = true, updated_at = now();

insert into organization_managed_corporations (
  deployment_id,
  organization_version,
  corporation_id,
  first_observed_at,
  last_observed_at
)
select id, organization_version, organization_id, updated_at, updated_at
from deployment_settings
where organization_type = 'corporation'
on conflict (deployment_id, organization_version, corporation_id) do nothing;

alter table platform_collection_state
  drop constraint platform_collection_state_module_id_check,
  add constraint platform_collection_state_module_id_check check (
    module_id = 'core'
    or (
      is_valid_module_id(module_id)
      and length(module_id) <= 44
      and module_id <> 'platform'
    )
  );

alter table platform_subject_lifecycles
  drop constraint platform_subject_lifecycles_subject_kind_subject_id_key,
  drop constraint platform_subject_lifecycles_character_binding_check,
  add column organization_deployment_id smallint,
  add column organization_version bigint,
  add column corporation_source_id uuid,
  add constraint platform_subject_lifecycles_organization_epoch_key
    unique (organization_deployment_id, organization_version),
  add constraint platform_subject_lifecycles_corporation_source_id_key
    unique (corporation_source_id),
  add constraint platform_subject_lifecycles_organization_epoch_fkey
    foreign key (organization_deployment_id, organization_version)
    references organization_epochs (deployment_id, organization_version)
    on delete restrict,
  add constraint platform_subject_lifecycles_corporation_source_id_fkey
    foreign key (corporation_source_id)
    references organization_corporation_sources (source_id)
    on delete restrict,
  add constraint platform_subject_lifecycles_binding_check check (
    (
      is_character_subject_kind(subject_kind)
      and character_id is not null
      and subject_id = character_id::text
      and organization_deployment_id is null
      and organization_version is null
      and corporation_source_id is null
    ) or (
      subject_kind = 'alliance'
      and character_id is null
      and organization_deployment_id is not null
      and organization_version is not null
      and corporation_source_id is null
    ) or (
      subject_kind = 'corporation'
      and character_id is null
      and organization_deployment_id is null
      and organization_version is null
      and corporation_source_id is not null
    ) or (
      subject_kind = 'deployment'
      and character_id is null
      and organization_deployment_id is null
      and organization_version is null
      and corporation_source_id is null
    )
  );

insert into platform_subject_lifecycles (
  subject_kind,
  subject_id,
  organization_deployment_id,
  organization_version,
  created_at
)
select
  'alliance',
  organization_id::text,
  deployment_id,
  organization_version,
  created_at
from organization_epochs
where organization_type = 'alliance'
on conflict (organization_deployment_id, organization_version) do nothing;

insert into platform_subject_lifecycles (
  subject_kind,
  subject_id,
  corporation_source_id,
  created_at
)
select
  'corporation',
  corporation_id::text,
  source_id,
  registered_at
from organization_corporation_sources
on conflict (corporation_source_id) do nothing;

drop function platform_classify_resources(jsonb, timestamptz, text, text, text, uuid, text);

create function platform_classify_resources(
  resources jsonb,
  effective_at timestamptz,
  filter_module_id text default null,
  filter_resource_id text default null,
  filter_subject_kind text default null,
  filter_subject_lifecycle_id uuid default null,
  filter_subject_id text default null
)
returns table (
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
  due_reason text,
  scheduling_key timestamptz,
  next_eligible_at timestamptz,
  validated_at timestamptz,
  last_failure_class text
)
language sql
stable
as $$
  with installed_resources as (
    select
      resource.module_id,
      resource.resource_id,
      resource.subject_kind,
      resource.operation_id,
      resource.required_scope,
      resource.eligibility_kind
    from jsonb_to_recordset(resources) as resource (
      module_id text,
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
