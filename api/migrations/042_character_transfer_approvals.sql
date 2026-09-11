create table character_transfer_previews (
  preview_id uuid primary key default gen_random_uuid(),
  administrator_id uuid not null references deployment_admins(id) on delete cascade,
  character_id bigint not null references characters(character_id) on delete cascade,
  character_name text not null,
  source_user_id uuid not null references users(id) on delete cascade,
  source_subject_lifecycle_id uuid not null
    references platform_subject_lifecycles(subject_lifecycle_id) on delete cascade,
  source_character_count integer not null,
  destination_user_id uuid not null references users(id) on delete cascade,
  destination_main_character_id bigint not null
    references characters(character_id) on delete cascade,
  destination_main_character_name text not null,
  reason varchar(1000) not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  constraint character_transfer_previews_source_count_check check (source_character_count > 0),
  constraint character_transfer_previews_reason_check
    check (reason = trim(reason) and length(reason) between 1 and 1000),
  constraint character_transfer_previews_expiry_check
    check (expires_at = created_at + interval '5 minutes'),
  constraint character_transfer_previews_accounts_check check (source_user_id <> destination_user_id)
);

create index character_transfer_previews_expires_at_idx
  on character_transfer_previews (expires_at);
create index character_transfer_previews_administrator_id_idx
  on character_transfer_previews (administrator_id);

create table character_transfer_approvals (
  approval_id uuid primary key default gen_random_uuid(),
  link_secret_hash varchar(64) not null unique,
  character_id bigint not null,
  character_name text not null,
  source_user_id uuid not null,
  source_subject_lifecycle_id uuid not null,
  source_character_count integer not null,
  destination_user_id uuid not null,
  destination_main_character_id bigint not null,
  destination_main_character_name text not null,
  approved_by_administrator_id uuid not null,
  reason varchar(1000) not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by_user_id uuid,
  new_subject_lifecycle_id uuid,
  revoked_at timestamptz,
  revoked_by_administrator_id uuid,
  revocation_reason varchar(1000),
  constraint character_transfer_approvals_secret_hash_check
    check (link_secret_hash ~ '^[0-9a-f]{64}$'),
  constraint character_transfer_approvals_source_count_check check (source_character_count > 0),
  constraint character_transfer_approvals_reason_check
    check (reason = trim(reason) and length(reason) between 1 and 1000),
  constraint character_transfer_approvals_expiry_check
    check (expires_at = created_at + interval '15 minutes'),
  constraint character_transfer_approvals_accounts_check check (source_user_id <> destination_user_id),
  constraint character_transfer_approvals_consumed_check check (
    (consumed_at is null and consumed_by_user_id is null and new_subject_lifecycle_id is null)
    or (
      consumed_at is not null
      and consumed_by_user_id = destination_user_id
      and new_subject_lifecycle_id is not null
      and consumed_at >= created_at
    )
  ),
  constraint character_transfer_approvals_revoked_check check (
    (revoked_at is null and revoked_by_administrator_id is null and revocation_reason is null)
    or (
      revoked_at is not null
      and revoked_by_administrator_id is not null
      and revocation_reason is not null
      and revocation_reason = trim(revocation_reason)
      and length(revocation_reason) between 1 and 1000
      and revoked_at >= created_at
    )
  ),
  constraint character_transfer_approvals_terminal_state_check
    check (consumed_at is null or revoked_at is null)
);

create index character_transfer_approvals_character_lifecycle_idx
  on character_transfer_approvals (character_id, source_subject_lifecycle_id);
create index character_transfer_approvals_destination_user_id_idx
  on character_transfer_approvals (destination_user_id);
create index character_transfer_approvals_pending_idx
  on character_transfer_approvals (expires_at, approval_id)
  where consumed_at is null and revoked_at is null;

create function enforce_character_transfer_approval_mutation()
returns trigger
language plpgsql
as $$
begin
  if row(
    old.approval_id,
    old.link_secret_hash,
    old.character_id,
    old.character_name,
    old.source_user_id,
    old.source_subject_lifecycle_id,
    old.source_character_count,
    old.destination_user_id,
    old.destination_main_character_id,
    old.destination_main_character_name,
    old.approved_by_administrator_id,
    old.reason,
    old.created_at,
    old.expires_at
  ) is distinct from row(
    new.approval_id,
    new.link_secret_hash,
    new.character_id,
    new.character_name,
    new.source_user_id,
    new.source_subject_lifecycle_id,
    new.source_character_count,
    new.destination_user_id,
    new.destination_main_character_id,
    new.destination_main_character_name,
    new.approved_by_administrator_id,
    new.reason,
    new.created_at,
    new.expires_at
  ) then
    raise exception 'character transfer approval bindings are immutable';
  end if;

  if old.consumed_at is not null or old.revoked_at is not null then
    raise exception 'terminal character transfer approvals are immutable';
  end if;

  return new;
