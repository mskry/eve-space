import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import type {
  DomainEventAggregateType,
  DomainEventPayload,
  DomainEventType,
  RelayFailureCategory,
} from '../domain-events.js'
import type {
  PlatformCollectionFailureClass,
  PlatformCollectionStateIdentity,
} from '../platform/collection-state.js'

// Tracked by api/src/db/migrate.ts, not by drizzle-kit — schema changes still
// go through api/migrations/*.sql. This table is modeled only so it shows up
// in introspection; the app never queries it.
export const schemaMigrations = pgTable(
  'schema_migrations',
  {
    module: text().default('core').notNull(),
    name: text().notNull(),
    appliedAt: timestamp('applied_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.module, table.name], name: 'schema_migrations_pkey' })],
)

export const moduleSchemaProvisioning = pgTable(
  'module_schema_provisioning',
  {
    moduleId: text('module_id').primaryKey().notNull(),
    provisionedAt: timestamp('provisioned_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
  (_table) => [
    check(
      'module_schema_provisioning_module_id_check',
      sql`module_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and length(module_id) <= 44 and module_id not in ('core', 'platform')`,
    ),
  ],
)

export const deploymentModules = pgTable(
  'deployment_modules',
  {
    moduleId: text('module_id').primaryKey().notNull(),
    enabled: boolean().default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (_table) => [
    check(
      'deployment_modules_module_id_check',
      sql`module_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and length(module_id) <= 44 and module_id not in ('core', 'platform')`,
    ),
  ],
)

export const deploymentShellNavigationOrder = pgTable(
  'deployment_shell_navigation_order',
  {
    ownerId: text('owner_id').notNull(),
    navigationId: text('navigation_id').notNull(),
    position: integer().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.ownerId, table.navigationId],
      name: 'deployment_shell_navigation_order_pkey',
    }),
    check(
      'deployment_shell_navigation_order_owner_id_check',
      sql`owner_id = 'core' or (owner_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and length(owner_id) <= 44 and owner_id <> 'platform')`,
    ),
    check(
      'deployment_shell_navigation_order_navigation_id_check',
      sql`navigation_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'`,
    ),
    check('deployment_shell_navigation_order_position_check', sql`position >= 0`),
  ],
)

export const users = pgTable('users', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
})

export const deploymentAdmins = pgTable(
  'deployment_admins',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    email: text().notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('deployment_admins_email_key').on(table.email),
    check('deployment_admins_email_normalized_check', sql`email = lower(trim(email))`),
  ],
)

export type DeploymentOrganizationType = 'corporation' | 'alliance'

