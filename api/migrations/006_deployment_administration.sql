create table deployment_admins (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deployment_admins_email_normalized_check check (email = lower(trim(email)))
);

create table deployment_settings (
  id smallint primary key default 1,
  owner_admin_id uuid not null unique references deployment_admins(id) on delete restrict,
  organization_type text not null,
  organization_id bigint not null,
  organization_name text not null,
  organization_ticker text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deployment_settings_singleton_check check (id = 1),
  constraint deployment_settings_organization_type_check
    check (organization_type in ('corporation', 'alliance')),
  constraint deployment_settings_organization_id_check check (organization_id > 0)
);

create table admin_sessions (
  session_hash varchar(64) primary key,
  admin_id uuid not null references deployment_admins(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint admin_sessions_session_hash_length_check check (length(session_hash) = 64)
);

create index admin_sessions_admin_id_idx on admin_sessions (admin_id);
create index admin_sessions_expires_at_idx on admin_sessions (expires_at);
