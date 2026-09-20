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

create function eve_module_member_audit.persist_read_asset_evidence(input jsonb)
returns jsonb
language sql
stable
parallel unsafe
begin atomic
  select jsonb_build_object(
    'observationId'::text, asset.observation_id,
    'dtoRevision'::text, asset.dto_revision,
    'validatedAt'::text, asset.validated_at,
    'snapshot'::text, asset.snapshot
  )
  from asset_snapshots as asset
  where asset.organization_version = (input ->> 'organizationVersion'::text)::bigint
    and asset.target_user_id = (input ->> 'targetUserId'::text)::uuid
    and asset.managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
    and asset.character_id = (input ->> 'characterId'::text)::bigint
    and asset.character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
    and asset.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
    and asset.disclosure_version = (input ->> 'disclosureVersion'::text)::integer
    and asset.section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer;
end;

create function eve_module_member_audit.persist_read_wallet_evidence(input jsonb)
returns jsonb
language sql
stable
parallel unsafe
begin atomic
  select jsonb_build_object(
    'balance'::text,
    (
      select jsonb_build_object(
        'observationId'::text, balance.observation_id,
        'dtoRevision'::text, balance.dto_revision,
        'validatedAt'::text, balance.validated_at,
        'snapshot'::text, balance.snapshot
      )
      from wallet_balance_snapshots as balance
      where balance.organization_version = (input ->> 'organizationVersion'::text)::bigint
        and balance.target_user_id = (input ->> 'targetUserId'::text)::uuid
        and balance.managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
        and balance.character_id = (input ->> 'characterId'::text)::bigint
        and balance.character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
        and balance.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
        and balance.disclosure_version = (input ->> 'disclosureVersion'::text)::integer
        and balance.section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
    ),
    'journal'::text,
    (
      select coalesce(jsonb_agg(bounded_journal.evidence order by bounded_journal.source_timestamp desc, bounded_journal.source_id desc), '[]'::jsonb)
      from (
        select journal.evidence, journal.source_timestamp, journal.source_id
        from wallet_journal_records as journal
        where journal.organization_version = (input ->> 'organizationVersion'::text)::bigint
          and journal.target_user_id = (input ->> 'targetUserId'::text)::uuid
          and journal.managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
          and journal.character_id = (input ->> 'characterId'::text)::bigint
          and journal.character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
          and journal.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
          and journal.disclosure_version = (input ->> 'disclosureVersion'::text)::integer
          and journal.section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
          and journal.expires_at > now()
        order by journal.source_timestamp desc, journal.source_id desc
        limit (input ->> 'limit'::text)::integer
      ) as bounded_journal
    ),
    'transactions'::text,
    (
      select coalesce(jsonb_agg(bounded_transactions.evidence order by bounded_transactions.source_timestamp desc, bounded_transactions.source_id desc), '[]'::jsonb)
      from (
        select transaction_record.evidence, transaction_record.source_timestamp, transaction_record.source_id
        from wallet_transaction_records as transaction_record
        where transaction_record.organization_version = (input ->> 'organizationVersion'::text)::bigint
          and transaction_record.target_user_id = (input ->> 'targetUserId'::text)::uuid
          and transaction_record.managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
          and transaction_record.character_id = (input ->> 'characterId'::text)::bigint
          and transaction_record.character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
          and transaction_record.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
          and transaction_record.disclosure_version = (input ->> 'disclosureVersion'::text)::integer
          and transaction_record.section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
          and transaction_record.expires_at > now()
        order by transaction_record.source_timestamp desc, transaction_record.source_id desc
        limit (input ->> 'limit'::text)::integer
      ) as bounded_transactions
    )
  ) as result;
end;

create function eve_module_member_audit.persist_read_mail_evidence(input jsonb)
returns jsonb
language sql
stable
parallel unsafe
begin atomic
  select jsonb_build_object(
    'headers'::text,
    (
      select coalesce(jsonb_agg(bounded_headers.evidence order by bounded_headers.source_timestamp desc, bounded_headers.source_id desc), '[]'::jsonb)
      from (
        select header.evidence, header.source_timestamp, header.source_id
        from mail_headers as header
        where header.organization_version = (input ->> 'organizationVersion'::text)::bigint
          and header.target_user_id = (input ->> 'targetUserId'::text)::uuid
          and header.managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
          and header.character_id = (input ->> 'characterId'::text)::bigint
          and header.character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
          and header.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
          and header.disclosure_version = (input ->> 'disclosureVersion'::text)::integer
          and header.section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
          and header.expires_at > now()
        order by header.source_timestamp desc, header.source_id desc
        limit (input ->> 'limit'::text)::integer
      ) as bounded_headers
    ),
    'contents'::text,
    (
      select coalesce(jsonb_agg(bounded_contents.evidence order by bounded_contents.source_timestamp desc, bounded_contents.source_id desc), '[]'::jsonb)
      from (
        select content.evidence, content.source_timestamp, content.source_id
        from mail_contents as content
        where content.organization_version = (input ->> 'organizationVersion'::text)::bigint
          and content.target_user_id = (input ->> 'targetUserId'::text)::uuid
          and content.managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
          and content.character_id = (input ->> 'characterId'::text)::bigint
          and content.character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
          and content.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
          and content.disclosure_version = (input ->> 'disclosureVersion'::text)::integer
          and content.section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
          and content.expires_at > now()
        order by content.source_timestamp desc, content.source_id desc
        limit (input ->> 'limit'::text)::integer
      ) as bounded_contents
    )
  ) as result;
end;

