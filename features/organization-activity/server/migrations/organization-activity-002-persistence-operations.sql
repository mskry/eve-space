alter table collection_checkpoints add column materialization_id uuid;

create function eve_module_organization_activity.persist_read_activity_checkpoint(input jsonb)
returns jsonb
language sql
stable
parallel unsafe
return (
  select jsonb_build_object(
    'checkpoint'::text,
    collection_checkpoints.checkpoint,
    'revision'::text,
    collection_checkpoints.revision::integer
  )
  from collection_checkpoints
  where collection_checkpoints.resource_id = (input ->> 'resourceId'::text)
    and collection_checkpoints.subject_lifecycle_id = (input ->> 'subjectLifecycleId'::text)::uuid
    and collection_checkpoints.organization_version = (input ->> 'organizationVersion'::text)::bigint
    and collection_checkpoints.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
);

create function eve_module_organization_activity.persist_read_activity_snapshots(input jsonb)
returns jsonb
language sql
stable
parallel unsafe
return (
  select coalesce(
    jsonb_agg(
      bounded_snapshots.snapshot
      order by bounded_snapshots.exact_match desc, bounded_snapshots.activity_id
    ),
    '[]'::jsonb
  )
  from (
    select
      activity_snapshots.activity_id,
      activity_snapshots.snapshot,
      activity_snapshots.activity_id::text = (input ->> 'activityId'::text) as exact_match
    from activity_snapshots
    where activity_snapshots.resource_id = (input ->> 'resourceId'::text)
      and activity_snapshots.subject_lifecycle_id = (input ->> 'subjectLifecycleId'::text)::uuid
      and activity_snapshots.organization_version = (input ->> 'organizationVersion'::text)::bigint
      and activity_snapshots.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
      and activity_snapshots.validated_at >= now() - '01:00:00'::interval
      and (
        (input ->> 'activityId'::text) is null
        or activity_snapshots.activity_id::text = (input ->> 'activityId'::text)
        or activity_snapshots.snapshot ->> 'campaignId'::text = (input ->> 'activityId'::text)
      )
    order by
      (activity_snapshots.activity_id::text = (input ->> 'activityId'::text)) desc,
      activity_snapshots.activity_id
    limit 100
  ) as bounded_snapshots
);

