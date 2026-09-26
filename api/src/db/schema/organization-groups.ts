import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgSequence,
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
import type { RuleConditionKind } from '../../organization/rule-policy.js'
import { organizationEpochs } from './organization-epochs.js'
import { auditTimestamps } from './shared.js'

export const organizationPermissionTypes = ['module', 'service'] as const
export type OrganizationPermissionType = (typeof organizationPermissionTypes)[number]
export const organizationGroupManagementModes = ['manual', 'compliance', 'rule'] as const
export type OrganizationGroupManagementMode = (typeof organizationGroupManagementModes)[number]
export const organizationComplianceSources = ['core.registration'] as const
export type OrganizationComplianceSource = (typeof organizationComplianceSources)[number]
export const organizationGroupRuleSources = [
  'registration',
  'explicit-director',
  'derived-director',
  'corporation-role',
] as const
export type OrganizationGroupRuleSource = (typeof organizationGroupRuleSources)[number]

export const organizationAllianceExecutorObservationSequence = pgSequence(
  'organization_alliance_executor_observation_sequence',
  { startWith: 1 },
)

export const organizationAllianceExecutorObservations = pgTable(
  'organization_alliance_executor_observations',
  {
    allianceId: bigint('alliance_id', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    deploymentId: smallint('deployment_id').default(1).notNull(),
    executorCorporationId: bigint('executor_corporation_id', { mode: 'number' }),
    executorRevision: uuid('executor_revision'),
    freshUntil: timestamp('fresh_until', { withTimezone: true, mode: 'date' }),
    lastAppliedSequence: bigint('last_applied_sequence', { mode: 'bigint' }).default(0n).notNull(),
    nextRefreshAt: timestamp('next_refresh_at', { withTimezone: true, mode: 'date' }).notNull(),
    organizationVersion: bigint('organization_version', { mode: 'number' }).notNull(),
    status: text().$type<'pending' | 'fresh' | 'invalid'>().default('pending').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    validatedAt: timestamp('validated_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    primaryKey({ columns: [table.deploymentId, table.organizationVersion] }),
    foreignKey({
      columns: [table.deploymentId, table.organizationVersion, table.allianceId],
      foreignColumns: [
        organizationEpochs.deploymentId,
        organizationEpochs.organizationVersion,
        organizationEpochs.organizationId,
      ],
      name: 'organization_alliance_executor_observations_epoch_fkey',
    }).onDelete('restrict'),
    check('organization_alliance_executor_observations_identity_check', sql`alliance_id > 0`),
    check(
      'organization_alliance_executor_observations_sequence_check',
      sql`last_applied_sequence >= 0`,
    ),
    check(
      'organization_alliance_executor_observations_state_check',
      sql`(status = 'pending' and executor_corporation_id is null
          and executor_revision is null and validated_at is null and fresh_until is null)
        or (status = 'fresh' and executor_corporation_id > 0
          and executor_revision is not null and validated_at is not null
          and fresh_until > validated_at)
        or (status = 'invalid' and executor_corporation_id is null
          and executor_revision is not null and validated_at is not null
          and fresh_until > validated_at)`,
    ),
    index('organization_alliance_executor_observations_due_idx').on(
      table.nextRefreshAt,
      table.organizationVersion,
    ),
  ],
)

export const organizationPermissionBundles = pgTable(
  'organization_permission_bundles',
  {
    bundleId: uuid('bundle_id').defaultRandom().primaryKey().notNull(),
    createdByUserId: uuid('created_by_user_id').notNull(),
    deploymentId: smallint('deployment_id').default(1).notNull(),
    name: text().notNull(),
    organizationVersion: bigint('organization_version', { mode: 'number' }).notNull(),
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
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    deploymentId: smallint('deployment_id').default(1).notNull(),
    entryId: uuid('entry_id').defaultRandom().notNull(),
    moduleId: text('module_id'),
    organizationVersion: bigint('organization_version', { mode: 'number' }).notNull(),
    permissionKey: text('permission_key').notNull(),
    permissionType: text('permission_type').$type<OrganizationPermissionType>().notNull(),
    publisherPackage: text('publisher_package'),
    reviewAllowed: boolean('review_allowed').default(false).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.entryId] }),
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
    check(
      'organization_permission_bundle_entries_ownership_check',
      sql`(
        permission_type = 'service'
        and publisher_package is null
        and module_id is null
      ) or (
        permission_type = 'module'
        and (
          (publisher_package is null and module_id is null)
          or (
            publisher_package = trim(publisher_package)
            and length(publisher_package) between 1 and 214
            and module_id is not null
            and is_valid_module_id(module_id)
          )
        )
      )`,
    ),
    uniqueIndex('organization_permission_bundle_entries_service_key')
      .on(table.bundleId, table.permissionKey)
      .where(sql`permission_type = 'service'`),
    uniqueIndex('organization_permission_bundle_entries_module_key')
      .on(table.bundleId, table.publisherPackage, table.moduleId, table.permissionKey)
      .where(sql`permission_type = 'module' and publisher_package is not null`),
    uniqueIndex('organization_permission_bundle_entries_legacy_module_key')
      .on(table.bundleId, table.permissionKey)
      .where(sql`permission_type = 'module' and publisher_package is null`),
  ],
)