export const deploymentInstallationSettings = pgTable(
  'deployment_installation_settings',
  {
    id: smallint().default(1).primaryKey().notNull(),
    plannerScheduleOffsetMs: integer('planner_schedule_offset_ms')
      .default(sql`floor(random() * 60000)::integer`)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (_table) => [
    check('deployment_installation_settings_singleton_check', sql`id = 1`),
    check(
      'deployment_installation_settings_planner_offset_check',
      sql`planner_schedule_offset_ms >= 0`,
    ),
  ],
)

export const deploymentSettings = pgTable(
  'deployment_settings',
  {
    id: smallint().default(1).primaryKey().notNull(),
    ownerAdminId: uuid('owner_admin_id').notNull(),
    organizationType: text('organization_type').$type<DeploymentOrganizationType>().notNull(),
    organizationId: bigint('organization_id', { mode: 'number' }).notNull(),
    organizationName: text('organization_name').notNull(),
    organizationTicker: text('organization_ticker').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('deployment_settings_owner_admin_id_key').on(table.ownerAdminId),
    foreignKey({
      columns: [table.ownerAdminId],
      foreignColumns: [deploymentAdmins.id],
      name: 'deployment_settings_owner_admin_id_fkey',
    }).onDelete('restrict'),
    check('deployment_settings_singleton_check', sql`id = 1`),
    check(
      'deployment_settings_organization_type_check',
      sql`organization_type in ('corporation', 'alliance')`,
    ),
    check('deployment_settings_organization_id_check', sql`organization_id > 0`),
  ],
)

export const adminSessions = pgTable(
  'admin_sessions',
  {
    sessionHash: varchar('session_hash', { length: 64 }).primaryKey().notNull(),
    adminId: uuid('admin_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    check('admin_sessions_session_hash_length_check', sql`length(session_hash) = 64`),
    index('admin_sessions_admin_id_idx').on(table.adminId),
    index('admin_sessions_expires_at_idx').on(table.expiresAt),
    foreignKey({
      columns: [table.adminId],
      foreignColumns: [deploymentAdmins.id],
      name: 'admin_sessions_admin_id_fkey',
    }).onDelete('cascade'),
  ],
)

export const characters = pgTable(
  'characters',
  {
    characterId: bigint('character_id', { mode: 'number' }).primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    name: text().notNull(),
    corporationId: bigint('corporation_id', { mode: 'number' }).notNull(),
    allianceId: bigint('alliance_id', { mode: 'number' }),
    affiliationCheckedAt: timestamp('affiliation_checked_at', { withTimezone: true, mode: 'date' }),
    nextAffiliationCheck: timestamp('next_affiliation_check', {
      withTimezone: true,
      mode: 'date',
    }),
    affiliationResolutionState: text('affiliation_resolution_state')
      .$type<'pending' | 'resolved' | 'unresolvable'>()
      .default('pending')
      .notNull(),
    isMain: boolean('is_main').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('one_main_character_per_user')
      .using('btree', table.userId.asc().nullsLast().op('uuid_ops'))
      .where(sql`is_main`),
    index('characters_due_affiliation_check_idx')
      .on(table.nextAffiliationCheck, table.characterId)
      .where(
        sql`next_affiliation_check is not null and affiliation_resolution_state <> 'unresolvable'`,
      ),
    check(
      'characters_affiliation_resolution_state_check',
      sql`affiliation_resolution_state in ('pending', 'resolved', 'unresolvable')`,
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'characters_user_id_fkey',
    }).onDelete('cascade'),
  ],
)

export const platformSubjectLifecycles = pgTable(
  'platform_subject_lifecycles',
  {
    subjectLifecycleId: uuid('subject_lifecycle_id').defaultRandom().primaryKey().notNull(),
    subjectKind: text('subject_kind')
      .$type<PlatformCollectionStateIdentity['subjectKind']>()
      .notNull(),
    subjectId: text('subject_id').notNull(),
    characterId: bigint('character_id', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('platform_subject_lifecycles_character_id_key').on(table.characterId),
    uniqueIndex('platform_subject_lifecycles_subject_kind_subject_id_key').on(
      table.subjectKind,
      table.subjectId,
    ),
    uniqueIndex('platform_subject_lifecycles_subject_kind_lifecycle_subject_id_key').on(
      table.subjectKind,
      table.subjectLifecycleId,
      table.subjectId,
    ),
    foreignKey({
      columns: [table.characterId],
      foreignColumns: [characters.characterId],
      name: 'platform_subject_lifecycles_character_id_fkey',
    }).onDelete('cascade'),
    check(
      'platform_subject_lifecycles_subject_kind_check',
      sql`subject_kind in ('deployment', 'character', 'corporation', 'alliance')`,
    ),
    check(
      'platform_subject_lifecycles_subject_id_check',
      sql`subject_id <> '' and subject_id = trim(subject_id)`,
    ),
    check(
      'platform_subject_lifecycles_character_binding_check',
      sql`(subject_kind = 'character' and character_id is not null and subject_id = character_id::text) or (subject_kind <> 'character' and character_id is null)`,
    ),
  ],
)

export const platformCollectionState = pgTable(
  'platform_collection_state',
  {
    moduleId: text('module_id').notNull(),
    resourceId: text('resource_id').notNull(),
    subjectKind: text('subject_kind')
      .$type<PlatformCollectionStateIdentity['subjectKind']>()
      .notNull(),
    subjectLifecycleId: uuid('subject_lifecycle_id').notNull(),
    subjectId: text('subject_id').notNull(),
    nextEligibleAt: timestamp('next_eligible_at', { withTimezone: true, mode: 'date' }),
    authorizationGeneration: integer('authorization_generation'),
    validatedAt: timestamp('validated_at', { withTimezone: true, mode: 'date' }),
    lastFailureClass: text('last_failure_class').$type<PlatformCollectionFailureClass>(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.moduleId,
        table.resourceId,
        table.subjectKind,
        table.subjectLifecycleId,
        table.subjectId,
      ],
      name: 'platform_collection_state_pkey',
    }),
    foreignKey({
      columns: [table.moduleId],
      foreignColumns: [deploymentModules.moduleId],
      name: 'platform_collection_state_module_id_fkey',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.subjectKind, table.subjectLifecycleId, table.subjectId],
      foreignColumns: [
        platformSubjectLifecycles.subjectKind,
        platformSubjectLifecycles.subjectLifecycleId,
        platformSubjectLifecycles.subjectId,
      ],
      name: 'platform_collection_state_subject_lifecycle_fkey',
    }).onDelete('cascade'),
    index('platform_collection_state_due_idx')
      .on(
        table.nextEligibleAt,
        table.moduleId,
        table.resourceId,
        table.subjectKind,
        table.subjectLifecycleId,
        table.subjectId,
      )
      .where(sql`next_eligible_at is not null`),
    index('platform_collection_state_subject_lifecycle_idx').on(
      table.subjectKind,
      table.subjectLifecycleId,
      table.subjectId,
    ),
    check(
      'platform_collection_state_module_id_check',
      sql`module_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and length(module_id) <= 44 and module_id not in ('core', 'platform')`,
    ),
    check(
      'platform_collection_state_resource_id_check',
      sql`resource_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'`,
    ),
    check(
      'platform_collection_state_subject_kind_check',
      sql`subject_kind in ('deployment', 'character', 'corporation', 'alliance')`,
    ),
    check(
      'platform_collection_state_subject_id_check',
      sql`subject_id <> '' and subject_id = trim(subject_id)`,
    ),
    check(
      'platform_collection_state_authorization_generation_check',
      sql`authorization_generation is null or authorization_generation >= 0`,
    ),
    check(
      'platform_collection_state_last_failure_class_check',
      sql`last_failure_class is null or last_failure_class in ('authorization-required', 'esi-cooldown', 'esi-unavailable', 'response-invalid', 'mapping-failed', 'persistence-failed', 'unknown')`,
    ),
  ],
)

