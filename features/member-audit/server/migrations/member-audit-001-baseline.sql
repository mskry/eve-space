create table skill_snapshots (
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
  snapshot jsonb not null,
  validated_at timestamptz not null,
  primary key (resource_id, character_id),
  constraint skill_snapshots_resource_check check (resource_id in ('trained-skills', 'skill-queue')),
  constraint skill_snapshots_version_check check (
    organization_version > 0
    and authorization_generation >= 0
    and disclosure_version > 0
    and section_activation_version > 0
    and dto_revision = 1
  )
);
create index skill_snapshots_retention_idx on skill_snapshots (validated_at);

create function eve_module_member_audit.persist_write_skill_snapshot(input jsonb)
returns jsonb
language sql
volatile
parallel unsafe
begin atomic
  with persisted as (
    insert into skill_snapshots (
      resource_id,
      organization_version,
      target_user_id,
      managed_member_lifecycle_id,
      character_id,
      character_lifecycle_id,
      authorization_generation,
      disclosure_version,
      section_activation_version,
      dto_revision,
      snapshot,
      validated_at
    )
    values (
      input ->> 'resourceId'::text,
      (input ->> 'organizationVersion'::text)::bigint,
      (input ->> 'targetUserId'::text)::uuid,
      (input ->> 'managedMemberLifecycleId'::text)::uuid,
      (input ->> 'characterId'::text)::bigint,
      (input ->> 'characterLifecycleId'::text)::uuid,
      (input ->> 'authorizationGeneration'::text)::integer,
      (input ->> 'disclosureVersion'::text)::integer,
      (input ->> 'sectionActivationVersion'::text)::integer,
      (input ->> 'dtoRevision'::text)::integer,
      input -> 'snapshot'::text,
      (input ->> 'validatedAt'::text)::timestamptz
    )
    on conflict (resource_id, character_id) do update
    set organization_version = excluded.organization_version,
        target_user_id = excluded.target_user_id,
        managed_member_lifecycle_id = excluded.managed_member_lifecycle_id,
        character_lifecycle_id = excluded.character_lifecycle_id,
        authorization_generation = excluded.authorization_generation,
        disclosure_version = excluded.disclosure_version,
        section_activation_version = excluded.section_activation_version,
        dto_revision = excluded.dto_revision,
        snapshot = excluded.snapshot,
        validated_at = excluded.validated_at
    where skill_snapshots.validated_at <= excluded.validated_at
    returning 1 as "?column?"
  )
  select jsonb_build_object(
    'outcome'::text,
    case
      when exists (select from persisted) then 'applied'::text
      else 'obsolete'::text
    end
  ) as result;
end;
