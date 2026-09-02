alter table sde_types
  add column description text;

alter table sde_builds
  add column ingest_version integer not null default 1;
