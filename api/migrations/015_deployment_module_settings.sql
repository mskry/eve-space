create table deployment_modules (
  module_id text primary key,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deployment_modules_module_id_check check (
    module_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
    and length(module_id) <= 44
    and module_id not in ('core', 'platform')
  )
);

create table deployment_shell_navigation_order (
  owner_id text not null,
  navigation_id text not null,
  position integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, navigation_id),
  constraint deployment_shell_navigation_order_owner_id_check check (
    owner_id = 'core'
    or (
      owner_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
      and length(owner_id) <= 44
      and owner_id <> 'platform'
    )
  ),
  constraint deployment_shell_navigation_order_navigation_id_check check (
    navigation_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
  ),
  constraint deployment_shell_navigation_order_position_check check (position >= 0)
);