create function eve_module_member_audit.persist_materialize_current_snapshot(input jsonb)
returns jsonb
language sql
volatile
parallel unsafe
begin atomic
  with trained as (
    insert into trained_skill_snapshots (
      organization_version, target_user_id, managed_member_lifecycle_id, character_id,
      character_lifecycle_id, authorization_generation, disclosure_version,
      section_activation_version, dto_revision, observation_id, snapshot, validated_at
    )
    select
      (input ->> 'organizationVersion'::text)::bigint as int8,
      (input ->> 'targetUserId'::text)::uuid as uuid,
      (input ->> 'managedMemberLifecycleId'::text)::uuid as uuid,
      (input ->> 'characterId'::text)::bigint as int8,
      (input ->> 'characterLifecycleId'::text)::uuid as uuid,
      (input ->> 'authorizationGeneration'::text)::integer as int4,
      (input ->> 'disclosureVersion'::text)::integer as int4,
      (input ->> 'sectionActivationVersion'::text)::integer as int4,
      (input ->> 'dtoRevision'::text)::integer as int4,
      (input ->> 'observationId'::text)::uuid as uuid,
      input -> 'snapshot'::text,
      (input ->> 'validatedAt'::text)::timestamptz as timestamptz
    where input ->> 'resourceId'::text = 'trained-skills'::text
    on conflict (character_id) do update
    set organization_version = excluded.organization_version,
        target_user_id = excluded.target_user_id,
        managed_member_lifecycle_id = excluded.managed_member_lifecycle_id,
        character_lifecycle_id = excluded.character_lifecycle_id,
        authorization_generation = excluded.authorization_generation,
        disclosure_version = excluded.disclosure_version,
        section_activation_version = excluded.section_activation_version,
        dto_revision = excluded.dto_revision,
        observation_id = excluded.observation_id,
        snapshot = excluded.snapshot,
        validated_at = excluded.validated_at
    where trained_skill_snapshots.validated_at < excluded.validated_at
      or trained_skill_snapshots.observation_id = excluded.observation_id
      or trained_skill_snapshots.organization_version <> excluded.organization_version
      or trained_skill_snapshots.target_user_id <> excluded.target_user_id
      or trained_skill_snapshots.managed_member_lifecycle_id <> excluded.managed_member_lifecycle_id
      or trained_skill_snapshots.character_lifecycle_id <> excluded.character_lifecycle_id
      or trained_skill_snapshots.authorization_generation <> excluded.authorization_generation
      or trained_skill_snapshots.disclosure_version <> excluded.disclosure_version
      or trained_skill_snapshots.section_activation_version <> excluded.section_activation_version
      or trained_skill_snapshots.organization_version <> excluded.organization_version
      or trained_skill_snapshots.target_user_id <> excluded.target_user_id
      or trained_skill_snapshots.managed_member_lifecycle_id <> excluded.managed_member_lifecycle_id
      or trained_skill_snapshots.character_lifecycle_id <> excluded.character_lifecycle_id
      or trained_skill_snapshots.authorization_generation <> excluded.authorization_generation
      or trained_skill_snapshots.disclosure_version <> excluded.disclosure_version
      or trained_skill_snapshots.section_activation_version <> excluded.section_activation_version
    returning 1 as "?column?"
  ), balance as (
    insert into wallet_balance_snapshots (
      organization_version, target_user_id, managed_member_lifecycle_id, character_id,
      character_lifecycle_id, authorization_generation, disclosure_version,
      section_activation_version, dto_revision, observation_id, snapshot, validated_at
    )
    select
      (input ->> 'organizationVersion'::text)::bigint as int8,
      (input ->> 'targetUserId'::text)::uuid as uuid,
      (input ->> 'managedMemberLifecycleId'::text)::uuid as uuid,
      (input ->> 'characterId'::text)::bigint as int8,
      (input ->> 'characterLifecycleId'::text)::uuid as uuid,
      (input ->> 'authorizationGeneration'::text)::integer as int4,
      (input ->> 'disclosureVersion'::text)::integer as int4,
      (input ->> 'sectionActivationVersion'::text)::integer as int4,
      (input ->> 'dtoRevision'::text)::integer as int4,
      (input ->> 'observationId'::text)::uuid as uuid,
      input -> 'snapshot'::text,
      (input ->> 'validatedAt'::text)::timestamptz as timestamptz
    where input ->> 'resourceId'::text = 'wallet-balance'::text
    on conflict (character_id) do update
    set organization_version = excluded.organization_version,
        target_user_id = excluded.target_user_id,
        managed_member_lifecycle_id = excluded.managed_member_lifecycle_id,
        character_lifecycle_id = excluded.character_lifecycle_id,
        authorization_generation = excluded.authorization_generation,
        disclosure_version = excluded.disclosure_version,
        section_activation_version = excluded.section_activation_version,
        dto_revision = excluded.dto_revision,
        observation_id = excluded.observation_id,
        snapshot = excluded.snapshot,
        validated_at = excluded.validated_at
    where wallet_balance_snapshots.validated_at < excluded.validated_at
      or wallet_balance_snapshots.observation_id = excluded.observation_id
      or wallet_balance_snapshots.organization_version <> excluded.organization_version
      or wallet_balance_snapshots.target_user_id <> excluded.target_user_id
      or wallet_balance_snapshots.managed_member_lifecycle_id <> excluded.managed_member_lifecycle_id
      or wallet_balance_snapshots.character_lifecycle_id <> excluded.character_lifecycle_id
      or wallet_balance_snapshots.authorization_generation <> excluded.authorization_generation
      or wallet_balance_snapshots.disclosure_version <> excluded.disclosure_version
      or wallet_balance_snapshots.section_activation_version <> excluded.section_activation_version
      or wallet_balance_snapshots.organization_version <> excluded.organization_version
      or wallet_balance_snapshots.target_user_id <> excluded.target_user_id
      or wallet_balance_snapshots.managed_member_lifecycle_id <> excluded.managed_member_lifecycle_id
      or wallet_balance_snapshots.character_lifecycle_id <> excluded.character_lifecycle_id
      or wallet_balance_snapshots.authorization_generation <> excluded.authorization_generation
      or wallet_balance_snapshots.disclosure_version <> excluded.disclosure_version
      or wallet_balance_snapshots.section_activation_version <> excluded.section_activation_version
    returning 1 as "?column?"
  )
  select jsonb_build_object(
    'outcome'::text,
    case
      when exists (select from trained)
        or exists (select from balance)
        then 'applied'::text
      else 'obsolete'::text
    end
  ) as result;
end;

create function eve_module_member_audit.persist_read_evidence_continuation(input jsonb)
returns jsonb
language sql
stable
parallel unsafe
begin atomic
  select jsonb_build_object(
    'revision'::text, continuation.revision,
    'checkpoint'::text, continuation.checkpoint
  ) as result
  from collection_continuations as continuation
  where continuation.section_id = input ->> 'sectionId'::text
    and continuation.resource_id = input ->> 'resourceId'::text
    and continuation.operation_contract_revision = (input ->> 'operationContractRevision'::text)::integer
    and continuation.resource_revision = (input ->> 'resourceRevision'::text)::integer
    and continuation.organization_version = (input ->> 'organizationVersion'::text)::bigint
    and continuation.target_user_id = (input ->> 'targetUserId'::text)::uuid
    and continuation.managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
    and continuation.character_id = (input ->> 'characterId'::text)::bigint
    and continuation.character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
    and continuation.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
    and continuation.disclosure_version = (input ->> 'disclosureVersion'::text)::integer
    and continuation.section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
    and continuation.observation_id = (input ->> 'observationId'::text)::uuid;
end;

