alter table deployment_settings
  add column registration_policy_version bigint not null default 1,
  add constraint deployment_settings_registration_policy_version_check
    check (registration_policy_version > 0);

create table organization_audit_events (
  audit_id uuid primary key default gen_random_uuid(),
  audit_sequence bigint generated always as identity,
  deployment_id smallint not null default 1,
  organization_version bigint not null,
  policy_version bigint not null,
  event_type text not null,
  actor_type text not null,
  actor_id uuid,
  subject_type text not null,
  subject_id text not null,
  reason text not null,
  outcome text not null,
  causation_audit_id uuid,
  occurred_at timestamptz not null default now(),
  constraint organization_audit_events_sequence_key unique (audit_sequence),
  constraint organization_audit_events_epoch_fkey
    foreign key (deployment_id, organization_version)
    references organization_epochs (deployment_id, organization_version)
    on delete restrict,
  constraint organization_audit_events_causation_fkey
    foreign key (causation_audit_id)
    references organization_audit_events (audit_id)
    on delete restrict,
  constraint organization_audit_events_policy_version_check check (policy_version > 0),
  constraint organization_audit_events_type_check
    check (
      event_type in (
        'organization.changed',
        'role.granted',
        'role.revoked',
        'exception.approved',
        'exception.expired',
        'exception.revoked',
        'compliance.transitioned',
        'entitlement.granted',
        'entitlement.revoked',
        'corporation-source.registered',
        'corporation-source.replaced',
        'corporation-source.revoked',
        'group.assigned',
        'group.revoked',
        'member.blocked',
        'member.unblocked'
      )
    ),
  constraint organization_audit_events_actor_check
    check (
      (actor_type in ('user', 'deployment_admin') and actor_id is not null)
      or (actor_type = 'system' and actor_id is null)
    ),
  constraint organization_audit_events_subject_type_check
    check (
      subject_type in (
        'deployment',
        'user',
        'character',
        'role_grant',
        'exception',
        'compliance',
        'corporation_source',
        'managed_corporation',
        'group',
        'external_service'
      )
    ),
  constraint organization_audit_events_subject_id_check
    check (length(trim(subject_id)) > 0 and length(subject_id) <= 255),
  constraint organization_audit_events_reason_check
    check (length(trim(reason)) > 0 and length(reason) <= 2000),
  constraint organization_audit_events_outcome_check
    check (outcome in ('granted', 'revoked', 'transitioned', 'denied', 'unchanged'))
);

create index organization_audit_events_version_sequence_idx
  on organization_audit_events (deployment_id, organization_version, audit_sequence);

create index organization_audit_events_subject_idx
  on organization_audit_events (
    deployment_id,
    organization_version,
    subject_type,
    subject_id,
    audit_sequence
  );

create function prevent_organization_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'organization audit events are append-only';
end;
$$;

create trigger organization_audit_events_append_only
before update or delete on organization_audit_events
for each row execute function prevent_organization_audit_mutation();
