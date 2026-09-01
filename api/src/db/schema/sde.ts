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
  releaseDate: timestamp('release_date', { withTimezone: true, mode: 'date' }).notNull(),
  ingestedAt: timestamp('ingested_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  ingestVersion: integer('ingest_version').default(1).notNull(),
})

export const sdeCategories = pgTable('sde_categories', {
  categoryId: bigint('category_id', { mode: 'number' }).primaryKey().notNull(),
  name: text().notNull(),
  published: boolean().notNull(),
})

export const sdeGroups = pgTable(
  'sde_groups',
  {
    groupId: bigint('group_id', { mode: 'number' }).primaryKey().notNull(),
    categoryId: bigint('category_id', { mode: 'number' }).notNull(),
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
    typeId: bigint('type_id', { mode: 'number' }).primaryKey().notNull(),
    groupId: bigint('group_id', { mode: 'number' }).notNull(),
    raceId: bigint('race_id', { mode: 'number' }),
    marketGroupId: bigint('market_group_id', { mode: 'number' }),
    name: text().notNull(),
    description: text(),
    published: boolean().notNull(),
    mass: doublePrecision(),
    volume: doublePrecision(),
    capacity: doublePrecision(),
    portionSize: integer('portion_size'),
    basePrice: doublePrecision('base_price'),
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
    marketGroupId: bigint('market_group_id', { mode: 'number' }).primaryKey().notNull(),
    parentGroupId: bigint('parent_group_id', { mode: 'number' }),
    name: text().notNull(),
    description: text(),
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
  name: text().notNull(),
  description: text(),
  defaultValue: doublePrecision('default_value'),
  published: boolean().notNull(),
  highIsGood: boolean('high_is_good').notNull(),
  stackable: boolean().notNull(),
})

export const sdeDogmaEffects = pgTable('sde_dogma_effects', {
  effectId: bigint('effect_id', { mode: 'number' }).primaryKey().notNull(),
  name: text().notNull(),
  effectCategoryId: integer('effect_category_id').notNull(),
  published: boolean().notNull(),
  isOffensive: boolean('is_offensive').notNull(),
  isAssistance: boolean('is_assistance').notNull(),
  isWarpSafe: boolean('is_warp_safe').notNull(),
})

export const sdeTypeDogmaAttributes = pgTable(
  'sde_type_dogma_attributes',
  {
    typeId: bigint('type_id', { mode: 'number' }).notNull(),
    attributeId: bigint('attribute_id', { mode: 'number' }).notNull(),
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
    typeId: bigint('type_id', { mode: 'number' }).notNull(),
    effectId: bigint('effect_id', { mode: 'number' }).notNull(),
    isDefault: boolean('is_default').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.typeId, table.effectId], name: 'sde_type_dogma_effects_pkey' }),
  ],
)

export const sdeRaces = pgTable('sde_races', {
  raceId: bigint('race_id', { mode: 'number' }).primaryKey().notNull(),
  name: text().notNull(),
  description: text(),
})

export const sdeBloodlines = pgTable(
  'sde_bloodlines',
  {
    bloodlineId: bigint('bloodline_id', { mode: 'number' }).primaryKey().notNull(),
    raceId: bigint('race_id', { mode: 'number' }),
    name: text().notNull(),
    description: text(),
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
  factionId: bigint('faction_id', { mode: 'number' }).primaryKey().notNull(),
  name: text().notNull(),
  description: text(),
})

export const sdeDatasetRows = pgTable(
  'sde_dataset_rows',
  {
    dataset: text().notNull(),
    key: text().notNull(),
    data: jsonb().notNull(),
  },
  (table) => [
    index('sde_dataset_rows_dataset_idx').using(
      'btree',
      table.dataset.asc().nullsLast().op('text_ops'),
    ),
    primaryKey({ columns: [table.dataset, table.key], name: 'sde_dataset_rows_pkey' }),
  ],
)