create function eve_module_member_audit.persist_write_evidence_continuation(input jsonb)
returns jsonb
language sql
volatile
parallel unsafe
begin atomic
  with prior as materialized (
    select existing.observation_id
    from collection_continuations as existing
    where existing.section_id = input ->> 'sectionId'::text
      and existing.resource_id = input ->> 'resourceId'::text
      and existing.organization_version = (input ->> 'organizationVersion'::text)::bigint
      and existing.managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
      and existing.character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
      and existing.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
      and existing.disclosure_version = (input ->> 'disclosureVersion'::text)::integer
      and existing.section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
  ), persisted as (
    insert into collection_continuations (
      section_id, resource_id, operation_contract_revision, resource_revision,
      organization_version, target_user_id, managed_member_lifecycle_id, character_id,
      character_lifecycle_id, authorization_generation, disclosure_version,
      section_activation_version, observation_id, revision, checkpoint, updated_at
    )
    select
      input ->> 'sectionId'::text,
      input ->> 'resourceId'::text,
      (input ->> 'operationContractRevision'::text)::integer,
      (input ->> 'resourceRevision'::text)::integer,
      (input ->> 'organizationVersion'::text)::bigint,
      (input ->> 'targetUserId'::text)::uuid,
      (input ->> 'managedMemberLifecycleId'::text)::uuid,
      (input ->> 'characterId'::text)::bigint,
      (input ->> 'characterLifecycleId'::text)::uuid,
      (input ->> 'authorizationGeneration'::text)::integer,
      (input ->> 'disclosureVersion'::text)::integer,
      (input ->> 'sectionActivationVersion'::text)::integer,
      (input ->> 'observationId'::text)::uuid,
      (input ->> 'expectedRevision'::text)::bigint + 1,
      input -> 'checkpoint'::text,
      (input ->> 'updatedAt'::text)::timestamptz
    where not exists (
      select from promoted_observations as promoted
      where promoted.observation_id = (input ->> 'observationId'::text)::uuid
    )
      and (
        (input ->> 'expectedRevision'::text)::bigint = 0
        or exists (
          select from collection_continuations as existing
          where existing.section_id = input ->> 'sectionId'::text
            and existing.resource_id = input ->> 'resourceId'::text
            and existing.operation_contract_revision = (input ->> 'operationContractRevision'::text)::integer
            and existing.resource_revision = (input ->> 'resourceRevision'::text)::integer
            and existing.organization_version = (input ->> 'organizationVersion'::text)::bigint
            and existing.target_user_id = (input ->> 'targetUserId'::text)::uuid
            and existing.managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
            and existing.character_id = (input ->> 'characterId'::text)::bigint
            and existing.character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
            and existing.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
            and existing.disclosure_version = (input ->> 'disclosureVersion'::text)::integer
            and existing.section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
            and existing.observation_id = (input ->> 'observationId'::text)::uuid
            and existing.revision = (input ->> 'expectedRevision'::text)::bigint
        )
      )
    on conflict (
      section_id, resource_id, organization_version, managed_member_lifecycle_id,
      character_lifecycle_id, authorization_generation, disclosure_version,
      section_activation_version
    ) do update
    set operation_contract_revision = excluded.operation_contract_revision,
        resource_revision = excluded.resource_revision,
        target_user_id = excluded.target_user_id,
        character_id = excluded.character_id,
        observation_id = excluded.observation_id,
        revision = excluded.revision,
        checkpoint = excluded.checkpoint,
        updated_at = excluded.updated_at
    where collection_continuations.target_user_id = excluded.target_user_id
      and collection_continuations.character_id = excluded.character_id
      and (
        (
          collection_continuations.observation_id = excluded.observation_id
          and collection_continuations.operation_contract_revision = excluded.operation_contract_revision
          and collection_continuations.resource_revision = excluded.resource_revision
          and collection_continuations.revision = (input ->> 'expectedRevision'::text)::bigint
        )
        or (
          (input ->> 'expectedRevision'::text)::bigint = 0
          and (
            collection_continuations.operation_contract_revision
              <> excluded.operation_contract_revision
            or collection_continuations.resource_revision <> excluded.resource_revision
          )
        )
      )
    returning 1 as "?column?"
  ), discarded as (
    delete from observation_staging
    where observation_id in (select observation_id from prior)
      and observation_id <> (input ->> 'observationId'::text)::uuid
      and exists (select from persisted)
    returning 1 as "?column?"
  ), staged as (
    insert into observation_staging (
      section_id, resource_id, operation_contract_revision, resource_revision,
      organization_version, target_user_id, managed_member_lifecycle_id, character_id,
      character_lifecycle_id, authorization_generation, disclosure_version,
      section_activation_version, observation_id, record_kind, source_id,
      source_timestamp, evidence, validated_at
    )
    select
      input ->> 'sectionId'::text,
      input ->> 'resourceId'::text,
      (input ->> 'operationContractRevision'::text)::integer as int4,
      (input ->> 'resourceRevision'::text)::integer as int4,
      (input ->> 'organizationVersion'::text)::bigint as int8,
      (input ->> 'targetUserId'::text)::uuid as uuid,
      (input ->> 'managedMemberLifecycleId'::text)::uuid as uuid,
      (input ->> 'characterId'::text)::bigint as int8,
      (input ->> 'characterLifecycleId'::text)::uuid as uuid,
      (input ->> 'authorizationGeneration'::text)::integer as int4,
      (input ->> 'disclosureVersion'::text)::integer as int4,
      (input ->> 'sectionActivationVersion'::text)::integer as int4,
      (input ->> 'observationId'::text)::uuid as uuid,
      record.value ->> 'recordKind'::text,
      record.value ->> 'sourceId'::text,
      (record.value ->> 'sourceTimestamp'::text)::timestamptz as timestamptz,
      record.value -> 'evidence'::text,
      (record.value ->> 'validatedAt'::text)::timestamptz as timestamptz
    from jsonb_array_elements(input -> 'records'::text) as record(value)
    where exists (select from persisted)
    on conflict (observation_id, record_kind, source_id) do update
    set source_timestamp = excluded.source_timestamp,
        evidence = excluded.evidence,
        validated_at = excluded.validated_at
    where observation_staging.validated_at <= excluded.validated_at
    returning 1 as "?column?"
  )
  select jsonb_build_object(
    'outcome'::text,
    case when exists (select from persisted) then 'applied'::text else 'obsolete'::text end,
    'revision'::text,
    case
      when exists (select from persisted)
        then (input ->> 'expectedRevision'::text)::bigint + 1
      else null::bigint
    end
  ) - case when exists (select from persisted) then ''::text else 'revision'::text end as result;
end;

