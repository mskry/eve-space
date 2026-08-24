alter table characters
  add column affiliation_checked_at timestamptz,
  add column next_affiliation_check timestamptz,
  add column affiliation_resolution_state text not null default 'pending'; -- NOSONAR: PostgreSQL DDL has no reusable string constants.

update characters
set next_affiliation_check = now()
where next_affiliation_check is null;

alter table characters
  add constraint characters_affiliation_resolution_state_check
  check (affiliation_resolution_state in ('pending', 'resolved', 'unresolvable')); -- NOSONAR: PostgreSQL DDL has no reusable string constants.

create index characters_due_affiliation_check_idx
  on characters (next_affiliation_check, character_id)
  where next_affiliation_check is not null
    and affiliation_resolution_state <> 'unresolvable'; -- NOSONAR: PostgreSQL DDL has no reusable string constants.
