create table platform_subject_lifecycles (
  subject_lifecycle_id uuid primary key default gen_random_uuid(),
  subject_kind text not null,
  subject_id text not null,
  character_id bigint unique,
  created_at timestamptz not null default now(),
  unique (subject_kind, subject_id),
  unique (subject_kind, subject_lifecycle_id, subject_id),
  constraint platform_subject_lifecycles_character_id_fkey
    foreign key (character_id) references characters(character_id) on delete cascade,
  constraint platform_subject_lifecycles_subject_kind_check check (
    subject_kind in ('deployment', 'character', 'corporation', 'alliance')
  ),
  constraint platform_subject_lifecycles_subject_id_check check (
    subject_id <> '' and subject_id = trim(subject_id)
  ),
  constraint platform_subject_lifecycles_character_binding_check check (
    (
      subject_kind = 'character'
      and character_id is not null
      and subject_id = character_id::text
    )
    or (subject_kind <> 'character' and character_id is null)
  )
);

insert into platform_subject_lifecycles (subject_kind, subject_id, character_id)
select 'character', character_id::text, character_id
from characters;

do $$
begin
  if exists (select 1 from platform_collection_state) then
    raise exception 'platform collection state must be empty before lifecycle enforcement';
  end if;
end
$$;

alter table platform_collection_state
  add constraint platform_collection_state_subject_lifecycle_fkey
  foreign key (subject_kind, subject_lifecycle_id, subject_id)
  references platform_subject_lifecycles (
    subject_kind,
    subject_lifecycle_id,
    subject_id
  )
  on delete cascade;

create index platform_collection_state_subject_lifecycle_idx
  on platform_collection_state (subject_kind, subject_lifecycle_id, subject_id);
