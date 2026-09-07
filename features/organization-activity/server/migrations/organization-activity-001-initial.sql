create table activity_snapshots (
  resource_id text not null,
  subject_lifecycle_id uuid not null,
  organization_version bigint not null,
  authorization_generation integer not null,
  activity_id uuid not null,
  snapshot jsonb not null,
  validated_at timestamptz not null,
  primary key (resource_id, subject_lifecycle_id, organization_version, authorization_generation, activity_id)
);
create index activity_snapshots_retention_idx on activity_snapshots (validated_at);

create table collection_checkpoints (
  resource_id text not null,
  subject_lifecycle_id uuid not null,
  organization_version bigint not null,
  authorization_generation integer not null,
  checkpoint jsonb not null,
  revision bigint not null default 0,
  primary key (resource_id, subject_lifecycle_id, organization_version, authorization_generation)
);