export type PlatformCollectionStateRow = typeof platformCollectionState.$inferSelect

export type AuthorizationIntent = 'login' | 'attach' | 'reauthorize'

export const oauthStates = pgTable(
  'oauth_states',
  {
    stateHash: varchar('state_hash', { length: 64 }).primaryKey().notNull(),
    intent: text().$type<AuthorizationIntent>().default('login').notNull(),
    userId: uuid('user_id'),
    characterId: bigint('character_id', { mode: 'number' }),
    returnPath: varchar('return_path', { length: 512 }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    check('oauth_states_state_hash_length_check', sql`length(state_hash) = 64`),
    index('oauth_states_expires_at_idx').using(
      'btree',
      table.expiresAt.asc().nullsLast().op('timestamptz_ops'),
    ),
    index('oauth_states_user_id_idx')
      .using('btree', table.userId.asc().nullsLast().op('uuid_ops'))
      .where(sql`user_id is not null`),
    index('oauth_states_character_id_idx')
      .using('btree', table.characterId.asc().nullsLast().op('int8_ops'))
      .where(sql`character_id is not null`),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'oauth_states_user_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.characterId],
      foreignColumns: [characters.characterId],
      name: 'oauth_states_character_id_fkey',
    }).onDelete('cascade'),
    check('oauth_states_intent_check', sql`intent in ('login', 'attach', 'reauthorize')`),
    check(
      'oauth_states_context_check',
      sql`(intent = 'login' and user_id is null and character_id is null)
        or (intent = 'attach' and user_id is not null and character_id is null)
        or (intent = 'reauthorize' and user_id is not null and character_id is not null)`,
    ),
    check(
      'oauth_states_return_path_context_check',
      sql`return_path is null or intent = 'reauthorize'`,
    ),
  ],
)

