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
create table sde_dataset_rows (
  dataset text not null,
  key bigint not null,
  data jsonb not null,
  primary key (dataset, key)
);

create index sde_dataset_rows_dataset_idx on sde_dataset_rows (dataset);