end;
$$;

create trigger character_transfer_approvals_mutation_guard
before update on character_transfer_approvals
for each row execute function enforce_character_transfer_approval_mutation();

create table character_transfer_audit (
  audit_id uuid primary key default gen_random_uuid(),
  approval_id uuid not null,
  action text not null,
  approved_by_administrator_id uuid not null,
  action_administrator_id uuid,
  acting_destination_user_id uuid,
  character_id bigint not null,
  source_user_id uuid not null,
  source_subject_lifecycle_id uuid not null,
  destination_user_id uuid not null,
  new_subject_lifecycle_id uuid,
  source_event_id uuid,
  destination_event_id uuid,
  reason varchar(1000) not null,
  outcome text not null,
  occurred_at timestamptz not null default clock_timestamp(),
  constraint character_transfer_audit_action_check
    check (action in ('created', 'revoked', 'consumed')),
  constraint character_transfer_audit_outcome_check
    check (outcome in ('created', 'revoked', 'consumed')),
  constraint character_transfer_audit_reason_check
    check (reason = trim(reason) and length(reason) between 1 and 1000),
  constraint character_transfer_audit_accounts_check check (source_user_id <> destination_user_id),
  constraint character_transfer_audit_consumption_check check (
    (
      action = 'consumed'
      and acting_destination_user_id = destination_user_id
      and new_subject_lifecycle_id is not null
      and source_event_id is not null
      and destination_event_id is not null
    )
    or (
      action <> 'consumed'
      and acting_destination_user_id is null
      and new_subject_lifecycle_id is null
      and source_event_id is null
      and destination_event_id is null
    )
  ),
  constraint character_transfer_audit_administrator_check check (
    (action = 'consumed' and action_administrator_id is null)
    or (action <> 'consumed' and action_administrator_id is not null)
  )
);

create index character_transfer_audit_approval_id_idx
  on character_transfer_audit (approval_id, occurred_at);
create index character_transfer_audit_character_id_idx
  on character_transfer_audit (character_id, occurred_at);

create function prevent_character_transfer_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'character transfer audit is append-only';
end;
$$;

create trigger character_transfer_audit_append_only
before update or delete on character_transfer_audit
for each row execute function prevent_character_transfer_audit_mutation();

alter table oauth_states
  add column transfer_approval_id uuid,
  add column transfer_source_user_id uuid,
  add column transfer_source_subject_lifecycle_id uuid,
  drop constraint oauth_states_intent_check,
  drop constraint oauth_states_context_check,
  add constraint oauth_states_intent_check
    check (intent in ('login', 'attach', 'reauthorize', 'claim-organization-owner', 'transfer')),
  add constraint oauth_states_context_check
    check (
      (
        intent = 'login'
        and user_id is null
        and character_id is null
        and organization_deployment_id is null
        and organization_id is null
        and organization_version is null
        and transfer_approval_id is null
        and transfer_source_user_id is null
        and transfer_source_subject_lifecycle_id is null
      )
      or (
        intent = 'attach'
        and user_id is not null
        and character_id is null
        and organization_deployment_id is null
        and organization_id is null
        and organization_version is null
        and transfer_approval_id is null
        and transfer_source_user_id is null
        and transfer_source_subject_lifecycle_id is null
      )
      or (
        intent = 'reauthorize'
        and user_id is not null
        and character_id is not null
        and organization_deployment_id is null
        and organization_id is null
        and organization_version is null
        and transfer_approval_id is null
        and transfer_source_user_id is null
        and transfer_source_subject_lifecycle_id is null
      )
      or (
        intent = 'claim-organization-owner'
        and user_id is not null
        and character_id is not null
        and organization_deployment_id = 1
        and organization_id is not null
        and organization_version is not null
        and transfer_approval_id is null
        and transfer_source_user_id is null
        and transfer_source_subject_lifecycle_id is null
      )
      or (
        intent = 'transfer'
        and user_id is not null
        and character_id is not null
        and organization_deployment_id is null
        and organization_id is null
        and organization_version is null
        and transfer_approval_id is not null
        and transfer_source_user_id is not null
        and transfer_source_subject_lifecycle_id is not null
      )
    ),
  add constraint oauth_states_transfer_approval_fkey
    foreign key (transfer_approval_id)
    references character_transfer_approvals(approval_id) on delete cascade,
  add constraint oauth_states_transfer_source_user_fkey
    foreign key (transfer_source_user_id) references users(id) on delete cascade,
  add constraint oauth_states_transfer_source_lifecycle_fkey
    foreign key (transfer_source_subject_lifecycle_id)
    references platform_subject_lifecycles(subject_lifecycle_id) on delete cascade;

create index oauth_states_transfer_approval_idx
  on oauth_states (transfer_approval_id)
  where transfer_approval_id is not null;
