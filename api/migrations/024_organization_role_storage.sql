create table organization_role_grants (
  grant_id uuid primary key default gen_random_uuid(),
  deployment_id smallint not null default 1,
  organization_version bigint not null,
  user_id uuid not null,
  role text not null,
  granted_by_user_id uuid not null,
  reason text not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by_user_id uuid,
  revocation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_role_grants_version_identity_key
    unique (grant_id, deployment_id, organization_version, user_id, role),
  constraint organization_role_grants_epoch_fkey
    foreign key (deployment_id, organization_version)
    references organization_epochs (deployment_id, organization_version)
    on delete restrict,
  constraint organization_role_grants_user_id_fkey
    foreign key (user_id) references users (id) on delete cascade,
  constraint organization_role_grants_granted_by_user_id_fkey
    foreign key (granted_by_user_id) references users (id) on delete restrict,
  constraint organization_role_grants_revoked_by_user_id_fkey
    foreign key (revoked_by_user_id) references users (id) on delete restrict,
  constraint organization_role_grants_role_check
    check (role in ('hr_auditor', 'director', 'organization_owner')),
  constraint organization_role_grants_reason_check check (length(trim(reason)) > 0),
  constraint organization_role_grants_revocation_check
    check (
      (revoked_at is null and revoked_by_user_id is null and revocation_reason is null)
      or (
        revoked_at is not null
        and length(trim(revocation_reason)) > 0
        and revoked_at >= granted_at
      )
    )
);

create unique index organization_role_grants_active_key
  on organization_role_grants (deployment_id, organization_version, user_id, role)
  where revoked_at is null;

create index organization_role_grants_active_role_idx
  on organization_role_grants (deployment_id, organization_version, role, user_id)
  where revoked_at is null;

create table organization_authority_evidence (
  evidence_id uuid primary key default gen_random_uuid(),
  grant_id uuid not null,
  deployment_id smallint not null default 1,
  organization_version bigint not null,
  user_id uuid not null,
  role text not null default 'organization_owner',
  character_id bigint not null,
  authority_corporation_id bigint not null,
  observed_corporation_id bigint not null,
  observed_alliance_id bigint,
  required_scope text not null,
  director_role_present boolean not null,
  status text not null,
  verified_at timestamptz,
  last_checked_at timestamptz not null,
  review_deadline timestamptz,
  failure_class text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_authority_evidence_grant_key unique (grant_id),
  constraint organization_authority_evidence_grant_fkey
    foreign key (grant_id, deployment_id, organization_version, user_id, role)
    references organization_role_grants (
      grant_id,
      deployment_id,
      organization_version,
      user_id,
      role
    )
    on delete restrict,
  constraint organization_authority_evidence_character_owner_fkey
    foreign key (user_id, character_id)
    references characters (user_id, character_id)
    on delete restrict,
  constraint organization_authority_evidence_role_check check (role = 'organization_owner'),
  constraint organization_authority_evidence_corporation_check
    check (
      authority_corporation_id > 0
      and observed_corporation_id = authority_corporation_id
    ),
  constraint organization_authority_evidence_scope_check
    check (length(trim(required_scope)) > 0),
  constraint organization_authority_evidence_status_check
    check (status in ('fresh', 'review_required', 'invalid')),
  constraint organization_authority_evidence_verified_at_check
    check (
      (
        status = 'fresh'
        and verified_at is not null
        and director_role_present
        and failure_class is null
      )
      or (status <> 'fresh' and failure_class is not null)
    ),
  constraint organization_authority_evidence_review_check
    check (review_deadline is null or status = 'review_required'),
  constraint organization_authority_evidence_checked_at_check
    check (verified_at is null or last_checked_at >= verified_at)
);

create index organization_authority_evidence_refresh_idx
  on organization_authority_evidence (status, last_checked_at, grant_id);
