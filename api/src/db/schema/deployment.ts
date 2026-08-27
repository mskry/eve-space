import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { auditTimestamps } from './shared.js'

export type DeploymentOrganizationType = 'corporation' | 'alliance'

export const deploymentAdmins = pgTable(
  'deployment_admins',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    email: text().notNull(),
    passwordHash: text('password_hash').notNull(),
    ...auditTimestamps(),
  },
  (table) => [
    uniqueIndex('deployment_admins_email_key').on(table.email),
    check('deployment_admins_email_normalized_check', sql`email = lower(trim(email))`),
  ],
)

export const deploymentInstallationSettings = pgTable(
  'deployment_installation_settings',
  {
    id: smallint().default(1).primaryKey().notNull(),
    plannerScheduleOffsetMs: integer('planner_schedule_offset_ms')
      .default(sql`floor(random() * 60000)::integer`)
      .notNull(),
    ...auditTimestamps(),
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
    ...auditTimestamps(),
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
