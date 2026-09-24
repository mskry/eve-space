// EVE Static Data Export tables, populated by /sde-ingest (see its README),
// not by this API. Modeled here purely for typed reads.

import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

export const sdeBuilds = pgTable('sde_builds', {
  buildNumber: bigint('build_number', { mode: 'number' }).primaryKey().notNull(),
  ingestVersion: integer('ingest_version').default(1).notNull(),
  ingestedAt: timestamp('ingested_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  releaseDate: timestamp('release_date', { withTimezone: true, mode: 'date' }).notNull(),
})

export const sdeProjectionState = pgTable('sde_projection_state', {
  activeBuildNumber: bigint('active_build_number', { mode: 'number' }).references(
    () => sdeBuilds.buildNumber,
  ),
  singleton: boolean().default(true).primaryKey().notNull(),
})

export const sdeSolarSystems = pgTable('sde_solar_systems', {
  name: text().notNull(),
  securityStatus: doublePrecision('security_status').notNull(),
  solarSystemId: bigint('solar_system_id', { mode: 'number' }).primaryKey().notNull(),
})

export const sdeNpcStations = pgTable(
  'sde_npc_stations',
  {
    solarSystemId: bigint('solar_system_id', { mode: 'number' })
      .notNull()
      .references(() => sdeSolarSystems.solarSystemId),
    stationId: bigint('station_id', { mode: 'number' }).primaryKey().notNull(),
  },
  (table) => [index('sde_npc_stations_solar_system_id_idx').on(table.solarSystemId)],
)

export const sdeCategories = pgTable('sde_categories', {
  categoryId: bigint('category_id', { mode: 'number' }).primaryKey().notNull(),
  name: text().notNull(),
  published: boolean().notNull(),
})

export const sdeGroups = pgTable(
  'sde_groups',
  {
    categoryId: bigint('category_id', { mode: 'number' }).notNull(),
    groupId: bigint('group_id', { mode: 'number' }).primaryKey().notNull(),
    name: text().notNull(),
    published: boolean().notNull(),
  },
  (table) => [
    index('sde_groups_category_id_idx').using(
      'btree',
      table.categoryId.asc().nullsLast().op('int8_ops'),
    ),
  ],
)

export const sdeTypes = pgTable(
  'sde_types',
  {
    basePrice: doublePrecision('base_price'),
    capacity: doublePrecision(),
    description: text(),
    groupId: bigint('group_id', { mode: 'number' }).notNull(),
    marketGroupId: bigint('market_group_id', { mode: 'number' }),
    mass: doublePrecision(),
    name: text().notNull(),
    portionSize: integer('portion_size'),
    published: boolean().notNull(),
    raceId: bigint('race_id', { mode: 'number' }),
    typeId: bigint('type_id', { mode: 'number' }).primaryKey().notNull(),
    volume: doublePrecision(),
  },
  (table) => [
    index('sde_types_group_id_idx').using('btree', table.groupId.asc().nullsLast().op('int8_ops')),
    index('sde_types_market_group_id_idx').using(
      'btree',
      table.marketGroupId.asc().nullsLast().op('int8_ops'),
    ),
  ],
)

export const sdeMarketGroups = pgTable(
  'sde_market_groups',
  {
    description: text(),
    marketGroupId: bigint('market_group_id', { mode: 'number' }).primaryKey().notNull(),
    name: text().notNull(),
    parentGroupId: bigint('parent_group_id', { mode: 'number' }),
  },
  (table) => [
    index('sde_market_groups_parent_group_id_idx').using(
      'btree',
      table.parentGroupId.asc().nullsLast().op('int8_ops'),
    ),
  ],
)

export const sdeDogmaAttributes = pgTable('sde_dogma_attributes', {
  attributeId: bigint('attribute_id', { mode: 'number' }).primaryKey().notNull(),
  defaultValue: doublePrecision('default_value'),
  description: text(),
  highIsGood: boolean('high_is_good').notNull(),
  name: text().notNull(),
  published: boolean().notNull(),
  stackable: boolean().notNull(),
})

export const sdeDogmaEffects = pgTable('sde_dogma_effects', {
  effectCategoryId: integer('effect_category_id').notNull(),
  effectId: bigint('effect_id', { mode: 'number' }).primaryKey().notNull(),
  isAssistance: boolean('is_assistance').notNull(),
  isOffensive: boolean('is_offensive').notNull(),
  isWarpSafe: boolean('is_warp_safe').notNull(),
  name: text().notNull(),
  published: boolean().notNull(),
})

export const sdeTypeDogmaAttributes = pgTable(
  'sde_type_dogma_attributes',
  {
    attributeId: bigint('attribute_id', { mode: 'number' }).notNull(),
    typeId: bigint('type_id', { mode: 'number' }).notNull(),
    value: doublePrecision().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.typeId, table.attributeId],
      name: 'sde_type_dogma_attributes_pkey',
    }),
  ],
)

export const sdeTypeDogmaEffects = pgTable(
  'sde_type_dogma_effects',
  {
    effectId: bigint('effect_id', { mode: 'number' }).notNull(),
    isDefault: boolean('is_default').notNull(),
    typeId: bigint('type_id', { mode: 'number' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.typeId, table.effectId], name: 'sde_type_dogma_effects_pkey' }),
  ],
)

export const sdeRaces = pgTable('sde_races', {
  description: text(),
  name: text().notNull(),
  raceId: bigint('race_id', { mode: 'number' }).primaryKey().notNull(),
})

export const sdeBloodlines = pgTable(
  'sde_bloodlines',
  {
    bloodlineId: bigint('bloodline_id', { mode: 'number' }).primaryKey().notNull(),
    description: text(),
    name: text().notNull(),
    raceId: bigint('race_id', { mode: 'number' }),
  },
  (table) => [
    index('sde_bloodlines_race_id_idx').using(
      'btree',
      table.raceId.asc().nullsLast().op('int8_ops'),
    ),
  ],
)

export const sdeAncestries = pgTable(
  'sde_ancestries',
  {
    ancestryId: bigint('ancestry_id', { mode: 'number' }).primaryKey().notNull(),
    bloodlineId: bigint('bloodline_id', { mode: 'number' }),
    name: text().notNull(),
    shortDescription: text('short_description'),
  },
  (table) => [
    index('sde_ancestries_bloodline_id_idx').using(
      'btree',
      table.bloodlineId.asc().nullsLast().op('int8_ops'),
    ),
  ],
)

export const sdeFactions = pgTable('sde_factions', {
  description: text(),
  factionId: bigint('faction_id', { mode: 'number' }).primaryKey().notNull(),
  name: text().notNull(),
})

export const sdeDatasetRows = pgTable(
  'sde_dataset_rows',
  {
    data: jsonb().notNull(),
    dataset: text().notNull(),
    key: text().notNull(),
  },
  (table) => [
    index('sde_dataset_rows_dataset_idx').using(
      'btree',
      table.dataset.asc().nullsLast().op('text_ops'),
    ),
    primaryKey({ columns: [table.dataset, table.key], name: 'sde_dataset_rows_pkey' }),
  ],
)
