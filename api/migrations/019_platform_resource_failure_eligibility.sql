create or replace function platform_classify_resources(
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
    select resource.module_id, resource.resource_id, resource.subject_kind,
      resource.operation_id, resource.required_scope
    from jsonb_to_recordset(resources) as resource (
      module_id text,
      resource_id text,
      subject_kind text,
      operation_id text,
      required_scope text
    )
  ), classified as (
    select
      resource.module_id,
      resource.resource_id,
      resource.subject_kind,
      lifecycle.subject_lifecycle_id,
      lifecycle.subject_id,
      resource.operation_id,
      case
        when module_setting.enabled is distinct from true then 'disabled'
        when resource.required_scope is not null and (
          token.character_id is null
          or not token.scopes @> jsonb_build_array(resource.required_scope)
        ) then 'authorization-required'
        when state.last_failure_class in (
          'response-invalid',
          'mapping-failed',
          'persistence-failed',
          'unknown'
        ) and state.authorization_generation is not distinct from (
          case when resource.required_scope is null then null else token.token_version end
        ) then 'suppressed'
        else 'eligible'
      end as eligibility_status,
      case when resource.required_scope is null then null else token.token_version end
        as expected_authorization_generation,
      resource.required_scope,
      state.module_id is null as state_missing,
      state.authorization_generation,
      state.next_eligible_at,
      state.validated_at,
      state.last_failure_class
    from installed_resources resource
    join platform_subject_lifecycles lifecycle
      on lifecycle.subject_kind = resource.subject_kind
    join characters character
      on character.character_id = lifecycle.character_id
    left join deployment_modules module_setting
      on module_setting.module_id = resource.module_id
    left join eve_tokens token
      on token.character_id = character.character_id
    left join platform_collection_state state
      on state.module_id = resource.module_id
      and state.resource_id = resource.resource_id
      and state.subject_kind = resource.subject_kind
      and state.subject_lifecycle_id = lifecycle.subject_lifecycle_id
      and state.subject_id = lifecycle.subject_id
    where (filter_module_id is null or resource.module_id = filter_module_id)
      and (filter_resource_id is null or resource.resource_id = filter_resource_id)
      and (filter_subject_kind is null or resource.subject_kind = filter_subject_kind)
      and (
        filter_subject_lifecycle_id is null
        or lifecycle.subject_lifecycle_id = filter_subject_lifecycle_id
      )
      and (filter_subject_id is null or lifecycle.subject_id = filter_subject_id)
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
