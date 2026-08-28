alter table oauth_states
  add column return_path varchar(512),
  add constraint oauth_states_return_path_context_check
    check (return_path is null or intent = 'reauthorize');