export const sessions = pgTable(
  'sessions',
  {
    sessionHash: varchar('session_hash', { length: 64 }).primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    check('sessions_session_hash_length_check', sql`length(session_hash) = 64`),
    index('sessions_expires_at_idx').using(
      'btree',
      table.expiresAt.asc().nullsLast().op('timestamptz_ops'),
    ),
    index('sessions_user_id_idx').using('btree', table.userId.asc().nullsLast().op('uuid_ops')),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'sessions_user_id_fkey',
    }).onDelete('cascade'),
  ],
)

export const eveTokens = pgTable(
  'eve_tokens',
  {
    characterId: bigint('character_id', { mode: 'number' }).primaryKey().notNull(),
    encryptedTokens: text('encrypted_tokens').notNull(),
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    scopes: jsonb().$type<string[]>().default([]).notNull(),
    tokenVersion: integer('token_version').default(0).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.characterId],
      foreignColumns: [characters.characterId],
      name: 'eve_tokens_character_id_fkey',
    }).onDelete('cascade'),
    check('eve_tokens_scopes_is_array', sql`jsonb_typeof(scopes) = 'array'::text`),
  ],
)

export const domainEvents = pgTable(
  'domain_events',
  {
    eventId: uuid('event_id').defaultRandom().primaryKey().notNull(),
    eventSequence: bigint('event_sequence', { mode: 'bigint' })
      .generatedAlwaysAsIdentity()
      .notNull(),
    eventType: text('event_type').$type<DomainEventType>().notNull(),
    payloadVersion: integer('payload_version').notNull(),
    aggregateType: text('aggregate_type').$type<DomainEventAggregateType>().notNull(),
    aggregateId: text('aggregate_id').notNull(),
    payload: jsonb().$type<DomainEventPayload>().notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
    pendingSince: timestamp('pending_since', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
    claimToken: uuid('claim_token'),
    claimExpiresAt: timestamp('claim_expires_at', { withTimezone: true, mode: 'date' }),
    publishAttempts: integer('publish_attempts').default(0).notNull(),
    lastFailureCategory: text('last_failure_category').$type<RelayFailureCategory>(),
    lastFailureAt: timestamp('last_failure_at', { withTimezone: true, mode: 'date' }),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('domain_events_event_sequence_key').on(table.eventSequence),
    index('domain_events_pending_eligible_idx')
      .on(table.nextAttemptAt, table.eventSequence)
      .where(sql`published_at is null`),
    index('domain_events_published_retention_idx')
      .on(table.publishedAt)
      .where(sql`published_at is not null`),
    check('domain_events_payload_version_check', sql`payload_version > 0`),
    check('domain_events_publish_attempts_check', sql`publish_attempts >= 0`),
    check('domain_events_payload_object_check', sql`jsonb_typeof(payload) = 'object'`),
    check('domain_events_event_type_check', sql`event_type <> ''`),
    check(
      'domain_events_aggregate_identity_check',
      sql`aggregate_type <> '' and aggregate_id <> ''`,
    ),
    check(
      'domain_events_claim_pair_check',
      sql`(claim_token is null) = (claim_expires_at is null)`,
    ),
    check(
      'domain_events_failure_pair_check',
      sql`(last_failure_category is null) = (last_failure_at is null)`,
    ),
    check(
      'domain_events_failure_category_check',
      sql`last_failure_category is null or last_failure_category in ('queue-unavailable', 'queue-rejected', 'invalid-event', 'unknown')`,
    ),
    check('domain_events_published_claim_check', sql`published_at is null or claim_token is null`),
  ],
)

export type DomainEventRow = typeof domainEvents.$inferSelect

// EVE Static Data Export tables, populated by /sde-ingest (see its README),
// not by this API. Modeled here purely for typed reads.

export const sdeBuilds = pgTable('sde_builds', {
  buildNumber: bigint('build_number', { mode: 'number' }).primaryKey().notNull(),
  releaseDate: timestamp('release_date', { withTimezone: true, mode: 'date' }).notNull(),
  ingestedAt: timestamp('ingested_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
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
