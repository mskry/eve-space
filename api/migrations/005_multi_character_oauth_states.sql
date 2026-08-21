alter table oauth_states
  add column intent text not null default 'login',
  add column user_id uuid,
  add column character_id bigint,
  add constraint oauth_states_intent_check
    check (intent in ('login', 'attach', 'reauthorize')),
  add constraint oauth_states_context_check
    check (
      (intent = 'login' and user_id is null and character_id is null)
      or (intent = 'attach' and user_id is not null and character_id is null)
      or (intent = 'reauthorize' and user_id is not null and character_id is not null)
    ),
  add constraint oauth_states_user_id_fkey
    foreign key (user_id) references users(id) on delete cascade,
  add constraint oauth_states_character_id_fkey
    foreign key (character_id) references characters(character_id) on delete cascade;

create index oauth_states_user_id_idx on oauth_states (user_id) where user_id is not null;
create index oauth_states_character_id_idx on oauth_states (character_id)
  where character_id is not null;
