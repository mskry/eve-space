import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'

export const organizationEpochs = pgTable(
  'organization_epochs',
  {
    deploymentId: smallint('deployment_id').default(1).notNull(),
    organizationVersion: bigint('organization_version', { mode: 'number' }).notNull(),
    organizationType: text('organization_type').$type<'corporation' | 'alliance'>().notNull(),
    organizationId: bigint('organization_id', { mode: 'number' }).notNull(),
    organizationName: text('organization_name').notNull(),
    organizationTicker: text('organization_ticker').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    supersededAt: timestamp('superseded_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    primaryKey({ columns: [table.deploymentId, table.organizationVersion] }),
    unique('organization_epochs_identity_key').on(
      table.deploymentId,
      table.organizationVersion,
      table.organizationId,
    ),
    check('organization_epochs_deployment_check', sql`deployment_id = 1`),
    check('organization_epochs_version_check', sql`organization_version > 0`),
    check('organization_epochs_type_check', sql`organization_type in ('corporation', 'alliance')`),
    check('organization_epochs_organization_id_check', sql`organization_id > 0`),
    check(
      'organization_epochs_superseded_at_check',
      sql`superseded_at is null or superseded_at >= created_at`,
    ),
  ],
)
