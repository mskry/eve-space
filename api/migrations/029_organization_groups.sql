create table organization_permission_bundles (
  bundle_id uuid primary key default gen_random_uuid(),
  deployment_id smallint not null default 1,
  organization_version bigint not null,
  name text not null,
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_permission_bundles_version_key
    unique (bundle_id, deployment_id, organization_version),
  constraint organization_permission_bundles_epoch_fkey
    foreign key (deployment_id, organization_version)
    references organization_epochs (deployment_id, organization_version)
    on delete restrict,
  constraint organization_permission_bundles_creator_fkey
    foreign key (created_by_user_id) references users (id) on delete restrict,
  constraint organization_permission_bundles_name_check
    check (name = trim(name) and length(name) between 1 and 100)
);

create unique index organization_permission_bundles_name_key
  on organization_permission_bundles (deployment_id, organization_version, lower(name));

create table organization_permission_bundle_entries (
  bundle_id uuid not null,
  deployment_id smallint not null default 1,
  organization_version bigint not null,
  permission_type text not null,
  permission_key text not null,
  created_at timestamptz not null default now(),
  primary key (bundle_id, permission_type, permission_key),
  constraint organization_permission_bundle_entries_bundle_fkey
    foreign key (bundle_id, deployment_id, organization_version)
    references organization_permission_bundles (
      bundle_id,
      deployment_id,
      organization_version
    )
    on delete restrict,
  constraint organization_permission_bundle_entries_type_check
    check (permission_type in ('module', 'service')),
  constraint organization_permission_bundle_entries_key_check
    check (
      length(permission_key) between 1 and 200
      and permission_key ~ '^[a-z][a-z0-9-]*([.:-][a-z0-9-]+)*$'
    )
);

create table organization_groups (
  group_id uuid primary key default gen_random_uuid(),
  deployment_id smallint not null default 1,
  organization_version bigint not null,
  name text not null,
  restricted boolean not null default false,
  management_mode text not null default 'manual',
  compliance_source text,
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_groups_version_key
    unique (group_id, deployment_id, organization_version),
  constraint organization_groups_epoch_fkey
    foreign key (deployment_id, organization_version)
    references organization_epochs (deployment_id, organization_version)
    on delete restrict,
  constraint organization_groups_creator_fkey
    foreign key (created_by_user_id) references users (id) on delete restrict,
  constraint organization_groups_name_check
    check (name = trim(name) and length(name) between 1 and 100),
  constraint organization_groups_management_check
    check (
      (management_mode = 'manual' and compliance_source is null)
      or (
        management_mode = 'compliance'
        and compliance_source in ('core.registration')
      )
    )
);

create unique index organization_groups_name_key
  on organization_groups (deployment_id, organization_version, lower(name));

create index organization_groups_compliance_source_idx
  on organization_groups (deployment_id, organization_version, compliance_source)
  where management_mode = 'compliance';

create table organization_group_permission_bundles (
  group_id uuid not null,
  bundle_id uuid not null,
  deployment_id smallint not null default 1,
  organization_version bigint not null,
  created_at timestamptz not null default now(),
  primary key (group_id, bundle_id),
  constraint organization_group_permission_bundles_group_fkey
    foreign key (group_id, deployment_id, organization_version)
    references organization_groups (group_id, deployment_id, organization_version)
    on delete restrict,
  constraint organization_group_permission_bundles_bundle_fkey
    foreign key (bundle_id, deployment_id, organization_version)
    references organization_permission_bundles (
      bundle_id,
      deployment_id,
      organization_version
    )
    on delete restrict
);

