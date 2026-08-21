update eve_tokens
set scopes = (scopes #>> '{}')::jsonb
where jsonb_typeof(scopes) = 'string';

alter table eve_tokens
  add constraint eve_tokens_scopes_is_array
  check (jsonb_typeof(scopes) = 'array');
