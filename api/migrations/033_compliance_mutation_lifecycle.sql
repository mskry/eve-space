alter table organization_character_exceptions
  add column expired_at timestamptz,
  add constraint organization_character_exceptions_expired_at_check
    check (expired_at is null or (expires_at is not null and expired_at >= expires_at));

create index organization_character_exceptions_expiry_idx
  on organization_character_exceptions (expires_at, exception_id)
  where revoked_at is null and expired_at is null and expires_at is not null;

alter table organization_audit_events
  drop constraint organization_audit_events_type_check,
  add constraint organization_audit_events_type_check
    check (
      event_type in (
        'organization.changed',
        'registration-policy.changed',
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
    );