create table organization_group_assignments (
  assignment_id uuid primary key default gen_random_uuid(),
  group_id uuid not null,
  deployment_id smallint not null default 1,
  organization_version bigint not null,
  user_id uuid not null,
  assignment_source text not null,
  compliance_source text,
  assigned_actor_type text not null,
  assigned_by_user_id uuid,
  reason text not null,
  assigned_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_actor_type text,
  revoked_by_user_id uuid,
  revocation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_group_assignments_version_key
    unique (assignment_id, deployment_id, organization_version),
  constraint organization_group_assignments_group_fkey
    foreign key (group_id, deployment_id, organization_version)
    references organization_groups (group_id, deployment_id, organization_version)
    on delete restrict,
  constraint organization_group_assignments_user_fkey
    foreign key (user_id) references users (id) on delete cascade,
  constraint organization_group_assignments_assigned_by_fkey
    foreign key (assigned_by_user_id) references users (id) on delete restrict,
  constraint organization_group_assignments_revoked_by_fkey
    foreign key (revoked_by_user_id) references users (id) on delete restrict,
  constraint organization_group_assignments_source_check
    check (assignment_source in ('manual', 'compliance')),
  constraint organization_group_assignments_assignment_actor_check
    check (
      (
        assignment_source = 'manual'
        and assigned_actor_type = 'user'
        and assigned_by_user_id is not null
      )
      or (
        assignment_source = 'compliance'
        and assigned_actor_type = 'system'
        and assigned_by_user_id is null
        and expires_at is null
      )
    ),
  constraint organization_group_assignments_reason_check
    check (length(trim(reason)) between 1 and 2000),
  constraint organization_group_assignments_expiry_check
    check (expires_at is null or expires_at > assigned_at),
  constraint organization_group_assignments_revocation_check
    check (
      (
        revoked_at is null
        and revoked_actor_type is null
        and revoked_by_user_id is null
        and revocation_reason is null
      )
      or (
        revoked_at is not null
        and revoked_at >= assigned_at
        and revoked_actor_type in ('user', 'system')
        and (
          (revoked_actor_type = 'user' and revoked_by_user_id is not null)
          or (revoked_actor_type = 'system' and revoked_by_user_id is null)
        )
        and length(trim(revocation_reason)) between 1 and 2000
      )
    )
);

create unique index organization_group_assignments_active_key
  on organization_group_assignments (
    deployment_id,
    organization_version,
    group_id,
    user_id
  )
  where revoked_at is null;

create index organization_group_assignments_entitlement_idx
  on organization_group_assignments (
    deployment_id,
    organization_version,
    user_id,
    expires_at,
    group_id
  )
  where revoked_at is null;

create function enforce_organization_group_assignment_management()
returns trigger
language plpgsql
as $$
declare
  expected_mode text;
  expected_source text;
begin
  select management_mode, compliance_source
  into expected_mode, expected_source
  from organization_groups
  where group_id = new.group_id
    and deployment_id = new.deployment_id
    and organization_version = new.organization_version
  for share;

  if not found
    or new.assignment_source <> expected_mode
    or new.compliance_source is distinct from expected_source then
    raise exception 'group assignment management does not match its group';
  end if;
  return new;
end;
$$;

create trigger organization_group_assignments_management_guard
before insert or update of group_id, deployment_id, organization_version, assignment_source, compliance_source
on organization_group_assignments
for each row execute function enforce_organization_group_assignment_management();

create function prevent_organization_group_management_change()
returns trigger
language plpgsql
as $$
begin
  if (
    old.management_mode is distinct from new.management_mode
    or old.compliance_source is distinct from new.compliance_source
  ) and exists (
    select 1
    from organization_group_assignments
    where group_id = old.group_id
  ) then
    raise exception 'group management cannot change after assignment';
  end if;
  return new;
end;
$$;

create trigger organization_groups_management_change_guard
before update of management_mode, compliance_source on organization_groups
for each row execute function prevent_organization_group_management_change();

alter table organization_audit_events
  add column group_id uuid,
  add column assignment_id uuid,
  add column target_user_id uuid,
  add column assignment_source text,
  add column compliance_source text,
  add column entitlement_expires_at timestamptz,
  add constraint organization_audit_events_group_assignment_check
    check (
      (
        event_type in ('group.assigned', 'group.revoked')
        and group_id is not null
        and assignment_id is not null
        and target_user_id is not null
        and assignment_source in ('manual', 'compliance')
        and (
          (assignment_source = 'manual' and compliance_source is null)
          or (assignment_source = 'compliance' and compliance_source is not null)
        )
      )
      or (
        event_type not in ('group.assigned', 'group.revoked')
        and group_id is null
        and assignment_id is null
        and target_user_id is null
        and assignment_source is null
        and compliance_source is null
        and entitlement_expires_at is null
      )
    );
