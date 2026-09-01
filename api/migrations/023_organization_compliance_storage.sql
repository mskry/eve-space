create unique index characters_user_character_key on characters (user_id, character_id);

create table organization_account_compliance (
  deployment_id smallint not null default 1,
  organization_version bigint not null,
  user_id uuid not null,
  state text not null default 'pending',
  evidence_freshness text not null default 'unavailable',
  evidence_at timestamptz,
  review_deadline timestamptz,
  established_compliant_at timestamptz,
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (deployment_id, organization_version, user_id),
  constraint organization_account_compliance_epoch_fkey
    foreign key (deployment_id, organization_version)
    references organization_epochs (deployment_id, organization_version)
    on delete restrict,
  constraint organization_account_compliance_user_id_fkey
    foreign key (user_id) references users (id) on delete cascade,
  constraint organization_account_compliance_state_check
    check (state in ('pending', 'compliant', 'review_required', 'suspended')),
  constraint organization_account_compliance_freshness_check
    check (evidence_freshness in ('fresh', 'stale', 'unavailable')),
  constraint organization_account_compliance_evidence_check
    check (
      (evidence_freshness = 'unavailable' and evidence_at is null)
      or (evidence_freshness <> 'unavailable' and evidence_at is not null)
    ),
  constraint organization_account_compliance_deadline_check
    check (review_deadline is null or state in ('review_required', 'suspended')),
  constraint organization_account_compliance_established_check
    check (established_compliant_at is null or established_compliant_at <= evaluated_at)
);

create index organization_account_compliance_repair_idx
  on organization_account_compliance (deployment_id, organization_version, evaluated_at, user_id);

create table organization_compliance_issues (
  issue_id uuid primary key default gen_random_uuid(),
  deployment_id smallint not null default 1,
  organization_version bigint not null,
  user_id uuid not null,
  issue_key text not null,
  issue_code text not null,
  character_id bigint,
  required_scope text,
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_compliance_issues_projection_fkey
    foreign key (deployment_id, organization_version, user_id)
    references organization_account_compliance (deployment_id, organization_version, user_id)
    on delete cascade,
  constraint organization_compliance_issues_character_owner_fkey
    foreign key (user_id, character_id)
    references characters (user_id, character_id)
    on delete cascade,
  constraint organization_compliance_issues_key_check check (length(trim(issue_key)) > 0),
  constraint organization_compliance_issues_code_check check (length(trim(issue_code)) > 0),
  constraint organization_compliance_issues_required_scope_check
    check (required_scope is null or length(trim(required_scope)) > 0),
  constraint organization_compliance_issues_observed_at_check
    check (last_observed_at >= first_observed_at),
  constraint organization_compliance_issues_projection_key
    unique (deployment_id, organization_version, user_id, issue_key)
);

create index organization_compliance_issues_character_idx
  on organization_compliance_issues (character_id)
  where character_id is not null;

create table organization_character_exceptions (
  exception_id uuid primary key default gen_random_uuid(),
  deployment_id smallint not null default 1,
  organization_version bigint not null,
  user_id uuid not null,
  character_id bigint not null,
  approver_user_id uuid not null,
  reason text not null,
  approved_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by_user_id uuid,
  revocation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_character_exceptions_version_key
    unique (exception_id, deployment_id, organization_version),
  constraint organization_character_exceptions_epoch_fkey
    foreign key (deployment_id, organization_version)
    references organization_epochs (deployment_id, organization_version)
    on delete restrict,
  constraint organization_character_exceptions_character_owner_fkey
    foreign key (user_id, character_id)
    references characters (user_id, character_id)
    on delete cascade,
  constraint organization_character_exceptions_approver_user_id_fkey
    foreign key (approver_user_id) references users (id) on delete restrict,
  constraint organization_character_exceptions_revoked_by_user_id_fkey
    foreign key (revoked_by_user_id) references users (id) on delete restrict,
  constraint organization_character_exceptions_reason_check check (length(trim(reason)) > 0),
  constraint organization_character_exceptions_expiry_check
    check (expires_at is null or expires_at > approved_at),
  constraint organization_character_exceptions_revocation_check
    check (
      (revoked_at is null and revoked_by_user_id is null and revocation_reason is null)
      or (
        revoked_at is not null
        and revoked_by_user_id is not null
        and length(trim(revocation_reason)) > 0
        and revoked_at >= approved_at
      )
    )
);

create index organization_character_exceptions_subject_idx
  on organization_character_exceptions (
    deployment_id,
    organization_version,
    user_id,
    character_id,
    expires_at
  )
  where revoked_at is null;
