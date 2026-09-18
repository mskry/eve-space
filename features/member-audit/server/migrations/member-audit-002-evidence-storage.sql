create table trained_skill_snapshots (
  organization_version bigint not null,
  target_user_id uuid not null,
  managed_member_lifecycle_id uuid not null,
  character_id bigint not null,
  character_lifecycle_id uuid not null,
  authorization_generation integer not null,
  disclosure_version integer not null,
  section_activation_version integer not null,
  dto_revision integer not null,
  observation_id uuid not null,
  snapshot jsonb not null,
  validated_at timestamptz not null,
  primary key (character_id),
  constraint trained_skill_snapshots_authority_check check (
    organization_version > 0
    and character_id > 0
    and authorization_generation >= 0
    and disclosure_version > 0
    and section_activation_version > 0
    and dto_revision > 0
  ),
  constraint trained_skill_snapshots_shape_check check (jsonb_typeof(snapshot) = 'object')
);

create table skill_queue_snapshots (
  organization_version bigint not null,
  target_user_id uuid not null,
  managed_member_lifecycle_id uuid not null,
  character_id bigint not null,
  character_lifecycle_id uuid not null,
  authorization_generation integer not null,
  disclosure_version integer not null,
  section_activation_version integer not null,
  dto_revision integer not null,
  observation_id uuid not null,
  snapshot jsonb not null,
  validated_at timestamptz not null,
  primary key (character_id),
  constraint skill_queue_snapshots_authority_check check (
    organization_version > 0
    and character_id > 0
    and authorization_generation >= 0
    and disclosure_version > 0
    and section_activation_version > 0
    and dto_revision > 0
  ),
  constraint skill_queue_snapshots_shape_check check (jsonb_typeof(snapshot) = 'object')
);

insert into trained_skill_snapshots (
  organization_version, target_user_id, managed_member_lifecycle_id, character_id,
  character_lifecycle_id, authorization_generation, disclosure_version,
  section_activation_version, dto_revision, observation_id, snapshot, validated_at
)
select
  organization_version, target_user_id, managed_member_lifecycle_id, character_id,
  character_lifecycle_id, authorization_generation, disclosure_version,
  section_activation_version, dto_revision,
  (
    substr(observation_hash.digest, 1, 8) || '-'::text
    || substr(observation_hash.digest, 9, 4) || '-4'::text
    || substr(observation_hash.digest, 14, 3) || '-8'::text
    || substr(observation_hash.digest, 18, 3) || '-'::text
    || substr(observation_hash.digest, 21, 12)
  )::uuid,
  snapshot,
  validated_at
from skill_snapshots
cross join lateral (
  select md5(concat_ws(
    ':'::text,
    resource_id,
    organization_version::text,
    target_user_id::text,
    managed_member_lifecycle_id::text,
    character_id::text,
    character_lifecycle_id::text,
    authorization_generation::text,
    disclosure_version::text,
    section_activation_version::text,
    validated_at::text
  )) as digest
) observation_hash
where resource_id = 'trained-skills'::text;

insert into skill_queue_snapshots (
  organization_version, target_user_id, managed_member_lifecycle_id, character_id,
  character_lifecycle_id, authorization_generation, disclosure_version,
  section_activation_version, dto_revision, observation_id, snapshot, validated_at
)
select
  organization_version, target_user_id, managed_member_lifecycle_id, character_id,
  character_lifecycle_id, authorization_generation, disclosure_version,
  section_activation_version, dto_revision,
  (
    substr(observation_hash.digest, 1, 8) || '-'::text
    || substr(observation_hash.digest, 9, 4) || '-4'::text
    || substr(observation_hash.digest, 14, 3) || '-8'::text
    || substr(observation_hash.digest, 18, 3) || '-'::text
    || substr(observation_hash.digest, 21, 12)
  )::uuid,
  snapshot,
  validated_at
from skill_snapshots
cross join lateral (
  select md5(concat_ws(
    ':'::text,
    resource_id,
    organization_version::text,
    target_user_id::text,
    managed_member_lifecycle_id::text,
    character_id::text,
    character_lifecycle_id::text,
    authorization_generation::text,
    disclosure_version::text,
    section_activation_version::text,
    validated_at::text
  )) as digest
) observation_hash
where resource_id = 'skill-queue'::text;

delete from skill_snapshots;

create table asset_snapshots (
  organization_version bigint not null,
  target_user_id uuid not null,
  managed_member_lifecycle_id uuid not null,
  character_id bigint not null,
  character_lifecycle_id uuid not null,
  authorization_generation integer not null,
  disclosure_version integer not null,
  section_activation_version integer not null,
  dto_revision integer not null,
  observation_id uuid not null,
  snapshot jsonb not null,
  validated_at timestamptz not null,
  primary key (character_id),
  constraint asset_snapshots_authority_check check (
    organization_version > 0
    and character_id > 0
    and authorization_generation >= 0
    and disclosure_version > 0
    and section_activation_version > 0
    and dto_revision > 0
  ),
  constraint asset_snapshots_shape_check check (jsonb_typeof(snapshot) = 'object')
);

