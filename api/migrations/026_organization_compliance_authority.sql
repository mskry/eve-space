alter table organization_account_compliance
  add column authoritative boolean not null default true,
  add column invalidated_at timestamptz,
  add constraint organization_account_compliance_authoritative_check
    check (
      (authoritative and invalidated_at is null)
      or (not authoritative and invalidated_at is not null)
    );

create index organization_account_compliance_authoritative_idx
  on organization_account_compliance (deployment_id, organization_version, user_id)
  where authoritative;