create function eve_module_member_audit.persist_promote_evidence_observation(input jsonb)
returns jsonb
language sql
volatile
parallel unsafe
begin atomic
  insert into asset_snapshots (
    organization_version, target_user_id, managed_member_lifecycle_id, character_id,
    character_lifecycle_id, authorization_generation, disclosure_version,
    section_activation_version, dto_revision, observation_id, snapshot, validated_at
  )
  select
    continuation.organization_version,
    continuation.target_user_id,
    continuation.managed_member_lifecycle_id,
    continuation.character_id,
    continuation.character_lifecycle_id,
    continuation.authorization_generation,
    continuation.disclosure_version,
    continuation.section_activation_version,
    (input ->> 'dtoRevision'::text)::integer,
    continuation.observation_id,
    jsonb_build_object(
      'kind'::text,
      'assets'::text,
      'records'::text,
      coalesce(
        jsonb_agg(staged.evidence order by staged.source_id)
          filter (where staged.source_id is not null),
        '[]'::jsonb
      )
    ),
    (input ->> 'validatedAt'::text)::timestamptz
  from collection_continuations as continuation
  left join observation_staging as staged
    on staged.observation_id = continuation.observation_id
    and staged.record_kind = 'asset'::text
  where continuation.observation_id = (input ->> 'observationId'::text)::uuid
    and continuation.section_id = 'assets'::text
    and continuation.resource_id = 'assets'::text
    and continuation.revision = (input ->> 'expectedRevision'::text)::bigint
    and continuation.operation_contract_revision = (input ->> 'operationContractRevision'::text)::integer
    and continuation.resource_revision = (input ->> 'resourceRevision'::text)::integer
    and continuation.organization_version = (input ->> 'organizationVersion'::text)::bigint
    and continuation.target_user_id = (input ->> 'targetUserId'::text)::uuid
    and continuation.managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
    and continuation.character_id = (input ->> 'characterId'::text)::bigint
    and continuation.character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
    and continuation.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
    and continuation.disclosure_version = (input ->> 'disclosureVersion'::text)::integer
    and continuation.section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
    and continuation.checkpoint @> '{"complete": true}'::jsonb
  group by continuation.observation_id, continuation.organization_version,
    continuation.target_user_id, continuation.managed_member_lifecycle_id,
    continuation.character_id, continuation.character_lifecycle_id,
    continuation.authorization_generation, continuation.disclosure_version,
    continuation.section_activation_version
  on conflict (character_id) do update
  set organization_version = excluded.organization_version,
      target_user_id = excluded.target_user_id,
      managed_member_lifecycle_id = excluded.managed_member_lifecycle_id,
      character_lifecycle_id = excluded.character_lifecycle_id,
      authorization_generation = excluded.authorization_generation,
      disclosure_version = excluded.disclosure_version,
      section_activation_version = excluded.section_activation_version,
      dto_revision = excluded.dto_revision,
      observation_id = excluded.observation_id,
      snapshot = excluded.snapshot,
      validated_at = excluded.validated_at
  where asset_snapshots.validated_at < excluded.validated_at
    or asset_snapshots.observation_id = excluded.observation_id
    or asset_snapshots.organization_version <> excluded.organization_version
    or asset_snapshots.target_user_id <> excluded.target_user_id
    or asset_snapshots.managed_member_lifecycle_id <> excluded.managed_member_lifecycle_id
    or asset_snapshots.character_lifecycle_id <> excluded.character_lifecycle_id
    or asset_snapshots.authorization_generation <> excluded.authorization_generation
    or asset_snapshots.disclosure_version <> excluded.disclosure_version
    or asset_snapshots.section_activation_version <> excluded.section_activation_version;

  delete from wallet_journal_records
  where wallet_journal_records.organization_version = (input ->> 'organizationVersion'::text)::bigint
    and wallet_journal_records.target_user_id = (input ->> 'targetUserId'::text)::uuid
    and wallet_journal_records.managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
    and wallet_journal_records.character_id = (input ->> 'characterId'::text)::bigint
    and wallet_journal_records.character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
    and wallet_journal_records.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
    and wallet_journal_records.disclosure_version = (input ->> 'disclosureVersion'::text)::integer
    and wallet_journal_records.section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
    and input ->> 'resourceId'::text = 'wallet-journal'::text
    and exists (
      select from collection_continuations as active
      where active.observation_id = (input ->> 'observationId'::text)::uuid
        and active.section_id = input ->> 'sectionId'::text
        and active.resource_id = input ->> 'resourceId'::text
        and active.revision = (input ->> 'expectedRevision'::text)::bigint
        and active.operation_contract_revision = (input ->> 'operationContractRevision'::text)::integer
        and active.resource_revision = (input ->> 'resourceRevision'::text)::integer
        and active.organization_version = (input ->> 'organizationVersion'::text)::bigint
        and active.target_user_id = (input ->> 'targetUserId'::text)::uuid
        and active.managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
        and active.character_id = (input ->> 'characterId'::text)::bigint
        and active.character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
        and active.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
        and active.disclosure_version = (input ->> 'disclosureVersion'::text)::integer
        and active.section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
        and active.checkpoint @> '{"complete": true}'::jsonb
        and not exists (
          select from observation_staging as invalid
          where invalid.observation_id = active.observation_id
            and invalid.record_kind = 'wallet-journal'::text
            and (invalid.source_timestamp is null or invalid.source_timestamp > now())
        )
    );
  insert into wallet_journal_records (
    organization_version, target_user_id, managed_member_lifecycle_id, character_id,
    character_lifecycle_id, authorization_generation, disclosure_version,
    section_activation_version, dto_revision, source_id, source_timestamp, expires_at,
    evidence, validated_at
  )
  select
    staged.organization_version, staged.target_user_id, staged.managed_member_lifecycle_id,
    staged.character_id, staged.character_lifecycle_id, staged.authorization_generation,
    staged.disclosure_version, staged.section_activation_version,
    (input ->> 'dtoRevision'::text)::integer, staged.source_id, staged.source_timestamp,
    staged.source_timestamp + '90 days'::interval, staged.evidence, staged.validated_at
  from observation_staging as staged
  join collection_continuations as continuation
    on continuation.observation_id = staged.observation_id
  where staged.observation_id = (input ->> 'observationId'::text)::uuid
    and staged.record_kind = 'wallet-journal'::text
    and continuation.section_id = input ->> 'sectionId'::text
    and continuation.resource_id = 'wallet-journal'::text
    and continuation.revision = (input ->> 'expectedRevision'::text)::bigint
    and continuation.operation_contract_revision = (input ->> 'operationContractRevision'::text)::integer
    and continuation.resource_revision = (input ->> 'resourceRevision'::text)::integer
    and continuation.organization_version = (input ->> 'organizationVersion'::text)::bigint
    and continuation.target_user_id = (input ->> 'targetUserId'::text)::uuid
    and continuation.managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
    and continuation.character_id = (input ->> 'characterId'::text)::bigint
    and continuation.character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
    and continuation.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
    and continuation.disclosure_version = (input ->> 'disclosureVersion'::text)::integer
    and continuation.section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
    and continuation.checkpoint @> '{"complete": true}'::jsonb
    and staged.source_timestamp > now() - '90 days'::interval
    and staged.source_timestamp <= now()
    and not exists (
      select from observation_staging as invalid
      where invalid.observation_id = continuation.observation_id
        and invalid.record_kind = 'wallet-journal'::text
        and (invalid.source_timestamp is null or invalid.source_timestamp > now())
    )
  on conflict do nothing;

  delete from wallet_transaction_records
  where wallet_transaction_records.organization_version = (input ->> 'organizationVersion'::text)::bigint
    and wallet_transaction_records.target_user_id = (input ->> 'targetUserId'::text)::uuid
    and wallet_transaction_records.managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
    and wallet_transaction_records.character_id = (input ->> 'characterId'::text)::bigint
    and wallet_transaction_records.character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
    and wallet_transaction_records.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
    and wallet_transaction_records.disclosure_version = (input ->> 'disclosureVersion'::text)::integer
    and wallet_transaction_records.section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
    and input ->> 'resourceId'::text = 'wallet-transactions'::text
    and exists (
      select from collection_continuations as active
      where active.observation_id = (input ->> 'observationId'::text)::uuid
        and active.section_id = input ->> 'sectionId'::text
        and active.resource_id = input ->> 'resourceId'::text
        and active.revision = (input ->> 'expectedRevision'::text)::bigint
        and active.operation_contract_revision = (input ->> 'operationContractRevision'::text)::integer
        and active.resource_revision = (input ->> 'resourceRevision'::text)::integer
        and active.organization_version = (input ->> 'organizationVersion'::text)::bigint
        and active.target_user_id = (input ->> 'targetUserId'::text)::uuid
        and active.managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
        and active.character_id = (input ->> 'characterId'::text)::bigint
        and active.character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
        and active.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
        and active.disclosure_version = (input ->> 'disclosureVersion'::text)::integer
        and active.section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
        and active.checkpoint @> '{"complete": true}'::jsonb
        and not exists (
          select from observation_staging as invalid
          where invalid.observation_id = active.observation_id
            and invalid.record_kind = 'wallet-transaction'::text
            and (invalid.source_timestamp is null or invalid.source_timestamp > now())
        )
    );
  insert into wallet_transaction_records (
    organization_version, target_user_id, managed_member_lifecycle_id, character_id,
    character_lifecycle_id, authorization_generation, disclosure_version,
    section_activation_version, dto_revision, source_id, source_timestamp, expires_at,
    evidence, validated_at
  )
  select
    staged.organization_version, staged.target_user_id, staged.managed_member_lifecycle_id,
    staged.character_id, staged.character_lifecycle_id, staged.authorization_generation,
    staged.disclosure_version, staged.section_activation_version,
    (input ->> 'dtoRevision'::text)::integer, staged.source_id, staged.source_timestamp,
    staged.source_timestamp + '90 days'::interval, staged.evidence, staged.validated_at
  from observation_staging as staged
  join collection_continuations as continuation
    on continuation.observation_id = staged.observation_id
  where staged.observation_id = (input ->> 'observationId'::text)::uuid
    and staged.record_kind = 'wallet-transaction'::text
    and continuation.section_id = input ->> 'sectionId'::text
    and continuation.resource_id = 'wallet-transactions'::text
    and continuation.revision = (input ->> 'expectedRevision'::text)::bigint
    and continuation.operation_contract_revision = (input ->> 'operationContractRevision'::text)::integer
    and continuation.resource_revision = (input ->> 'resourceRevision'::text)::integer
    and continuation.organization_version = (input ->> 'organizationVersion'::text)::bigint
    and continuation.target_user_id = (input ->> 'targetUserId'::text)::uuid
    and continuation.managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
    and continuation.character_id = (input ->> 'characterId'::text)::bigint
    and continuation.character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
    and continuation.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
    and continuation.disclosure_version = (input ->> 'disclosureVersion'::text)::integer
    and continuation.section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
    and continuation.checkpoint @> '{"complete": true}'::jsonb
    and staged.source_timestamp > now() - '90 days'::interval
    and staged.source_timestamp <= now()
    and not exists (
      select from observation_staging as invalid
      where invalid.observation_id = continuation.observation_id
        and invalid.record_kind = 'wallet-transaction'::text
        and (invalid.source_timestamp is null or invalid.source_timestamp > now())
    )
  on conflict do nothing;

  delete from mail_headers
  where mail_headers.organization_version = (input ->> 'organizationVersion'::text)::bigint
    and mail_headers.target_user_id = (input ->> 'targetUserId'::text)::uuid
    and mail_headers.managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
    and mail_headers.character_id = (input ->> 'characterId'::text)::bigint
    and mail_headers.character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
    and mail_headers.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
    and mail_headers.disclosure_version = (input ->> 'disclosureVersion'::text)::integer
    and mail_headers.section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
    and input ->> 'resourceId'::text = 'mail-headers'::text
    and exists (
      select from collection_continuations as active
      where active.observation_id = (input ->> 'observationId'::text)::uuid
        and active.section_id = input ->> 'sectionId'::text
        and active.resource_id = input ->> 'resourceId'::text
        and active.revision = (input ->> 'expectedRevision'::text)::bigint
        and active.operation_contract_revision = (input ->> 'operationContractRevision'::text)::integer
        and active.resource_revision = (input ->> 'resourceRevision'::text)::integer
        and active.organization_version = (input ->> 'organizationVersion'::text)::bigint
        and active.target_user_id = (input ->> 'targetUserId'::text)::uuid
        and active.managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
        and active.character_id = (input ->> 'characterId'::text)::bigint
        and active.character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
        and active.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
        and active.disclosure_version = (input ->> 'disclosureVersion'::text)::integer
        and active.section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
        and active.checkpoint @> '{"complete": true}'::jsonb
        and not exists (
          select from observation_staging as invalid
          where invalid.observation_id = active.observation_id
            and invalid.record_kind = 'mail-header'::text
            and (invalid.source_timestamp is null or invalid.source_timestamp > now())
        )
    );
  insert into mail_headers (
    organization_version, target_user_id, managed_member_lifecycle_id, character_id,
    character_lifecycle_id, authorization_generation, disclosure_version,
    section_activation_version, dto_revision, source_id, source_timestamp, expires_at,
    evidence, validated_at
  )
  select
    staged.organization_version, staged.target_user_id, staged.managed_member_lifecycle_id,
    staged.character_id, staged.character_lifecycle_id, staged.authorization_generation,
    staged.disclosure_version, staged.section_activation_version,
    (input ->> 'dtoRevision'::text)::integer, staged.source_id, staged.source_timestamp,
    staged.source_timestamp + '90 days'::interval, staged.evidence, staged.validated_at
  from observation_staging as staged
  join collection_continuations as continuation
    on continuation.observation_id = staged.observation_id
  where staged.observation_id = (input ->> 'observationId'::text)::uuid
    and staged.record_kind = 'mail-header'::text
    and continuation.section_id = input ->> 'sectionId'::text
    and continuation.resource_id = 'mail-headers'::text
    and continuation.revision = (input ->> 'expectedRevision'::text)::bigint
    and continuation.operation_contract_revision = (input ->> 'operationContractRevision'::text)::integer
    and continuation.resource_revision = (input ->> 'resourceRevision'::text)::integer
    and continuation.organization_version = (input ->> 'organizationVersion'::text)::bigint
    and continuation.target_user_id = (input ->> 'targetUserId'::text)::uuid
    and continuation.managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
    and continuation.character_id = (input ->> 'characterId'::text)::bigint
    and continuation.character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
    and continuation.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
    and continuation.disclosure_version = (input ->> 'disclosureVersion'::text)::integer
    and continuation.section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
    and continuation.checkpoint @> '{"complete": true}'::jsonb
    and staged.source_timestamp > now() - '90 days'::interval
    and staged.source_timestamp <= now()
    and not exists (
      select from observation_staging as invalid
      where invalid.observation_id = continuation.observation_id
        and invalid.record_kind = 'mail-header'::text
        and (invalid.source_timestamp is null or invalid.source_timestamp > now())
    )
  on conflict do nothing;

  delete from mail_contents
  where mail_contents.organization_version = (input ->> 'organizationVersion'::text)::bigint
    and mail_contents.target_user_id = (input ->> 'targetUserId'::text)::uuid
    and mail_contents.managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
    and mail_contents.character_id = (input ->> 'characterId'::text)::bigint
    and mail_contents.character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
    and mail_contents.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
    and mail_contents.disclosure_version = (input ->> 'disclosureVersion'::text)::integer
    and mail_contents.section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
    and input ->> 'resourceId'::text = 'mail-details'::text
    and exists (
      select from collection_continuations as active
      where active.observation_id = (input ->> 'observationId'::text)::uuid
        and active.section_id = input ->> 'sectionId'::text
        and active.resource_id = input ->> 'resourceId'::text
        and active.revision = (input ->> 'expectedRevision'::text)::bigint
        and active.operation_contract_revision = (input ->> 'operationContractRevision'::text)::integer
        and active.resource_revision = (input ->> 'resourceRevision'::text)::integer
        and active.organization_version = (input ->> 'organizationVersion'::text)::bigint
        and active.target_user_id = (input ->> 'targetUserId'::text)::uuid
        and active.managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
        and active.character_id = (input ->> 'characterId'::text)::bigint
        and active.character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
        and active.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
        and active.disclosure_version = (input ->> 'disclosureVersion'::text)::integer
        and active.section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
        and active.checkpoint @> '{"complete": true}'::jsonb
        and not exists (
          select from observation_staging as invalid
          where invalid.observation_id = active.observation_id
            and invalid.record_kind = 'mail-content'::text
            and not exists (
              select from mail_headers as retained_header
              where retained_header.organization_version = invalid.organization_version
                and retained_header.target_user_id = invalid.target_user_id
                and retained_header.managed_member_lifecycle_id
                  = invalid.managed_member_lifecycle_id
                and retained_header.character_id = invalid.character_id
                and retained_header.character_lifecycle_id = invalid.character_lifecycle_id
                and retained_header.authorization_generation = invalid.authorization_generation
                and retained_header.disclosure_version = invalid.disclosure_version
                and retained_header.section_activation_version
                  = invalid.section_activation_version
                and retained_header.source_id = invalid.source_id
                and retained_header.source_timestamp > now() - '90 days'::interval
                and retained_header.source_timestamp <= now()
            )
        )
    );
  insert into mail_contents (
    organization_version, target_user_id, managed_member_lifecycle_id, character_id,
    character_lifecycle_id, authorization_generation, disclosure_version,
    section_activation_version, dto_revision, source_id, source_timestamp, expires_at,
    evidence, validated_at
  )
  select
    staged.organization_version, staged.target_user_id, staged.managed_member_lifecycle_id,
    staged.character_id, staged.character_lifecycle_id, staged.authorization_generation,
    staged.disclosure_version, staged.section_activation_version,
    (input ->> 'dtoRevision'::text)::integer, staged.source_id,
    retained_header.source_timestamp,
    retained_header.source_timestamp + '90 days'::interval,
    staged.evidence, staged.validated_at
  from observation_staging as staged
  join collection_continuations as continuation
    on continuation.observation_id = staged.observation_id
  join mail_headers as retained_header
    on retained_header.organization_version = staged.organization_version
    and retained_header.target_user_id = staged.target_user_id
    and retained_header.managed_member_lifecycle_id = staged.managed_member_lifecycle_id
    and retained_header.character_id = staged.character_id
    and retained_header.character_lifecycle_id = staged.character_lifecycle_id
    and retained_header.authorization_generation = staged.authorization_generation
    and retained_header.disclosure_version = staged.disclosure_version
    and retained_header.section_activation_version = staged.section_activation_version
    and retained_header.source_id = staged.source_id
  where staged.observation_id = (input ->> 'observationId'::text)::uuid
    and staged.record_kind = 'mail-content'::text
    and continuation.section_id = input ->> 'sectionId'::text
    and continuation.resource_id = 'mail-details'::text
    and continuation.revision = (input ->> 'expectedRevision'::text)::bigint
    and continuation.operation_contract_revision = (input ->> 'operationContractRevision'::text)::integer
    and continuation.resource_revision = (input ->> 'resourceRevision'::text)::integer
    and continuation.organization_version = (input ->> 'organizationVersion'::text)::bigint
    and continuation.target_user_id = (input ->> 'targetUserId'::text)::uuid
    and continuation.managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
    and continuation.character_id = (input ->> 'characterId'::text)::bigint
    and continuation.character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
    and continuation.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
    and continuation.disclosure_version = (input ->> 'disclosureVersion'::text)::integer
    and continuation.section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
    and continuation.checkpoint @> '{"complete": true}'::jsonb
    and retained_header.source_timestamp > now() - '90 days'::interval
    and retained_header.source_timestamp <= now()
    and not exists (
      select from observation_staging as invalid
      where invalid.observation_id = continuation.observation_id
        and invalid.record_kind = 'mail-content'::text
        and not exists (
          select from mail_headers as matching_header
          where matching_header.organization_version = invalid.organization_version
            and matching_header.target_user_id = invalid.target_user_id
            and matching_header.managed_member_lifecycle_id = invalid.managed_member_lifecycle_id
            and matching_header.character_id = invalid.character_id
            and matching_header.character_lifecycle_id = invalid.character_lifecycle_id
            and matching_header.authorization_generation = invalid.authorization_generation
            and matching_header.disclosure_version = invalid.disclosure_version
            and matching_header.section_activation_version = invalid.section_activation_version
            and matching_header.source_id = invalid.source_id
            and matching_header.source_timestamp > now() - '90 days'::interval
            and matching_header.source_timestamp <= now()
        )
    )
  on conflict do nothing;

  insert into promoted_observations (
    section_id, resource_id, operation_contract_revision, resource_revision,
    organization_version, target_user_id, managed_member_lifecycle_id, character_id,
    character_lifecycle_id, authorization_generation, disclosure_version,
    section_activation_version, observation_id, validated_at
  )
  select
    continuation.section_id, continuation.resource_id,
    continuation.operation_contract_revision, continuation.resource_revision,
    continuation.organization_version, continuation.target_user_id,
    continuation.managed_member_lifecycle_id, continuation.character_id,
    continuation.character_lifecycle_id, continuation.authorization_generation,
    continuation.disclosure_version, continuation.section_activation_version,
    continuation.observation_id,
    (input ->> 'validatedAt'::text)::timestamptz
  from collection_continuations as continuation
  where continuation.observation_id = (input ->> 'observationId'::text)::uuid
    and continuation.section_id = input ->> 'sectionId'::text
    and continuation.resource_id = input ->> 'resourceId'::text
    and continuation.revision = (input ->> 'expectedRevision'::text)::bigint
    and continuation.operation_contract_revision = (input ->> 'operationContractRevision'::text)::integer
    and continuation.resource_revision = (input ->> 'resourceRevision'::text)::integer
    and continuation.organization_version = (input ->> 'organizationVersion'::text)::bigint
    and continuation.target_user_id = (input ->> 'targetUserId'::text)::uuid
    and continuation.managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
    and continuation.character_id = (input ->> 'characterId'::text)::bigint
    and continuation.character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
    and continuation.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
    and continuation.disclosure_version = (input ->> 'disclosureVersion'::text)::integer
    and continuation.section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
    and continuation.checkpoint @> '{"complete": true}'::jsonb
    and not exists (
      select from observation_staging as invalid
      where invalid.observation_id = continuation.observation_id
        and invalid.record_kind = case continuation.resource_id
          when 'wallet-journal'::text then 'wallet-journal'::text
          when 'wallet-transactions'::text then 'wallet-transaction'::text
          when 'mail-headers'::text then 'mail-header'::text
          when 'mail-details'::text then 'mail-content'::text
          else null::text
        end
        and (
          (
            continuation.resource_id <> 'mail-details'::text
            and (invalid.source_timestamp is null or invalid.source_timestamp > now())
          )
          or (
            continuation.resource_id = 'mail-details'::text
            and not exists (
              select from mail_headers as retained_header
              where retained_header.organization_version = invalid.organization_version
                and retained_header.target_user_id = invalid.target_user_id
                and retained_header.managed_member_lifecycle_id
                  = invalid.managed_member_lifecycle_id
                and retained_header.character_id = invalid.character_id
                and retained_header.character_lifecycle_id = invalid.character_lifecycle_id
                and retained_header.authorization_generation = invalid.authorization_generation
                and retained_header.disclosure_version = invalid.disclosure_version
                and retained_header.section_activation_version
                  = invalid.section_activation_version
                and retained_header.source_id = invalid.source_id
                and retained_header.source_timestamp > now() - '90 days'::interval
                and retained_header.source_timestamp <= now()
            )
          )
        )
    )
    and (
      continuation.resource_id <> 'assets'::text
      or exists (
        select from asset_snapshots as promoted_asset
        where promoted_asset.observation_id = continuation.observation_id
          and promoted_asset.organization_version = continuation.organization_version
          and promoted_asset.target_user_id = continuation.target_user_id
          and promoted_asset.managed_member_lifecycle_id = continuation.managed_member_lifecycle_id
          and promoted_asset.character_id = continuation.character_id
          and promoted_asset.character_lifecycle_id = continuation.character_lifecycle_id
          and promoted_asset.authorization_generation = continuation.authorization_generation
          and promoted_asset.disclosure_version = continuation.disclosure_version
          and promoted_asset.section_activation_version = continuation.section_activation_version
      )
    )
  on conflict (observation_id) do nothing;

  delete from observation_staging
  where observation_staging.observation_id = (input ->> 'observationId'::text)::uuid
    and exists (
      select from promoted_observations as promoted
      where promoted.observation_id = (input ->> 'observationId'::text)::uuid
        and promoted.section_id = input ->> 'sectionId'::text
        and promoted.resource_id = input ->> 'resourceId'::text
        and promoted.operation_contract_revision = (input ->> 'operationContractRevision'::text)::integer
        and promoted.resource_revision = (input ->> 'resourceRevision'::text)::integer
        and promoted.organization_version = (input ->> 'organizationVersion'::text)::bigint
        and promoted.target_user_id = (input ->> 'targetUserId'::text)::uuid
        and promoted.managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
        and promoted.character_id = (input ->> 'characterId'::text)::bigint
        and promoted.character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
        and promoted.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
        and promoted.disclosure_version = (input ->> 'disclosureVersion'::text)::integer
        and promoted.section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
    );
  delete from collection_continuations
  where collection_continuations.observation_id = (input ->> 'observationId'::text)::uuid
    and exists (
      select from promoted_observations as promoted
      where promoted.observation_id = (input ->> 'observationId'::text)::uuid
        and promoted.section_id = input ->> 'sectionId'::text
        and promoted.resource_id = input ->> 'resourceId'::text
        and promoted.operation_contract_revision = (input ->> 'operationContractRevision'::text)::integer
        and promoted.resource_revision = (input ->> 'resourceRevision'::text)::integer
        and promoted.organization_version = (input ->> 'organizationVersion'::text)::bigint
        and promoted.target_user_id = (input ->> 'targetUserId'::text)::uuid
        and promoted.managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
        and promoted.character_id = (input ->> 'characterId'::text)::bigint
        and promoted.character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
        and promoted.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
        and promoted.disclosure_version = (input ->> 'disclosureVersion'::text)::integer
        and promoted.section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
    );

  select jsonb_build_object(
    'outcome'::text,
    case
      when exists (
        select from promoted_observations as promoted
        where promoted.observation_id = (input ->> 'observationId'::text)::uuid
          and promoted.section_id = input ->> 'sectionId'::text
          and promoted.resource_id = input ->> 'resourceId'::text
          and promoted.operation_contract_revision = (input ->> 'operationContractRevision'::text)::integer
          and promoted.resource_revision = (input ->> 'resourceRevision'::text)::integer
          and promoted.organization_version = (input ->> 'organizationVersion'::text)::bigint
          and promoted.target_user_id = (input ->> 'targetUserId'::text)::uuid
          and promoted.managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
          and promoted.character_id = (input ->> 'characterId'::text)::bigint
          and promoted.character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
          and promoted.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
          and promoted.disclosure_version = (input ->> 'disclosureVersion'::text)::integer
          and promoted.section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
      ) then 'applied'::text
      else 'obsolete'::text
    end
  ) as result;
