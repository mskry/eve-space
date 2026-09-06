alter table oauth_states
  drop constraint oauth_states_return_path_context_check,
  add constraint oauth_states_return_path_context_check
    check (return_path is null or intent in ('login', 'reauthorize'));
