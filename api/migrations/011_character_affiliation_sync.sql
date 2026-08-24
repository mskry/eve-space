alter table characters
  add column affiliation_checked_at timestamptz,
  add column next_affiliation_check timestamptz,
  add column affiliation_resolution_state text not null default 'pending';

update characters
set
  affiliation_resolution_state = 'pending',
  next_affiliation_check = now();

alter table characters
  add constraint characters_affiliation_resolution_state_check
  check (affiliation_resolution_state in ('pending', 'resolved', 'unresolvable'));

create index characters_due_affiliation_check_idx
  on characters (next_affiliation_check, character_id)
  where next_affiliation_check is not null
    and affiliation_resolution_state <> 'unresolvable';
