import { sql } from 'drizzle-orm'
import { boolean, check, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import { moduleIdCheck } from './shared.js'

// Tracked by api/src/db/migrate.ts, not by drizzle-kit — schema changes still
// go through api/migrations/*.sql. This table is modeled only so it shows up
// in introspection; the app never queries it.
export const schemaMigrations = pgTable(
  'schema_migrations',
  {
    module: text().default('core').notNull(),
    name: text().notNull(),
    contentSha256: text('content_sha256'),
    appliedAt: timestamp('applied_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.module, table.name], name: 'schema_migrations_pkey' }),
    check(
      'schema_migrations_content_sha256_check',
      sql`${table.contentSha256} is null or ${table.contentSha256} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
)

export const moduleSchemaProvisioning = pgTable(
  'module_schema_provisioning',
  {
    moduleId: text('module_id').primaryKey().notNull(),
    provisionedAt: timestamp('provisioned_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
  (_table) => [moduleIdCheck('module_schema_provisioning_module_id_check')],
)

export const modulePersistenceContract = pgTable(
  'module_persistence_contract',
  {
    singleton: boolean().default(true).primaryKey().notNull(),
    contractFingerprint: text('contract_fingerprint').notNull(),
    operationCount: integer('operation_count').notNull(),
    reconciledAt: timestamp('reconciled_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check('module_persistence_contract_singleton_check', sql`${table.singleton}`),
    check(
      'module_persistence_contract_fingerprint_check',
      sql`${table.contractFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check('module_persistence_contract_operation_count_check', sql`${table.operationCount} >= 0`),
  ],
)

export const modulePersistenceOperationAttestations = pgTable(
  'module_persistence_operation_attestations',
  {
    moduleId: text('module_id').notNull(),
    operationId: text('operation_id').notNull(),
    revision: integer().notNull(),
    mode: text().notNull(),
    migrationName: text('migration_name').notNull(),
    schemaName: text('schema_name').notNull(),
    routineName: text('routine_name').notNull(),
    definitionFingerprint: text('definition_fingerprint').notNull(),
    attestedAt: timestamp('attested_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.moduleId, table.operationId] }),
    moduleIdCheck('module_persistence_operation_attestations_module_id_check'),
    check(
      'module_persistence_operation_attestations_operation_id_check',
      sql`length(${table.operationId}) <= 54 and ${table.operationId} ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'`,
    ),
    check('module_persistence_operation_attestations_revision_check', sql`${table.revision} > 0`),
    check(
      'module_persistence_operation_attestations_mode_check',
      sql`${table.mode} in ('read', 'write')`,
    ),
    check(
      'module_persistence_operation_attestations_migration_name_check',
      sql`${table.migrationName} ~ '^[A-Za-z0-9][A-Za-z0-9._-]*\\.sql$'`,
    ),
    check(
      'module_persistence_operation_attestations_schema_name_check',
      sql`${table.schemaName} ~ '^eve_module_[a-z0-9_]+$'`,
    ),
    check(
      'module_persistence_operation_attestations_routine_name_check',
      sql`${table.routineName} ~ '^persist_[a-z0-9_]+$'`,
    ),
    check(
      'module_persistence_operation_attestations_fingerprint_check',
      sql`${table.definitionFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
)
