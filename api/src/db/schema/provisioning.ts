import { sql } from 'drizzle-orm'
import { check, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
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
