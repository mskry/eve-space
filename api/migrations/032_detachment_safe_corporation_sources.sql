alter table organization_corporation_sources
  add column evidence_character_id bigint;

update organization_corporation_sources
set evidence_character_id = character_id;

alter table organization_corporation_sources
  alter column evidence_character_id set not null,
  drop constraint organization_corporation_sources_character_id_fkey,
  alter column character_id drop not null,
  add constraint organization_corporation_sources_character_id_fkey
    foreign key (character_id) references characters (character_id) on delete set null,
  add constraint organization_corporation_sources_evidence_character_id_check
    check (evidence_character_id > 0);
