create table module_persistence_contract (
  singleton boolean primary key default true,
  contract_fingerprint text not null,
  operation_count integer not null,
  reconciled_at timestamptz not null default now(),
  constraint module_persistence_contract_singleton_check check (singleton),
  constraint module_persistence_contract_fingerprint_check check (
    contract_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  constraint module_persistence_contract_operation_count_check check (operation_count >= 0)
);

create table module_persistence_operation_attestations (
  module_id text not null,
  operation_id text not null,
  revision integer not null,
  mode text not null,
  migration_name text not null,
  schema_name text not null,
  routine_name text not null,
  definition_fingerprint text not null,
  attested_at timestamptz not null default now(),
  primary key (module_id, operation_id),
  constraint module_persistence_operation_attestations_module_id_check check (
    is_valid_module_id(module_id)
  ),
  constraint module_persistence_operation_attestations_operation_id_check check (
    length(operation_id) <= 54
    and operation_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
  ),
  constraint module_persistence_operation_attestations_revision_check check (revision > 0),
  constraint module_persistence_operation_attestations_mode_check check (mode in ('read', 'write')),
  constraint module_persistence_operation_attestations_migration_name_check check (
    migration_name ~ '^[A-Za-z0-9][A-Za-z0-9._-]*\.sql$'
  ),
  constraint module_persistence_operation_attestations_schema_name_check check (
    schema_name ~ '^eve_module_[a-z0-9_]+$'
  ),
  constraint module_persistence_operation_attestations_routine_name_check check (
    routine_name ~ '^persist_[a-z0-9_]+$'
  ),
  constraint module_persistence_operation_attestations_fingerprint_check check (
    definition_fingerprint ~ '^[0-9a-f]{64}$'
  )
);
