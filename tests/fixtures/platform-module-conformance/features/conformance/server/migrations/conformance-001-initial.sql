create table conformance_snapshots (
  character_id bigint primary key,
  pilots_online integer not null,
  validated_at timestamptz not null
);

create table conformance_migration_identity (
  role_name text not null,
  schema_name text not null
);

insert into conformance_migration_identity (role_name, schema_name)
values (current_user, current_schema());
