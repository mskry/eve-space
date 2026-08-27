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
  affiliation_checked_at timestamptz,
  next_affiliation_check timestamptz,
  affiliation_resolution_state text not null default 'pending', -- NOSONAR: PostgreSQL DDL has no reusable string constants.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint characters_affiliation_resolution_state_check
    check (affiliation_resolution_state in ('pending', 'resolved', 'unresolvable')) -- NOSONAR: PostgreSQL DDL has no reusable string constants.
);

create unique index one_main_character_per_user
  on characters (user_id)
  where is_main;

create index characters_due_affiliation_check_idx
  on characters (next_affiliation_check, character_id)
  where next_affiliation_check is not null
    and affiliation_resolution_state <> 'unresolvable'; -- NOSONAR: PostgreSQL DDL has no reusable string constants.

create table eve_tokens (
  character_id bigint primary key references characters(character_id) on delete cascade,
  encrypted_tokens text not null,
  access_token_expires_at timestamptz not null,
  scopes jsonb not null default '[]'::jsonb,
  token_version integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint eve_tokens_scopes_is_array check (jsonb_typeof(scopes) = 'array')
);

create table oauth_states (
  state_hash varchar(64) primary key,
  intent text not null default 'login',
  user_id uuid references users(id) on delete cascade,
  character_id bigint references characters(character_id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint oauth_states_state_hash_length_check check (length(state_hash) = 64),
  constraint oauth_states_intent_check check (intent in ('login', 'attach', 'reauthorize')),
  constraint oauth_states_context_check
    check (
      (intent = 'login' and user_id is null and character_id is null) -- NOSONAR: PostgreSQL DDL has no reusable string constants.
      or (intent = 'attach' and user_id is not null and character_id is null)
      or (intent = 'reauthorize' and user_id is not null and character_id is not null)
    )
);

create index oauth_states_expires_at_idx on oauth_states (expires_at);
create index oauth_states_user_id_idx on oauth_states (user_id) where user_id is not null;
create index oauth_states_character_id_idx on oauth_states (character_id)
  where character_id is not null;

create table sessions (
  session_hash varchar(64) primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint sessions_session_hash_length_check check (length(session_hash) = 64)
);

create index sessions_user_id_idx on sessions (user_id);
create index sessions_expires_at_idx on sessions (expires_at);

-- EVE Static Data Export (SDE) reference tables, populated by the sde-ingest
-- Rust tool (see /sde-ingest) from CCP's JSONL automation feed. Every table
-- here is truncated and fully reloaded on each ingest run, so foreign keys
-- are intentionally omitted: they would force a strict load order across an
-- external, wholesale-replaced dataset for no real integrity benefit. Columns
-- that reference another table (group_id, category_id, etc.) are still
-- indexed for joins.

create table sde_builds (
  build_number bigint primary key,
  release_date timestamptz not null,
  ingested_at timestamptz not null default now()
);

create table sde_categories (
  category_id bigint primary key,
  name text not null,
  published boolean not null
);

create table sde_groups (
  group_id bigint primary key,
  category_id bigint not null,
  name text not null,
  published boolean not null
);

create index sde_groups_category_id_idx on sde_groups (category_id);

create table sde_types (
  type_id bigint primary key,
  group_id bigint not null,
  race_id bigint,
  market_group_id bigint,
  name text not null,
  published boolean not null,
  mass double precision,
  volume double precision,
  capacity double precision,
  portion_size integer,
  base_price double precision
);

create index sde_types_group_id_idx on sde_types (group_id);
create index sde_types_market_group_id_idx on sde_types (market_group_id);

create table sde_market_groups (
  market_group_id bigint primary key,
  parent_group_id bigint,
  name text not null,
  description text
);

create index sde_market_groups_parent_group_id_idx on sde_market_groups (parent_group_id);

create table sde_dogma_attributes (
  attribute_id bigint primary key,
  name text not null,
  description text,
  default_value double precision,
  published boolean not null,
  high_is_good boolean not null,
  stackable boolean not null
);

create table sde_dogma_effects (
  effect_id bigint primary key,
  name text not null,
  effect_category_id integer not null,
  published boolean not null,
  is_offensive boolean not null,
  is_assistance boolean not null,
  is_warp_safe boolean not null
);

create table sde_type_dogma_attributes (
  type_id bigint not null,
  attribute_id bigint not null,
  value double precision not null,
  primary key (type_id, attribute_id)
);

create table sde_type_dogma_effects (
  type_id bigint not null,
  effect_id bigint not null,
  is_default boolean not null,
  primary key (type_id, effect_id)
);

create table sde_races (
  race_id bigint primary key,
  name text not null,
  description text
);

create table sde_bloodlines (
  bloodline_id bigint primary key,
  race_id bigint,
  name text not null,
  description text
);

create index sde_bloodlines_race_id_idx on sde_bloodlines (race_id);

create table sde_ancestries (
  ancestry_id bigint primary key,
  bloodline_id bigint,
  name text not null,
  short_description text
);

create index sde_ancestries_bloodline_id_idx on sde_ancestries (bloodline_id);

create table sde_factions (
  faction_id bigint primary key,
  name text not null,
  description text
);

-- Catch-all for the remaining ~90 SDE datasets (missions, blueprints, map
-- geography, NPC flavor data, etc.) that this app does not query relationally
-- today. Keeping the ingestion complete without hand-designing unused schema.
-- Most datasets key rows by integer id, but a few (militaryCampaigns,
-- characterTitles, translationLanguages, ...) key by UUID or language code.
create table sde_dataset_rows (
  dataset text not null,
  key text not null,
  data jsonb not null,
  primary key (dataset, key)
);

create index sde_dataset_rows_dataset_idx on sde_dataset_rows (dataset);

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

create table deployment_installation_settings (
  id smallint primary key default 1,
  planner_schedule_offset_ms integer not null default (floor(random() * 60000)::integer),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deployment_installation_settings_singleton_check check (id = 1),
  constraint deployment_installation_settings_planner_offset_check
    check (planner_schedule_offset_ms >= 0)
);

insert into deployment_installation_settings (id) values (1);

create table domain_events (
  event_id uuid primary key default gen_random_uuid(),
  event_sequence bigint generated always as identity unique,
  event_type text not null,
  payload_version integer not null,
  aggregate_type text not null,
  aggregate_id text not null,
  payload jsonb not null,
  occurred_at timestamptz not null default now(),
  pending_since timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  claim_token uuid,
  claim_expires_at timestamptz,
  publish_attempts integer not null default 0,
  last_failure_category text,
  last_failure_at timestamptz,
  published_at timestamptz,
  constraint domain_events_payload_version_check check (payload_version > 0),
  constraint domain_events_publish_attempts_check check (publish_attempts >= 0),
  constraint domain_events_payload_object_check check (jsonb_typeof(payload) = 'object'),
  constraint domain_events_event_type_check check (event_type <> ''),
  constraint domain_events_aggregate_identity_check
    check (aggregate_type <> '' and aggregate_id <> ''),
  constraint domain_events_claim_pair_check
    check ((claim_token is null) = (claim_expires_at is null)),
  constraint domain_events_failure_pair_check
    check ((last_failure_category is null) = (last_failure_at is null)),
  constraint domain_events_failure_category_check
    check (
      last_failure_category is null
      or last_failure_category in (
        'queue-unavailable',
        'queue-rejected',
        'invalid-event',
        'unknown'
      )
    ),
  constraint domain_events_published_claim_check
    check (published_at is null or claim_token is null)
);

create index domain_events_pending_eligible_idx
  on domain_events (next_attempt_at, event_sequence)
  where published_at is null;

create index domain_events_published_retention_idx
  on domain_events (published_at)
  where published_at is not null;

create function prevent_domain_event_envelope_update()
returns trigger
language plpgsql
as $$
begin
  if row(
    old.event_id,
    old.event_sequence,
    old.event_type,
    old.payload_version,
    old.aggregate_type,
    old.aggregate_id,
    old.payload,
    old.occurred_at
  ) is distinct from row(
    new.event_id,
    new.event_sequence,
    new.event_type,
    new.payload_version,
    new.aggregate_type,
    new.aggregate_id,
    new.payload,
    new.occurred_at
  ) then
    raise exception 'domain event envelope is immutable';
  end if;

  return new;
end;
$$;

create trigger domain_events_immutable_envelope
before update on domain_events
for each row execute function prevent_domain_event_envelope_update();

revoke all privileges on schema public from public;

alter default privileges revoke execute on routines from public;

create table module_schema_provisioning (
  module_id text primary key,
  provisioned_at timestamptz not null default now(),
  constraint module_schema_provisioning_module_id_check check (
    module_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
    and length(module_id) <= 44
    and module_id not in ('core', 'platform')
  )
);

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

create table platform_subject_lifecycles (
  subject_lifecycle_id uuid primary key default gen_random_uuid(),
  subject_kind text not null,
  subject_id text not null,
  character_id bigint unique,
  created_at timestamptz not null default now(),
  unique (subject_kind, subject_id),
  unique (subject_kind, subject_lifecycle_id, subject_id),
  constraint platform_subject_lifecycles_character_id_fkey
    foreign key (character_id) references characters(character_id) on delete cascade,
  constraint platform_subject_lifecycles_subject_kind_check check (
    subject_kind in ('deployment', 'character', 'corporation', 'alliance')
  ),
  constraint platform_subject_lifecycles_subject_id_check check (
    subject_id <> '' and subject_id = trim(subject_id)
  ),
  constraint platform_subject_lifecycles_character_binding_check check (
    (
      subject_kind = 'character'
      and character_id is not null
      and subject_id = character_id::text
    )
    or (subject_kind <> 'character' and character_id is null)
  )
);

create table platform_collection_state (
  module_id text not null,
  resource_id text not null,
  subject_kind text not null,
  subject_lifecycle_id uuid not null,
  subject_id text not null,
  next_eligible_at timestamptz,
  authorization_generation integer,
  validated_at timestamptz,
  last_failure_class text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (
    module_id,
    resource_id,
    subject_kind,
    subject_lifecycle_id,
    subject_id
  ),
  constraint platform_collection_state_module_id_fkey
    foreign key (module_id) references deployment_modules(module_id) on delete restrict,
  constraint platform_collection_state_subject_lifecycle_fkey
    foreign key (subject_kind, subject_lifecycle_id, subject_id)
    references platform_subject_lifecycles (
      subject_kind,
      subject_lifecycle_id,
      subject_id
    )
    on delete cascade,
  constraint platform_collection_state_module_id_check check (
    module_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
    and length(module_id) <= 44
    and module_id not in ('core', 'platform')
  ),
  constraint platform_collection_state_resource_id_check check (
    resource_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
  ),
  constraint platform_collection_state_subject_kind_check check (
    subject_kind in ('deployment', 'character', 'corporation', 'alliance')
  ),
  constraint platform_collection_state_subject_id_check check (
    subject_id <> '' and subject_id = trim(subject_id)
  ),
  constraint platform_collection_state_authorization_generation_check check (
    authorization_generation is null or authorization_generation >= 0
  ),
  constraint platform_collection_state_last_failure_class_check check (
    last_failure_class is null
    or last_failure_class in (
      'authorization-required',
      'esi-cooldown',
      'esi-unavailable',
      'response-invalid',
      'mapping-failed',
      'persistence-failed',
      'unknown'
    )
  )
);

create index platform_collection_state_due_idx
  on platform_collection_state (
    next_eligible_at,
    module_id,
    resource_id,
    subject_kind,
    subject_lifecycle_id,
    subject_id
  )
  where next_eligible_at is not null;

create index platform_collection_state_subject_lifecycle_idx
  on platform_collection_state (subject_kind, subject_lifecycle_id, subject_id);

create function platform_classify_resources(
  resources jsonb,
  effective_at timestamptz,
  filter_module_id text default null,
  filter_resource_id text default null,
  filter_subject_kind text default null,
  filter_subject_lifecycle_id uuid default null,
  filter_subject_id text default null
)
returns table (
  module_id text,
  resource_id text,
  subject_kind text,
  subject_lifecycle_id uuid,
  subject_id text,
  operation_id text,
  eligibility_status text,
  expected_authorization_generation integer,
  required_scope text,
  due_reason text,
  scheduling_key timestamptz,
  next_eligible_at timestamptz,
  validated_at timestamptz,
  last_failure_class text
)
language sql
stable
as $$
  with installed_resources as (
    select resource.module_id, resource.resource_id, resource.subject_kind,
      resource.operation_id, resource.required_scope
    from jsonb_to_recordset(resources) as resource (
      module_id text,
      resource_id text,
      subject_kind text,
      operation_id text,
      required_scope text
    )
  ), classified as (
    select
      resource.module_id,
      resource.resource_id,
      resource.subject_kind,
      lifecycle.subject_lifecycle_id,
      lifecycle.subject_id,
      resource.operation_id,
      case
        when module_setting.enabled is distinct from true then 'disabled'
        when resource.required_scope is not null and (
          token.character_id is null
          or not token.scopes @> jsonb_build_array(resource.required_scope)
        ) then 'authorization-required'
        when state.last_failure_class in (
          'response-invalid',
          'mapping-failed',
          'persistence-failed',
          'unknown'
        ) and state.authorization_generation is not distinct from (
          case when resource.required_scope is null then null else token.token_version end
        ) then 'suppressed'
        else 'eligible'
      end as eligibility_status,
      case when resource.required_scope is null then null else token.token_version end
        as expected_authorization_generation,
      resource.required_scope,
      state.module_id is null as state_missing,
      state.authorization_generation,
      state.next_eligible_at,
      state.validated_at,
      state.last_failure_class
    from installed_resources resource
    join platform_subject_lifecycles lifecycle
      on lifecycle.subject_kind = resource.subject_kind
    join characters character
      on character.character_id = lifecycle.character_id
    left join deployment_modules module_setting
      on module_setting.module_id = resource.module_id
    left join eve_tokens token
      on token.character_id = character.character_id
    left join platform_collection_state state
      on state.module_id = resource.module_id
      and state.resource_id = resource.resource_id
      and state.subject_kind = resource.subject_kind
      and state.subject_lifecycle_id = lifecycle.subject_lifecycle_id
      and state.subject_id = lifecycle.subject_id
    where (filter_module_id is null or resource.module_id = filter_module_id)
      and (filter_resource_id is null or resource.resource_id = filter_resource_id)
      and (filter_subject_kind is null or resource.subject_kind = filter_subject_kind)
      and (
        filter_subject_lifecycle_id is null
        or lifecycle.subject_lifecycle_id = filter_subject_lifecycle_id
      )
      and (filter_subject_id is null or lifecycle.subject_id = filter_subject_id)
  )
  select
    classified.module_id,
    classified.resource_id,
    classified.subject_kind,
    classified.subject_lifecycle_id,
    classified.subject_id,
    classified.operation_id,
    classified.eligibility_status,
    classified.expected_authorization_generation,
    classified.required_scope,
    case
      when classified.eligibility_status <> 'eligible' then null
      when classified.state_missing then 'never-collected'
      when classified.authorization_generation is distinct from
        classified.expected_authorization_generation then 'authorization-changed'
      when classified.next_eligible_at is null then 'unscheduled'
      when classified.next_eligible_at <= effective_at then 'elapsed'
      else 'future'
    end as due_reason,
    case
      when classified.eligibility_status <> 'eligible' then null
      when classified.state_missing
        or classified.authorization_generation is distinct from
          classified.expected_authorization_generation
        or classified.next_eligible_at is null then 'epoch'::timestamptz
      else classified.next_eligible_at
    end as scheduling_key,
    classified.next_eligible_at,
    classified.validated_at,
    classified.last_failure_class
  from classified;
$$;