end;

create function eve_module_member_audit.persist_purge_evidence(input jsonb)
returns jsonb
language sql
volatile
parallel unsafe
begin atomic
  with trained as (
    delete from trained_skill_snapshots
    where ctid in (
      select ctid from trained_skill_snapshots
      where input ->> 'store'::text = 'trained-skills'::text
        and input ->> 'mode'::text <> 'retention'::text
        and case input ->> 'mode'::text
          when 'account'::text then target_user_id = (input ->> 'targetUserId'::text)::uuid
          else
            organization_version = (input ->> 'organizationVersion'::text)::bigint
            and (
              input ->> 'mode'::text = 'organization'::text
              or target_user_id = (input ->> 'targetUserId'::text)::uuid
            )
        end
        and (
          input ->> 'mode'::text <> 'authority'::text
          or (
            managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
            and character_id = (input ->> 'characterId'::text)::bigint
            and character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
            and authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
            and disclosure_version = (input ->> 'disclosureVersion'::text)::integer
            and section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
          )
        )
      limit (input ->> 'limit'::text)::integer
    )
    returning 1
  ), assets as (
    delete from asset_snapshots
    where ctid in (
      select ctid from asset_snapshots
      where input ->> 'store'::text = 'assets'::text
        and input ->> 'mode'::text <> 'retention'::text
        and case input ->> 'mode'::text
          when 'account'::text then target_user_id = (input ->> 'targetUserId'::text)::uuid
          else
            organization_version = (input ->> 'organizationVersion'::text)::bigint
            and (
              input ->> 'mode'::text = 'organization'::text
              or target_user_id = (input ->> 'targetUserId'::text)::uuid
            )
        end
        and (
          input ->> 'mode'::text <> 'authority'::text
          or (
            managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
            and character_id = (input ->> 'characterId'::text)::bigint
            and character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
            and authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
            and disclosure_version = (input ->> 'disclosureVersion'::text)::integer
            and section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
          )
        )
      limit (input ->> 'limit'::text)::integer
    )
    returning 1
  ), balance as (
    delete from wallet_balance_snapshots
    where ctid in (
      select ctid from wallet_balance_snapshots
      where input ->> 'store'::text = 'wallet-balance'::text
        and input ->> 'mode'::text <> 'retention'::text
        and case input ->> 'mode'::text
          when 'account'::text then target_user_id = (input ->> 'targetUserId'::text)::uuid
          else
            organization_version = (input ->> 'organizationVersion'::text)::bigint
            and (
              input ->> 'mode'::text = 'organization'::text
              or target_user_id = (input ->> 'targetUserId'::text)::uuid
            )
        end
        and (
          input ->> 'mode'::text <> 'authority'::text
          or (
            managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
            and character_id = (input ->> 'characterId'::text)::bigint
            and character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
            and authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
            and disclosure_version = (input ->> 'disclosureVersion'::text)::integer
            and section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
          )
        )
      limit (input ->> 'limit'::text)::integer
    )
    returning 1
  ), journal as (
    delete from wallet_journal_records
    where ctid in (
      select ctid from wallet_journal_records
      where input ->> 'store'::text = 'wallet-journal'::text
        and (
          (
            input ->> 'mode'::text = 'retention'::text
            and expires_at <= (input ->> 'cutoff'::text)::timestamptz
          )
          or (
            input ->> 'mode'::text <> 'retention'::text
            and case input ->> 'mode'::text
              when 'account'::text then
                target_user_id = (input ->> 'targetUserId'::text)::uuid
              else
                organization_version = (input ->> 'organizationVersion'::text)::bigint
                and (
                  input ->> 'mode'::text = 'organization'::text
                  or target_user_id = (input ->> 'targetUserId'::text)::uuid
                )
            end
            and (
              input ->> 'mode'::text <> 'authority'::text
              or (
                managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
                and character_id = (input ->> 'characterId'::text)::bigint
                and character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
                and authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
                and disclosure_version = (input ->> 'disclosureVersion'::text)::integer
                and section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
              )
            )
          )
        )
      limit (input ->> 'limit'::text)::integer
    )
    returning 1
  ), transactions as (
    delete from wallet_transaction_records
    where ctid in (
      select ctid from wallet_transaction_records
      where input ->> 'store'::text = 'wallet-transactions'::text
        and (
          (
            input ->> 'mode'::text = 'retention'::text
            and expires_at <= (input ->> 'cutoff'::text)::timestamptz
          )
          or (
            input ->> 'mode'::text <> 'retention'::text
            and case input ->> 'mode'::text
              when 'account'::text then
                target_user_id = (input ->> 'targetUserId'::text)::uuid
              else
                organization_version = (input ->> 'organizationVersion'::text)::bigint
                and (
                  input ->> 'mode'::text = 'organization'::text
                  or target_user_id = (input ->> 'targetUserId'::text)::uuid
                )
            end
            and (
              input ->> 'mode'::text <> 'authority'::text
              or (
                managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
                and character_id = (input ->> 'characterId'::text)::bigint
                and character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
                and authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
                and disclosure_version = (input ->> 'disclosureVersion'::text)::integer
                and section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
              )
            )
          )
        )
      limit (input ->> 'limit'::text)::integer
    )
    returning 1
  ), headers as (
    delete from mail_headers
    where ctid in (
      select ctid from mail_headers
      where input ->> 'store'::text = 'mail-headers'::text
        and (
          (
            input ->> 'mode'::text = 'retention'::text
            and expires_at <= (input ->> 'cutoff'::text)::timestamptz
          )
          or (
            input ->> 'mode'::text <> 'retention'::text
            and case input ->> 'mode'::text
              when 'account'::text then
                target_user_id = (input ->> 'targetUserId'::text)::uuid
              else
                organization_version = (input ->> 'organizationVersion'::text)::bigint
                and (
                  input ->> 'mode'::text = 'organization'::text
                  or target_user_id = (input ->> 'targetUserId'::text)::uuid
                )
            end
            and (
              input ->> 'mode'::text <> 'authority'::text
              or (
                managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
                and character_id = (input ->> 'characterId'::text)::bigint
                and character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
                and authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
                and disclosure_version = (input ->> 'disclosureVersion'::text)::integer
                and section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
              )
            )
          )
        )
      limit (input ->> 'limit'::text)::integer
    )
    returning 1
  ), contents as (
    delete from mail_contents
    where ctid in (
      select ctid from mail_contents
      where input ->> 'store'::text = 'mail-contents'::text
        and (
          (
            input ->> 'mode'::text = 'retention'::text
            and expires_at <= (input ->> 'cutoff'::text)::timestamptz
          )
          or (
            input ->> 'mode'::text <> 'retention'::text
            and case input ->> 'mode'::text
              when 'account'::text then
                target_user_id = (input ->> 'targetUserId'::text)::uuid
              else
                organization_version = (input ->> 'organizationVersion'::text)::bigint
                and (
                  input ->> 'mode'::text = 'organization'::text
                  or target_user_id = (input ->> 'targetUserId'::text)::uuid
                )
            end
            and (
              input ->> 'mode'::text <> 'authority'::text
              or (
                managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
                and character_id = (input ->> 'characterId'::text)::bigint
                and character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
                and authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
                and disclosure_version = (input ->> 'disclosureVersion'::text)::integer
                and section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
              )
            )
          )
        )
      limit (input ->> 'limit'::text)::integer
    )
    returning 1
  ), continuations as (
    delete from collection_continuations
    where ctid in (
      select ctid from collection_continuations
      where input ->> 'store'::text = 'continuations'::text
        and (
          (
            input ->> 'mode'::text = 'retention'::text
            and updated_at <= (input ->> 'cutoff'::text)::timestamptz
          )
          or (
            input ->> 'mode'::text <> 'retention'::text
            and case input ->> 'mode'::text
              when 'account'::text then
                target_user_id = (input ->> 'targetUserId'::text)::uuid
              else
                organization_version = (input ->> 'organizationVersion'::text)::bigint
                and (
                  input ->> 'mode'::text = 'organization'::text
                  or target_user_id = (input ->> 'targetUserId'::text)::uuid
                )
            end
            and (
              input ->> 'mode'::text <> 'authority'::text
              or (
                managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
                and character_id = (input ->> 'characterId'::text)::bigint
                and character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
                and authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
                and disclosure_version = (input ->> 'disclosureVersion'::text)::integer
                and section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
              )
            )
          )
        )
      limit (input ->> 'limit'::text)::integer
    )
    returning 1
  ), staging as (
    delete from observation_staging
    where ctid in (
      select ctid from observation_staging
      where input ->> 'store'::text = 'staging'::text
        and (
          (
            input ->> 'mode'::text = 'retention'::text
            and validated_at <= (input ->> 'cutoff'::text)::timestamptz
          )
          or (
            input ->> 'mode'::text <> 'retention'::text
            and case input ->> 'mode'::text
              when 'account'::text then
                target_user_id = (input ->> 'targetUserId'::text)::uuid
              else
                organization_version = (input ->> 'organizationVersion'::text)::bigint
                and (
                  input ->> 'mode'::text = 'organization'::text
                  or target_user_id = (input ->> 'targetUserId'::text)::uuid
                )
            end
            and (
              input ->> 'mode'::text <> 'authority'::text
              or (
                managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
                and character_id = (input ->> 'characterId'::text)::bigint
                and character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
                and authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
                and disclosure_version = (input ->> 'disclosureVersion'::text)::integer
                and section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
              )
            )
          )
        )
      limit (input ->> 'limit'::text)::integer
    )
    returning 1
  ), promotions as (
    delete from promoted_observations
    where ctid in (
      select ctid from promoted_observations
      where input ->> 'store'::text = 'promotions'::text
        and (
          (
            input ->> 'mode'::text = 'retention'::text
            and promoted_at <= (input ->> 'cutoff'::text)::timestamptz
          )
          or (
            input ->> 'mode'::text <> 'retention'::text
            and case input ->> 'mode'::text
              when 'account'::text then
                target_user_id = (input ->> 'targetUserId'::text)::uuid
              else
                organization_version = (input ->> 'organizationVersion'::text)::bigint
                and (
                  input ->> 'mode'::text = 'organization'::text
                  or target_user_id = (input ->> 'targetUserId'::text)::uuid
                )
            end
            and (
              input ->> 'mode'::text <> 'authority'::text
              or (
                managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
                and character_id = (input ->> 'characterId'::text)::bigint
                and character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
                and authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
                and disclosure_version = (input ->> 'disclosureVersion'::text)::integer
                and section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
              )
            )
          )
        )
      limit (input ->> 'limit'::text)::integer
    )
    returning 1
  ), counts as (
    select
      (select count(*) from trained)
      + (select count(*) from assets)
      + (select count(*) from balance)
      + (select count(*) from journal)
      + (select count(*) from transactions)
      + (select count(*) from headers)
      + (select count(*) from contents)
      + (select count(*) from continuations)
      + (select count(*) from staging)
      + (select count(*) from promotions) as deleted
  )
  select jsonb_build_object(
    'deleted'::text,
    deleted,
    'remaining'::text,
    deleted = (input ->> 'limit'::text)::integer
  ) as result
  from counts;