export const organizationGroups = pgTable(
  'organization_groups',
  {
    complianceSource: text('compliance_source').$type<OrganizationComplianceSource>(),
    createdByUserId: uuid('created_by_user_id').notNull(),
    deploymentId: smallint('deployment_id').default(1).notNull(),
    groupId: uuid('group_id').defaultRandom().primaryKey().notNull(),
    managementMode: text('management_mode')
      .$type<OrganizationGroupManagementMode>()
      .default('manual')
      .notNull(),
    name: text().notNull(),
    organizationVersion: bigint('organization_version', { mode: 'number' }).notNull(),
    restricted: boolean().default(false).notNull(),
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
        ) or (management_mode = 'rule' and compliance_source is null and restricted)`,
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
    bundleId: uuid('bundle_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    deploymentId: smallint('deployment_id').default(1).notNull(),
    groupId: uuid('group_id').notNull(),
    organizationVersion: bigint('organization_version', { mode: 'number' }).notNull(),
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

export const organizationGroupRules = pgTable(
  'organization_group_rules',
  {
    conditionKind: text('condition_kind').$type<RuleConditionKind>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    deploymentId: smallint('deployment_id').default(1).notNull(),
    enabled: boolean().default(false).notNull(),
    groupId: uuid('group_id').primaryKey().notNull(),
    organizationVersion: bigint('organization_version', { mode: 'number' }).notNull(),
    predicateKey: text('predicate_key'),
    revision: bigint({ mode: 'number' }).default(1).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedByUserId: uuid('updated_by_user_id').notNull(),
  },
  (table) => [
    unique('organization_group_rules_version_key').on(
      table.groupId,
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
      name: 'organization_group_rules_group_fkey',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.updatedByUserId],
      foreignColumns: [users.id],
      name: 'organization_group_rules_actor_fkey',
    }).onDelete('restrict'),
    check('organization_group_rules_revision_check', sql`revision > 0`),
    check(
      'organization_group_rules_condition_check',
      sql`(condition_kind in ('registration-compliant', 'director-audience')
          and predicate_key is null)
        or (condition_kind = 'corporation-role'
          and predicate_key in ('director', 'accountant', 'factory-manager'))`,
    ),
  ],
)

export const organizationGroupRuleRevisions = pgTable(
  'organization_group_rule_revisions',
  {
    bundleIds: uuid('bundle_ids').array().notNull(),
    changedByUserId: uuid('changed_by_user_id').notNull(),
    conditionKind: text('condition_kind').$type<RuleConditionKind>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    deploymentId: smallint('deployment_id').default(1).notNull(),
    enabled: boolean().notNull(),
    groupId: uuid('group_id').notNull(),
    organizationVersion: bigint('organization_version', { mode: 'number' }).notNull(),
    predicateKey: text('predicate_key'),
    revision: bigint({ mode: 'number' }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.groupId, table.deploymentId, table.organizationVersion, table.revision],
    }),
    foreignKey({
      columns: [table.groupId, table.deploymentId, table.organizationVersion],
      foreignColumns: [
        organizationGroupRules.groupId,
        organizationGroupRules.deploymentId,
        organizationGroupRules.organizationVersion,
      ],
      name: 'organization_group_rule_revisions_rule_fkey',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.changedByUserId],
      foreignColumns: [users.id],
      name: 'organization_group_rule_revisions_actor_fkey',
    }).onDelete('restrict'),
    check('organization_group_rule_revisions_revision_check', sql`revision > 0`),
    check(
      'organization_group_rule_revisions_bundles_check',
      sql`cardinality(bundle_ids) between 1 and 50 and array_position(bundle_ids, null) is null`,
    ),
    check(
      'organization_group_rule_revisions_condition_check',
      sql`(condition_kind in ('registration-compliant', 'director-audience')
          and predicate_key is null)
        or (condition_kind = 'corporation-role'
          and predicate_key in ('director', 'accountant', 'factory-manager'))`,
    ),
  ],
)

export const organizationGroupAssignments = pgTable(
  'organization_group_assignments',
  {
    assignedActorType: text('assigned_actor_type').$type<'user' | 'system'>().notNull(),
    assignedAt: timestamp('assigned_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
    assignedByUserId: uuid('assigned_by_user_id'),
    assignmentId: uuid('assignment_id').defaultRandom().primaryKey().notNull(),
    assignmentSource: text('assignment_source').$type<OrganizationGroupManagementMode>().notNull(),
    complianceSource: text('compliance_source').$type<OrganizationComplianceSource>(),
    deploymentId: smallint('deployment_id').default(1).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    groupId: uuid('group_id').notNull(),
    organizationVersion: bigint('organization_version', { mode: 'number' }).notNull(),
    reason: text().notNull(),
    ruleRevision: bigint('rule_revision', { mode: 'number' }),
    revocationReason: text('revocation_reason'),
    revokedActorType: text('revoked_actor_type').$type<'user' | 'system'>(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    revokedByUserId: uuid('revoked_by_user_id'),
    userId: uuid('user_id').notNull(),
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
      columns: [table.groupId, table.deploymentId, table.organizationVersion, table.ruleRevision],
      foreignColumns: [
        organizationGroupRuleRevisions.groupId,
        organizationGroupRuleRevisions.deploymentId,
        organizationGroupRuleRevisions.organizationVersion,
        organizationGroupRuleRevisions.revision,
      ],
      name: 'organization_group_assignments_rule_revision_fkey',
    }).onDelete('restrict'),
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
      sql`assignment_source in ('manual', 'compliance', 'rule')`,
    ),
    check(
      'organization_group_assignments_assignment_actor_check',
      sql`(
          assignment_source = 'manual'
          and assigned_actor_type = 'user'
          and assigned_by_user_id is not null
          and rule_revision is null
        ) or (
          assignment_source = 'compliance'
          and assigned_actor_type = 'system'
          and assigned_by_user_id is null
          and expires_at is null
          and rule_revision is null
        ) or (
          assignment_source = 'rule'
          and assigned_actor_type = 'system'
          and assigned_by_user_id is null
          and compliance_source is null
          and expires_at is not null
          and rule_revision > 0
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

export const organizationGroupRuleAttestations = pgTable(
  'organization_group_rule_attestations',
  {
    affiliationPeriodRevision: uuid('affiliation_period_revision'),
    assignmentId: uuid('assignment_id').notNull(),
    authorityCorporationId: bigint('authority_corporation_id', { mode: 'number' }),
    authorizationGeneration: integer('authorization_generation'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    executorFreshUntil: timestamp('executor_fresh_until', { withTimezone: true, mode: 'date' }),
    executorRevision: uuid('executor_revision'),
    roleRevision: uuid('role_revision'),
    sourceId: uuid('source_id').notNull(),
    sourceKind: text('source_kind').$type<OrganizationGroupRuleSource>().notNull(),
    subjectLifecycleId: uuid('subject_lifecycle_id'),
    validUntil: timestamp('valid_until', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.assignmentId, table.sourceKind, table.sourceId] }),
    foreignKey({
      columns: [table.assignmentId],
      foreignColumns: [organizationGroupAssignments.assignmentId],
      name: 'organization_group_rule_attestations_assignment_fkey',
    }).onDelete('cascade'),
    check(
      'organization_group_rule_attestations_kind_check',
      sql`source_kind in ('registration', 'explicit-director', 'derived-director', 'corporation-role')`,
    ),
    check(
      'organization_group_rule_attestations_binding_check',
      sql`(source_kind in ('registration', 'explicit-director')
          and subject_lifecycle_id is null and affiliation_period_revision is null
          and authorization_generation is null and authority_corporation_id is null
          and role_revision is null)
        or (source_kind in ('derived-director', 'corporation-role')
          and subject_lifecycle_id is not null and affiliation_period_revision is not null
          and authorization_generation >= 0 and authority_corporation_id > 0
          and role_revision is not null)`,
    ),
    check(
      'organization_group_rule_attestations_executor_check',
      sql`(executor_revision is null and executor_fresh_until is null)
        or (source_kind in ('corporation-role', 'derived-director')
          and executor_revision is not null and executor_fresh_until is not null)`,
    ),
    index('organization_group_rule_attestations_source_idx').on(
      table.sourceKind,
      table.sourceId,
      table.validUntil,
    ),
  ],
)

export const organizationGroupRuleReconciliation = pgTable(
  'organization_group_rule_reconciliation',
  {
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    cursorUserId: uuid('cursor_user_id'),
    deploymentId: smallint('deployment_id').default(1).notNull(),
    groupId: uuid('group_id').primaryKey().notNull(),
    organizationVersion: bigint('organization_version', { mode: 'number' }).notNull(),
    revision: bigint({ mode: 'number' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.groupId, table.deploymentId, table.organizationVersion, table.revision],
      foreignColumns: [
        organizationGroupRuleRevisions.groupId,
        organizationGroupRuleRevisions.deploymentId,
        organizationGroupRuleRevisions.organizationVersion,
        organizationGroupRuleRevisions.revision,
      ],
      name: 'organization_group_rule_reconciliation_revision_fkey',
    }).onDelete('restrict'),
    check('organization_group_rule_reconciliation_revision_check', sql`revision > 0`),
  ],
)

export type OrganizationGroupRow = typeof organizationGroups.$inferSelect
export type OrganizationGroupAssignmentRow = typeof organizationGroupAssignments.$inferSelect
