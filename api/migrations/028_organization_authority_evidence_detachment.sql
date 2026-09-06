alter table organization_authority_evidence
  drop constraint organization_authority_evidence_character_owner_fkey;

create function validate_organization_authority_evidence_character_owner()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from characters
    where user_id = new.user_id
      and character_id = new.character_id
  ) then
    raise foreign_key_violation using
      constraint = 'organization_authority_evidence_character_owner_check',
      message = 'organization authority evidence character must belong to its user';
  end if;
  return new;
end;
$$;

create trigger organization_authority_evidence_character_owner_trigger
before insert or update of user_id, character_id
on organization_authority_evidence
for each row execute function validate_organization_authority_evidence_character_owner();
