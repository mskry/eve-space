create table module_schema_provisioning (
  module_id text primary key,
  provisioned_at timestamptz not null default now(),
  constraint module_schema_provisioning_module_id_check check (
    module_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
    and length(module_id) <= 44
    and module_id not in ('core', 'platform')
  )
);
