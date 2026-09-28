create table current_observation_snapshots (
  resource_id text not null,
  organization_version bigint not null,
  target_user_id uuid not null,
  managed_member_lifecycle_id uuid not null,
  character_id bigint not null,
  character_lifecycle_id uuid not null,
  authorization_generation integer not null,
  disclosure_version integer not null,
  section_activation_version integer not null,
  dto_revision integer not null,
  observation_id uuid not null,
  snapshot jsonb not null,
  validated_at timestamptz not null,
  cached_until timestamptz not null,
  primary key (resource_id, character_id),
  constraint current_observation_resource_check check (resource_id in ('current-ship', 'current-location')),
  constraint current_observation_authority_check check (
    organization_version > 0 and character_id > 0 and authorization_generation >= 0
    and disclosure_version > 0 and section_activation_version > 0 and dto_revision = 1
  ),
  constraint current_observation_snapshot_check check (jsonb_typeof(snapshot) = 'object'),
  constraint current_observation_expiry_check check (cached_until >= validated_at)
);

create index current_observation_retention_idx on current_observation_snapshots (validated_at);

create function eve_module_member_audit.persist_write_current_observation(input jsonb)
returns jsonb
language sql volatile parallel unsafe
begin atomic
  with persisted as (
    insert into current_observation_snapshots (
      resource_id, organization_version, target_user_id, managed_member_lifecycle_id,
      character_id, character_lifecycle_id, authorization_generation, disclosure_version,
      section_activation_version, dto_revision, observation_id, snapshot, validated_at, cached_until
    ) values (
      input ->> 'resourceId'::text, (input ->> 'organizationVersion'::text)::bigint,
      (input ->> 'targetUserId'::text)::uuid, (input ->> 'managedMemberLifecycleId'::text)::uuid,
      (input ->> 'characterId'::text)::bigint, (input ->> 'characterLifecycleId'::text)::uuid,
      (input ->> 'authorizationGeneration'::text)::integer, (input ->> 'disclosureVersion'::text)::integer,
      (input ->> 'sectionActivationVersion'::text)::integer, (input ->> 'dtoRevision'::text)::integer,
      (input ->> 'observationId'::text)::uuid, input -> 'snapshot'::text,
      (input ->> 'validatedAt'::text)::timestamptz, (input ->> 'cachedUntil'::text)::timestamptz
    )
    on conflict (resource_id, character_id) do update set
      organization_version = excluded.organization_version,
      target_user_id = excluded.target_user_id,
      managed_member_lifecycle_id = excluded.managed_member_lifecycle_id,
      character_lifecycle_id = excluded.character_lifecycle_id,
      authorization_generation = excluded.authorization_generation,
      disclosure_version = excluded.disclosure_version,
      section_activation_version = excluded.section_activation_version,
      dto_revision = excluded.dto_revision,
      observation_id = excluded.observation_id,
      snapshot = excluded.snapshot,
      validated_at = excluded.validated_at,
      cached_until = excluded.cached_until
    where current_observation_snapshots.validated_at <= excluded.validated_at
    returning 1
  )
  select jsonb_build_object('outcome'::text, case when exists (select from persisted) then 'applied'::text else 'obsolete'::text end) as result;
end;

create function eve_module_member_audit.persist_purge_current_observation(input jsonb)
returns jsonb
language sql volatile parallel unsafe
begin atomic
  with removed as (
    delete from current_observation_snapshots snapshot
    where snapshot.ctid in (
      select candidate.ctid from current_observation_snapshots candidate
      where candidate.resource_id = input ->> 'store'::text
        and (
          (
            input ->> 'mode'::text = 'retention'::text
            and (
              candidate.cached_until <= (input ->> 'cutoff'::text)::timestamptz
              or candidate.validated_at + interval '24:00:00' <= (input ->> 'cutoff'::text)::timestamptz
            )
          ) or (
            input ->> 'mode'::text = 'authority'::text
            and candidate.organization_version = (input ->> 'organizationVersion'::text)::bigint
            and candidate.target_user_id = (input ->> 'targetUserId'::text)::uuid
            and candidate.managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
            and candidate.character_id = (input ->> 'characterId'::text)::bigint
            and candidate.character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
            and candidate.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
            and candidate.disclosure_version = (input ->> 'disclosureVersion'::text)::integer
            and candidate.section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
          ) or (
            input ->> 'mode'::text = 'account'::text
            and candidate.target_user_id = (input ->> 'targetUserId'::text)::uuid
          ) or (
            input ->> 'mode'::text = 'organization'::text
            and candidate.organization_version = (input ->> 'organizationVersion'::text)::bigint
          )
        )
      order by candidate.character_id
      limit (input ->> 'limit'::text)::integer
    )
    returning 1
  )
  select jsonb_build_object(
    'deleted'::text, count(*)::integer,
    'remaining'::text, count(*) = (input ->> 'limit'::text)::integer
  ) as result from removed;
end;

create function eve_module_member_audit.persist_read_current_observation(input jsonb)
returns jsonb
language sql stable parallel unsafe
begin atomic
  select jsonb_build_object(
    'currentShip'::text, (
      select jsonb_build_object(
        'dtoRevision'::text, snapshot.dto_revision,
        'observationId'::text, snapshot.observation_id,
        'snapshot'::text, snapshot.snapshot,
        'validatedAt'::text, snapshot.validated_at,
        'cachedUntil'::text, snapshot.cached_until
      ) from current_observation_snapshots snapshot
      where snapshot.resource_id = 'current-ship'::text
        and snapshot.character_id = (input ->> 'characterId'::text)::bigint
        and snapshot.organization_version = (input ->> 'organizationVersion'::text)::bigint
        and snapshot.target_user_id = (input ->> 'targetUserId'::text)::uuid
        and snapshot.managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
        and snapshot.character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
        and snapshot.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
        and snapshot.disclosure_version = (input ->> 'disclosureVersion'::text)::integer
        and snapshot.section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
        and snapshot.cached_until > now()
        and snapshot.validated_at + interval '24:00:00' > now()
    ),
    'currentLocation'::text, (
      select jsonb_build_object(
        'dtoRevision'::text, snapshot.dto_revision,
        'observationId'::text, snapshot.observation_id,
        'snapshot'::text, snapshot.snapshot,
        'validatedAt'::text, snapshot.validated_at,
        'cachedUntil'::text, snapshot.cached_until
      ) from current_observation_snapshots snapshot
      where snapshot.resource_id = 'current-location'::text
        and snapshot.character_id = (input ->> 'characterId'::text)::bigint
        and snapshot.organization_version = (input ->> 'organizationVersion'::text)::bigint
        and snapshot.target_user_id = (input ->> 'targetUserId'::text)::uuid
        and snapshot.managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
        and snapshot.character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
        and snapshot.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
        and snapshot.disclosure_version = (input ->> 'disclosureVersion'::text)::integer
        and snapshot.section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
        and snapshot.cached_until > now()
        and snapshot.validated_at + interval '24:00:00' > now()
    )
  ) as result;
end;