create table wallet_balance_snapshots (
  organization_version bigint not null,
  target_user_id uuid not null,
  managed_member_lifecycle_id uuid not null,
  character_id bigint not null,
  character_lifecycle_id uuid not null,
  authorization_generation integer not null,
  disclosure_version integer not null,
  section_activation_version integer not null,
  dto_revision integer not null,
  observation_id uuid not null,
  snapshot jsonb not null,
  validated_at timestamptz not null,
  primary key (character_id),
  constraint wallet_balance_snapshots_authority_check check (
    organization_version > 0
    and character_id > 0
    and authorization_generation >= 0
    and disclosure_version > 0
    and section_activation_version > 0
    and dto_revision > 0
  ),
  constraint wallet_balance_snapshots_shape_check check (jsonb_typeof(snapshot) = 'object')
);

create table wallet_journal_records (
  organization_version bigint not null,
  target_user_id uuid not null,
  managed_member_lifecycle_id uuid not null,
  character_id bigint not null,
  character_lifecycle_id uuid not null,
  authorization_generation integer not null,
  disclosure_version integer not null,
  section_activation_version integer not null,
  dto_revision integer not null,
  source_id text not null,
  source_timestamp timestamptz not null,
  expires_at timestamptz not null,
  evidence jsonb not null,
  validated_at timestamptz not null,
  primary key (
    organization_version,
    managed_member_lifecycle_id,
    character_lifecycle_id,
    authorization_generation,
    disclosure_version,
    section_activation_version,
    source_id
  ),
  constraint wallet_journal_records_authority_check check (
    organization_version > 0
    and character_id > 0
    and authorization_generation >= 0
    and disclosure_version > 0
    and section_activation_version > 0
    and dto_revision > 0
    and length(source_id) between 1 and 200
    and expires_at = source_timestamp + '90 days'::interval
  ),
  constraint wallet_journal_records_shape_check check (jsonb_typeof(evidence) = 'object')
);
create index wallet_journal_records_retention_idx
  on wallet_journal_records (expires_at);

create table wallet_transaction_records (
  organization_version bigint not null,
  target_user_id uuid not null,
  managed_member_lifecycle_id uuid not null,
  character_id bigint not null,
  character_lifecycle_id uuid not null,
  authorization_generation integer not null,
  disclosure_version integer not null,
  section_activation_version integer not null,
  dto_revision integer not null,
  source_id text not null,
  source_timestamp timestamptz not null,
  expires_at timestamptz not null,
  evidence jsonb not null,
  validated_at timestamptz not null,
  primary key (
    organization_version,
    managed_member_lifecycle_id,
    character_lifecycle_id,
    authorization_generation,
    disclosure_version,
    section_activation_version,
    source_id
  ),
  constraint wallet_transaction_records_authority_check check (
    organization_version > 0
    and character_id > 0
    and authorization_generation >= 0
    and disclosure_version > 0
    and section_activation_version > 0
    and dto_revision > 0
    and length(source_id) between 1 and 200
    and expires_at = source_timestamp + '90 days'::interval
  ),
  constraint wallet_transaction_records_shape_check check (jsonb_typeof(evidence) = 'object')
);
create index wallet_transaction_records_retention_idx
  on wallet_transaction_records (expires_at);

create table mail_headers (
  organization_version bigint not null,
  target_user_id uuid not null,
  managed_member_lifecycle_id uuid not null,
  character_id bigint not null,
  character_lifecycle_id uuid not null,
  authorization_generation integer not null,
  disclosure_version integer not null,
  section_activation_version integer not null,
  dto_revision integer not null,
  source_id text not null,
  source_timestamp timestamptz not null,
  expires_at timestamptz not null,
  evidence jsonb not null,
  validated_at timestamptz not null,
  primary key (
    organization_version,
    managed_member_lifecycle_id,
    character_lifecycle_id,
    authorization_generation,
    disclosure_version,
    section_activation_version,
    source_id
  ),
  constraint mail_headers_authority_check check (
    organization_version > 0
    and character_id > 0
    and authorization_generation >= 0
    and disclosure_version > 0
    and section_activation_version > 0
    and dto_revision > 0
    and length(source_id) between 1 and 200
    and expires_at = source_timestamp + '90 days'::interval
  ),
  constraint mail_headers_shape_check check (jsonb_typeof(evidence) = 'object')
);
create index mail_headers_retention_idx on mail_headers (expires_at);