end;

create function eve_module_member_audit.persist_read_trained_skills_evidence(input jsonb)
returns jsonb
language sql
stable
parallel unsafe
begin atomic
  select jsonb_build_object(
    'trainedSkills'::text,
    (
      select jsonb_build_object(
        'observationId'::text, trained.observation_id,
        'dtoRevision'::text, trained.dto_revision,
        'validatedAt'::text, trained.validated_at,
        'snapshot'::text, trained.snapshot
      )
      from eve_module_member_audit.trained_skill_snapshots as trained
      where trained.organization_version = (input ->> 'organizationVersion'::text)::bigint
        and trained.target_user_id = (input ->> 'targetUserId'::text)::uuid
        and trained.managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
        and trained.character_id = (input ->> 'characterId'::text)::bigint
        and trained.character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
        and trained.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
        and trained.disclosure_version = (input ->> 'disclosureVersion'::text)::integer
        and trained.section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
    )
  ) as result;
end;

create function eve_module_member_audit.persist_read_active_evidence_continuation(input jsonb)
returns jsonb
language sql
stable
parallel unsafe
begin atomic
  select jsonb_build_object(
    'observationId'::text, continuation.observation_id,
    'revision'::text, continuation.revision,
    'checkpoint'::text, continuation.checkpoint
  ) as result
  from eve_module_member_audit.collection_continuations as continuation
  where continuation.section_id = input ->> 'sectionId'::text
    and continuation.resource_id = input ->> 'resourceId'::text
    and continuation.operation_contract_revision = (input ->> 'operationContractRevision'::text)::integer
    and continuation.resource_revision = (input ->> 'resourceRevision'::text)::integer
    and continuation.organization_version = (input ->> 'organizationVersion'::text)::bigint
    and continuation.target_user_id = (input ->> 'targetUserId'::text)::uuid
    and continuation.managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
    and continuation.character_id = (input ->> 'characterId'::text)::bigint
    and continuation.character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
    and continuation.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
    and continuation.disclosure_version = (input ->> 'disclosureVersion'::text)::integer
    and continuation.section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer;
end;
