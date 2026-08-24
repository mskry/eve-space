create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table characters (
  character_id bigint primary key,
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  corporation_id bigint not null,
  alliance_id bigint,
  is_main boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index one_main_character_per_user
  on characters (user_id)
  where is_main;

create table eve_tokens (
  character_id bigint primary key references characters(character_id) on delete cascade,
  encrypted_tokens text not null,
  access_token_expires_at timestamptz not null,
  scopes jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table oauth_states (
  state_hash varchar(64) primary key,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint oauth_states_state_hash_length_check check (length(state_hash) = 64)
);

create table sessions (
  session_hash varchar(64) primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint sessions_session_hash_length_check check (length(session_hash) = 64)
);

create index sessions_user_id_idx on sessions (user_id);
create index sessions_expires_at_idx on sessions (expires_at);
create index oauth_states_expires_at_idx on oauth_states (expires_at);
