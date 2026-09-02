import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { users } from './identity.js'
import { organizationEpochs } from './organization-epochs.js'
import { auditTimestamps } from './shared.js'

export const organizationPermissionTypes = ['module', 'service'] as const
export type OrganizationPermissionType = (typeof organizationPermissionTypes)[number]
export const organizationGroupManagementModes = ['manual', 'compliance'] as const
export type OrganizationGroupManagementMode = (typeof organizationGroupManagementModes)[number]
export const organizationComplianceSources = ['core.registration'] as const
export type OrganizationComplianceSource = (typeof organizationComplianceSources)[number]

export const organizationPermissionBundles = pgTable(
  'organization_permission_bundles',
  {
    bundleId: uuid('bundle_id').defaultRandom().primaryKey().notNull(),
    deploymentId: smallint('deployment_id').default(1).notNull(),
    organizationVersion: bigint('organization_version', { mode: 'number' }).notNull(),
    name: text().notNull(),
    createdByUserId: uuid('created_by_user_id').notNull(),
    ...auditTimestamps(),
  },
  (table) => [
    unique('organization_permission_bundles_version_key').on(
      table.bundleId,
      table.deploymentId,
      table.organizationVersion,
    ),
    foreignKey({
      columns: [table.deploymentId, table.organizationVersion],
      foreignColumns: [organizationEpochs.deploymentId, organizationEpochs.organizationVersion],
      name: 'organization_permission_bundles_epoch_fkey',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.createdByUserId],
      foreignColumns: [users.id],
      name: 'organization_permission_bundles_creator_fkey',
    }).onDelete('restrict'),
    check(
      'organization_permission_bundles_name_check',
      sql`name = trim(name) and length(name) between 1 and 100`,
    ),
    uniqueIndex('organization_permission_bundles_name_key').on(
      table.deploymentId,
      table.organizationVersion,
      sql`lower(${table.name})`,
    ),
  ],
)

export const organizationPermissionBundleEntries = pgTable(
  'organization_permission_bundle_entries',
  {
    bundleId: uuid('bundle_id').notNull(),
    deploymentId: smallint('deployment_id').default(1).notNull(),
    organizationVersion: bigint('organization_version', { mode: 'number' }).notNull(),
    permissionType: text('permission_type').$type<OrganizationPermissionType>().notNull(),
    permissionKey: text('permission_key').notNull(),
    reviewAllowed: boolean('review_allowed').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.bundleId, table.permissionType, table.permissionKey] }),
    foreignKey({
      columns: [table.bundleId, table.deploymentId, table.organizationVersion],
      foreignColumns: [
        organizationPermissionBundles.bundleId,
        organizationPermissionBundles.deploymentId,
        organizationPermissionBundles.organizationVersion,
      ],
      name: 'organization_permission_bundle_entries_bundle_fkey',
    }).onDelete('restrict'),
    check(
      'organization_permission_bundle_entries_type_check',
      sql`permission_type in ('module', 'service')`,
    ),
    check(
      'organization_permission_bundle_entries_key_check',
      sql`length(permission_key) between 1 and 200
        and permission_key ~ '^[a-z][a-z0-9-]*([.:-][a-z0-9-]+)*$'`,
    ),
  ],
)

export const organizationGroups = pgTable(
  'organization_groups',
  {
    groupId: uuid('group_id').defaultRandom().primaryKey().notNull(),
    deploymentId: smallint('deployment_id').default(1).notNull(),
    organizationVersion: bigint('organization_version', { mode: 'number' }).notNull(),
    name: text().notNull(),
    restricted: boolean().default(false).notNull(),
    managementMode: text('management_mode')
      .$type<OrganizationGroupManagementMode>()
      .default('manual')
      .notNull(),
    complianceSource: text('compliance_source').$type<OrganizationComplianceSource>(),
    createdByUserId: uuid('created_by_user_id').notNull(),
    ...auditTimestamps(),
  },
  (table) => [
    unique('organization_groups_version_key').on(
      table.groupId,
      table.deploymentId,
      table.organizationVersion,
    ),
    foreignKey({
      columns: [table.deploymentId, table.organizationVersion],
      foreignColumns: [organizationEpochs.deploymentId, organizationEpochs.organizationVersion],
      name: 'organization_groups_epoch_fkey',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.createdByUserId],
      foreignColumns: [users.id],
      name: 'organization_groups_creator_fkey',
    }).onDelete('restrict'),
    check(
      'organization_groups_name_check',
      sql`name = trim(name) and length(name) between 1 and 100`,
    ),
    check(
      'organization_groups_management_check',
      sql`(management_mode = 'manual' and compliance_source is null)
        or (
          management_mode = 'compliance'
          and compliance_source in ('core.registration')
        )`,
    ),
    uniqueIndex('organization_groups_name_key').on(
      table.deploymentId,
      table.organizationVersion,
      sql`lower(${table.name})`,
    ),
    index('organization_groups_compliance_source_idx')
      .on(table.deploymentId, table.organizationVersion, table.complianceSource)
      .where(sql`management_mode = 'compliance'`),
  ],
)

