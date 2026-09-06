alter table organization_account_compliance
  drop constraint organization_account_compliance_access_validity_check;

update organization_account_compliance
set access_valid_until = review_deadline
where state = 'review_required'
  and established_compliant_at is not null;

alter table organization_account_compliance
  add constraint organization_account_compliance_access_validity_check
  check (
    (state = 'compliant' and access_valid_until is not null)
    or (
      state = 'review_required'
      and (
        (established_compliant_at is null and access_valid_until is null)
        or (
          established_compliant_at is not null
          and access_valid_until is not null
          and access_valid_until = review_deadline
        )
      )
    )
    or (state in ('pending', 'suspended') and access_valid_until is null)
  );
