import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import type {
  PlatformCollectionFailureClass,
  PlatformCollectionStateIdentity,
} from '../../platform/collection-state.js'
import { characters } from './identity.js'
import { auditTimestamps, moduleIdCheck } from './shared.js'

// The deployment_* tables here are module-scoped despite the prefix: installed
// module settings and the navigation order owned by 'core' or by a module.

const subjectKindCheck = (name: string) =>
  check(name, sql`subject_kind in ('deployment', 'character', 'corporation', 'alliance')`)

const subjectIdCheck = (name: string) =>
  check(name, sql`subject_id <> '' and subject_id = trim(subject_id)`)

export const deploymentModules = pgTable(
  'deployment_modules',
  {
    moduleId: text('module_id').primaryKey().notNull(),
    enabled: boolean().default(false).notNull(),
    ...auditTimestamps(),
  },
  (_table) => [moduleIdCheck('deployment_modules_module_id_check')],
)

export const deploymentShellNavigationOrder = pgTable(
  'deployment_shell_navigation_order',
  {
    ownerId: text('owner_id').notNull(),
    navigationId: text('navigation_id').notNull(),
    position: integer().notNull(),
    ...auditTimestamps(),
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
    subjectKindCheck('platform_subject_lifecycles_subject_kind_check'),
    subjectIdCheck('platform_subject_lifecycles_subject_id_check'),
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
    ...auditTimestamps(),
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
    moduleIdCheck('platform_collection_state_module_id_check'),
    check(
      'platform_collection_state_resource_id_check',
      sql`resource_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'`,
    ),
    subjectKindCheck('platform_collection_state_subject_kind_check'),
    subjectIdCheck('platform_collection_state_subject_id_check'),
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