create function eve_module_organization_activity.persist_materialize_activity_observation(input jsonb)
returns jsonb
language sql
volatile
parallel unsafe
begin atomic
  insert into collection_checkpoints (
    resource_id,
    subject_lifecycle_id,
    organization_version,
    authorization_generation,
    checkpoint,
    revision,
    materialization_id
  )
  select
    input ->> 'resourceId'::text,
    (input ->> 'subjectLifecycleId'::text)::uuid,
    (input ->> 'organizationVersion'::text)::bigint,
    (input ->> 'authorizationGeneration'::text)::integer,
    input -> 'checkpoint'::text,
    (input ->> 'expectedRevision'::text)::bigint + 1,
    (input ->> 'materializationId'::text)::uuid
  where (input ->> 'expectedRevision'::text)::bigint = 0
    or exists (
      select 1
      from collection_checkpoints as existing_checkpoint
      where existing_checkpoint.resource_id = (input ->> 'resourceId'::text)
        and existing_checkpoint.subject_lifecycle_id = (input ->> 'subjectLifecycleId'::text)::uuid
        and existing_checkpoint.organization_version = (input ->> 'organizationVersion'::text)::bigint
        and existing_checkpoint.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
      for update of existing_checkpoint
    )
  on conflict (
    resource_id,
    subject_lifecycle_id,
    organization_version,
    authorization_generation
  ) do update
  set checkpoint = excluded.checkpoint,
      revision = excluded.revision,
      materialization_id = excluded.materialization_id
  where collection_checkpoints.revision = (input ->> 'expectedRevision'::text)::bigint;

  with parsed_snapshots as (
    select
      snapshot_entry.ordinality,
      snapshot_entry.value -> 'snapshot'::text as snapshot,
      (snapshot_entry.value -> 'snapshot'::text ->> 'id'::text)::uuid as activity_id,
      (snapshot_entry.value ->> 'validatedAt'::text)::timestamptz as validated_at,
      (snapshot_entry.value ->> 'replace'::text)::boolean as replace
    from jsonb_array_elements(input -> 'snapshots'::text)
      with ordinality as snapshot_entry(value, ordinality)
  ),
  first_snapshots as (
    select distinct on (parsed_snapshots.activity_id)
      parsed_snapshots.activity_id,
      parsed_snapshots.snapshot,
      parsed_snapshots.validated_at
    from parsed_snapshots
    order by parsed_snapshots.activity_id, parsed_snapshots.ordinality
  ),
  baseline_snapshots as (
    select
      first_snapshots.activity_id,
      first_snapshots.snapshot,
      first_snapshots.validated_at,
      stored_snapshots.snapshot as stored_snapshot,
      stored_snapshots.validated_at as stored_validated_at,
      stored_snapshots.activity_id is not null as stored
    from first_snapshots
    left join activity_snapshots as stored_snapshots
      on stored_snapshots.resource_id = (input ->> 'resourceId'::text)
      and stored_snapshots.subject_lifecycle_id = (input ->> 'subjectLifecycleId'::text)::uuid
      and stored_snapshots.organization_version = (input ->> 'organizationVersion'::text)::bigint
      and stored_snapshots.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
      and stored_snapshots.activity_id = first_snapshots.activity_id
  ),
  replacement_snapshots as (
    select distinct on (parsed_snapshots.activity_id)
      parsed_snapshots.activity_id,
      parsed_snapshots.snapshot,
      parsed_snapshots.validated_at
    from parsed_snapshots
    join baseline_snapshots
      on baseline_snapshots.activity_id = parsed_snapshots.activity_id
    where parsed_snapshots.replace
      and parsed_snapshots.validated_at >= coalesce(
        baseline_snapshots.stored_validated_at,
        baseline_snapshots.validated_at
      )
    order by
      parsed_snapshots.activity_id,
      parsed_snapshots.validated_at desc,
      parsed_snapshots.ordinality desc
  ),
  final_snapshots as (
    select
      baseline_snapshots.activity_id,
      case
        when replacement_snapshots.activity_id is not null then replacement_snapshots.snapshot
        when baseline_snapshots.stored then baseline_snapshots.stored_snapshot
        else baseline_snapshots.snapshot
      end as snapshot,
      case
        when replacement_snapshots.activity_id is not null then replacement_snapshots.validated_at
        when baseline_snapshots.stored then baseline_snapshots.stored_validated_at
        else baseline_snapshots.validated_at
      end as validated_at,
      not baseline_snapshots.stored
        or replacement_snapshots.activity_id is not null as write_required
    from baseline_snapshots
    left join replacement_snapshots
      on replacement_snapshots.activity_id = baseline_snapshots.activity_id
  )
  insert into activity_snapshots (
    resource_id,
    subject_lifecycle_id,
    organization_version,
    authorization_generation,
    activity_id,
    snapshot,
    validated_at
  )
  select
    input ->> 'resourceId'::text,
    (input ->> 'subjectLifecycleId'::text)::uuid,
    (input ->> 'organizationVersion'::text)::bigint,
    (input ->> 'authorizationGeneration'::text)::integer,
    final_snapshots.activity_id,
    final_snapshots.snapshot,
    final_snapshots.validated_at
  from final_snapshots
  where final_snapshots.write_required
    and exists (
      select 1
      from collection_checkpoints as applied_checkpoint
      where applied_checkpoint.resource_id = (input ->> 'resourceId'::text)
        and applied_checkpoint.subject_lifecycle_id = (input ->> 'subjectLifecycleId'::text)::uuid
        and applied_checkpoint.organization_version = (input ->> 'organizationVersion'::text)::bigint
        and applied_checkpoint.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
        and applied_checkpoint.materialization_id = (input ->> 'materializationId'::text)::uuid
        and applied_checkpoint.revision = (input ->> 'expectedRevision'::text)::bigint + 1
    )
  on conflict (
    resource_id,
    subject_lifecycle_id,
    organization_version,
    authorization_generation,
    activity_id
  ) do update
  set snapshot = excluded.snapshot,
      validated_at = excluded.validated_at
  where activity_snapshots.validated_at <= excluded.validated_at;

  delete from activity_snapshots
  where activity_snapshots.resource_id = (input ->> 'resourceId'::text)
    and activity_snapshots.subject_lifecycle_id = (input ->> 'subjectLifecycleId'::text)::uuid
    and activity_snapshots.organization_version = (input ->> 'organizationVersion'::text)::bigint
    and activity_snapshots.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
    and jsonb_array_length(input -> 'checkpoint'::text -> 'requests'::text) = 0
    and input -> 'checkpoint'::text ? 'retainedIds'::text
    and not (
      coalesce(input -> 'checkpoint'::text -> 'retainedIds'::text, '[]'::jsonb)
        ? activity_snapshots.activity_id::text
      or coalesce(
        input -> 'checkpoint'::text -> 'retainedCampaignIds'::text,
        '[]'::jsonb
      ) ? coalesce(activity_snapshots.snapshot ->> 'campaignId'::text, ''::text)
    )
    and exists (
      select 1
      from collection_checkpoints as applied_checkpoint
      where applied_checkpoint.resource_id = (input ->> 'resourceId'::text)
        and applied_checkpoint.subject_lifecycle_id = (input ->> 'subjectLifecycleId'::text)::uuid
        and applied_checkpoint.organization_version = (input ->> 'organizationVersion'::text)::bigint
        and applied_checkpoint.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
        and applied_checkpoint.materialization_id = (input ->> 'materializationId'::text)::uuid
        and applied_checkpoint.revision = (input ->> 'expectedRevision'::text)::bigint + 1
    );

  delete from activity_snapshots
  where activity_snapshots.validated_at < now() - '24:00:00'::interval
    and exists (
      select 1
      from collection_checkpoints as applied_checkpoint
      where applied_checkpoint.resource_id = (input ->> 'resourceId'::text)
        and applied_checkpoint.subject_lifecycle_id = (input ->> 'subjectLifecycleId'::text)::uuid
        and applied_checkpoint.organization_version = (input ->> 'organizationVersion'::text)::bigint
        and applied_checkpoint.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
        and applied_checkpoint.materialization_id = (input ->> 'materializationId'::text)::uuid
        and applied_checkpoint.revision = (input ->> 'expectedRevision'::text)::bigint + 1
    );

  select case
    when exists (
      select 1
      from collection_checkpoints as applied_checkpoint
      where applied_checkpoint.resource_id = (input ->> 'resourceId'::text)
        and applied_checkpoint.subject_lifecycle_id = (input ->> 'subjectLifecycleId'::text)::uuid
        and applied_checkpoint.organization_version = (input ->> 'organizationVersion'::text)::bigint
        and applied_checkpoint.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
        and applied_checkpoint.materialization_id = (input ->> 'materializationId'::text)::uuid
        and applied_checkpoint.revision = (input ->> 'expectedRevision'::text)::bigint + 1
    ) then jsonb_build_object(
      'outcome'::text,
      'applied'::text,
      'revision'::text,
      (input ->> 'expectedRevision'::text)::bigint + 1
    )
    else jsonb_build_object('outcome'::text, 'obsolete'::text)
  end as result;
end;