create table mail_contents (
  organization_version bigint not null,
  target_user_id uuid not null,
  managed_member_lifecycle_id uuid not null,
  character_id bigint not null,
  character_lifecycle_id uuid not null,
  authorization_generation integer not null,
  disclosure_version integer not null,
  section_activation_version integer not null,
  dto_revision integer not null,
  source_id text not null,
  source_timestamp timestamptz not null,
  expires_at timestamptz not null,
  evidence jsonb not null,
  validated_at timestamptz not null,
  primary key (
    organization_version,
    managed_member_lifecycle_id,
    character_lifecycle_id,
    authorization_generation,
    disclosure_version,
    section_activation_version,
    source_id
  ),
  constraint mail_contents_authority_check check (
    organization_version > 0
    and character_id > 0
    and authorization_generation >= 0
    and disclosure_version > 0
    and section_activation_version > 0
    and dto_revision > 0
    and length(source_id) between 1 and 200
    and expires_at = source_timestamp + '90 days'::interval
  ),
  constraint mail_contents_shape_check check (jsonb_typeof(evidence) = 'object')
);
create index mail_contents_retention_idx on mail_contents (expires_at);

create table collection_continuations (
  section_id text not null,
  resource_id text not null,
  operation_contract_revision integer not null,
  resource_revision integer not null,
  organization_version bigint not null,
  target_user_id uuid not null,
  managed_member_lifecycle_id uuid not null,
  character_id bigint not null,
  character_lifecycle_id uuid not null,
  authorization_generation integer not null,
  disclosure_version integer not null,
  section_activation_version integer not null,
  observation_id uuid not null,
  revision bigint not null,
  checkpoint jsonb not null,
  updated_at timestamptz not null,
  primary key (
    section_id,
    resource_id,
    organization_version,
    managed_member_lifecycle_id,
    character_lifecycle_id,
    authorization_generation,
    disclosure_version,
    section_activation_version,
    observation_id
  ),
  unique (
    section_id,
    resource_id,
    organization_version,
    managed_member_lifecycle_id,
    character_lifecycle_id,
    authorization_generation,
    disclosure_version,
    section_activation_version
  ),
  constraint collection_continuations_identity_check check (
    section_id in ('assets', 'wallet', 'mail')
    and length(resource_id) between 1 and 100
    and operation_contract_revision > 0
    and resource_revision > 0
    and organization_version > 0
    and character_id > 0
    and authorization_generation >= 0
    and disclosure_version > 0
    and section_activation_version > 0
    and revision >= 0
  ),
  constraint collection_continuations_shape_check check (jsonb_typeof(checkpoint) = 'object')
);
create index collection_continuations_repair_idx
  on collection_continuations (updated_at, section_id, resource_id);

create table observation_staging (
  section_id text not null,
  resource_id text not null,
  operation_contract_revision integer not null,
  resource_revision integer not null,
  organization_version bigint not null,
  target_user_id uuid not null,
  managed_member_lifecycle_id uuid not null,
  character_id bigint not null,
  character_lifecycle_id uuid not null,
  authorization_generation integer not null,
  disclosure_version integer not null,
  section_activation_version integer not null,
  observation_id uuid not null,
  record_kind text not null,
  source_id text not null,
  source_timestamp timestamptz,
  evidence jsonb not null,
  validated_at timestamptz not null,
  primary key (observation_id, record_kind, source_id),
  constraint observation_staging_identity_check check (
    section_id in ('assets', 'wallet', 'mail')
    and length(resource_id) between 1 and 100
    and operation_contract_revision > 0
    and resource_revision > 0
    and organization_version > 0
    and character_id > 0
    and authorization_generation >= 0
    and disclosure_version > 0
    and section_activation_version > 0
    and length(record_kind) between 1 and 100
    and length(source_id) between 1 and 200
  ),
  constraint observation_staging_shape_check check (
    jsonb_typeof(evidence) in ('object', 'array')
  )
);
create index observation_staging_authority_idx on observation_staging (
  section_id,
  resource_id,
  organization_version,
  target_user_id,
  managed_member_lifecycle_id,
  character_id,
  character_lifecycle_id,
  authorization_generation,
  disclosure_version,
  section_activation_version,
  observation_id
);

create table promoted_observations (
  section_id text not null,
  resource_id text not null,
  operation_contract_revision integer not null,
  resource_revision integer not null,
  organization_version bigint not null,
  target_user_id uuid not null,
  managed_member_lifecycle_id uuid not null,
  character_id bigint not null,
  character_lifecycle_id uuid not null,
  authorization_generation integer not null,
  disclosure_version integer not null,
  section_activation_version integer not null,
  observation_id uuid not null,
  validated_at timestamptz not null,
  promoted_at timestamptz not null default now(),
  primary key (observation_id),
  constraint promoted_observations_identity_check check (
    section_id in ('assets', 'wallet', 'mail')
    and length(resource_id) between 1 and 100
    and operation_contract_revision > 0
    and resource_revision > 0
    and organization_version > 0
    and character_id > 0
    and authorization_generation >= 0
    and disclosure_version > 0
    and section_activation_version > 0
  )
);
create index promoted_observations_retention_idx on promoted_observations (promoted_at);