export const organizationGroupPermissionBundles = pgTable(
  'organization_group_permission_bundles',
  {
    groupId: uuid('group_id').notNull(),
    bundleId: uuid('bundle_id').notNull(),
    deploymentId: smallint('deployment_id').default(1).notNull(),
    organizationVersion: bigint('organization_version', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.bundleId] }),
    foreignKey({
      columns: [table.groupId, table.deploymentId, table.organizationVersion],
      foreignColumns: [
        organizationGroups.groupId,
        organizationGroups.deploymentId,
        organizationGroups.organizationVersion,
      ],
      name: 'organization_group_permission_bundles_group_fkey',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.bundleId, table.deploymentId, table.organizationVersion],
      foreignColumns: [
        organizationPermissionBundles.bundleId,
        organizationPermissionBundles.deploymentId,
        organizationPermissionBundles.organizationVersion,
      ],
      name: 'organization_group_permission_bundles_bundle_fkey',
    }).onDelete('restrict'),
  ],
)

export const organizationGroupAssignments = pgTable(
  'organization_group_assignments',
  {
    assignmentId: uuid('assignment_id').defaultRandom().primaryKey().notNull(),
    groupId: uuid('group_id').notNull(),
    deploymentId: smallint('deployment_id').default(1).notNull(),
    organizationVersion: bigint('organization_version', { mode: 'number' }).notNull(),
    userId: uuid('user_id').notNull(),
    assignmentSource: text('assignment_source').$type<OrganizationGroupManagementMode>().notNull(),
    complianceSource: text('compliance_source').$type<OrganizationComplianceSource>(),
    assignedActorType: text('assigned_actor_type').$type<'user' | 'system'>().notNull(),
    assignedByUserId: uuid('assigned_by_user_id'),
    reason: text().notNull(),
    assignedAt: timestamp('assigned_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    revokedActorType: text('revoked_actor_type').$type<'user' | 'system'>(),
    revokedByUserId: uuid('revoked_by_user_id'),
    revocationReason: text('revocation_reason'),
    ...auditTimestamps(),
  },
  (table) => [
    unique('organization_group_assignments_version_key').on(
      table.assignmentId,
      table.deploymentId,
      table.organizationVersion,
    ),
    foreignKey({
      columns: [table.groupId, table.deploymentId, table.organizationVersion],
      foreignColumns: [
        organizationGroups.groupId,
        organizationGroups.deploymentId,
        organizationGroups.organizationVersion,
      ],
      name: 'organization_group_assignments_group_fkey',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'organization_group_assignments_user_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.assignedByUserId],
      foreignColumns: [users.id],
      name: 'organization_group_assignments_assigned_by_fkey',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.revokedByUserId],
      foreignColumns: [users.id],
      name: 'organization_group_assignments_revoked_by_fkey',
    }).onDelete('restrict'),
    check(
      'organization_group_assignments_source_check',
      sql`assignment_source in ('manual', 'compliance')`,
    ),
    check(
      'organization_group_assignments_assignment_actor_check',
      sql`(
          assignment_source = 'manual'
          and assigned_actor_type = 'user'
          and assigned_by_user_id is not null
        ) or (
          assignment_source = 'compliance'
          and assigned_actor_type = 'system'
          and assigned_by_user_id is null
          and expires_at is null
        )`,
    ),
    check(
      'organization_group_assignments_reason_check',
      sql`length(trim(reason)) between 1 and 2000`,
    ),
    check(
      'organization_group_assignments_expiry_check',
      sql`expires_at is null or expires_at > assigned_at`,
    ),
    check(
      'organization_group_assignments_revocation_check',
      sql`(
          revoked_at is null
          and revoked_actor_type is null
          and revoked_by_user_id is null
          and revocation_reason is null
        ) or (
          revoked_at is not null
          and revoked_at >= assigned_at
          and revoked_actor_type in ('user', 'system')
          and (
            (revoked_actor_type = 'user' and revoked_by_user_id is not null)
            or (revoked_actor_type = 'system' and revoked_by_user_id is null)
          )
          and length(trim(revocation_reason)) between 1 and 2000
        )`,
    ),
    uniqueIndex('organization_group_assignments_active_key')
      .on(table.deploymentId, table.organizationVersion, table.groupId, table.userId)
      .where(sql`revoked_at is null`),
    index('organization_group_assignments_entitlement_idx')
      .on(
        table.deploymentId,
        table.organizationVersion,
        table.userId,
        table.expiresAt,
        table.groupId,
      )
      .where(sql`revoked_at is null`),
  ],
)

export type OrganizationGroupRow = typeof organizationGroups.$inferSelect
export type OrganizationGroupAssignmentRow = typeof organizationGroupAssignments.$inferSelect
