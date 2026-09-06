alter table organization_account_compliance
  add column access_valid_until timestamptz;

update organization_account_compliance
set access_valid_until = evaluated_at
where state = 'compliant';

alter table organization_account_compliance
  add constraint organization_account_compliance_access_validity_check
    check (
      (state = 'compliant' and access_valid_until is not null)
      or (state <> 'compliant' and access_valid_until is null)
    );

create index organization_account_compliance_access_expiry_idx
  on organization_account_compliance (access_valid_until, user_id)
  where authoritative and access_valid_until is not null;
