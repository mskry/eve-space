import { and, asc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '../db/client.js'
import {
  organizationAccountCompliance,
  organizationGroupAssignments,
  organizationGroupPermissionBundles,
  organizationGroups,
  organizationPermissionBundleEntries,
  organizationPermissionBundles,
  users,
  type OrganizationComplianceSource,
  type OrganizationGroupManagementMode,
} from '../db/schema.js'
import {
  loadCurrentGroupForUpdate,
  loadUnrevokedGroupAssignmentByIdForUpdate,
  loadUnrevokedGroupAssignmentForUpdate,
  revokeGroupAssignmentRecord,
  toOrganizationGroupAssignment,
} from './group-assignment-store.js'
import { appendGroupAudit } from './group-audit.js'
import {
  expireOrganizationGroupAssignments,
  expiredGroupAssignmentReason,
} from './group-assignment-expiry.js'
import { convergeRegistrationComplianceGroupsInTransaction } from './group-compliance.js'
import { OrganizationGroupMutationError } from './group-mutation-error.js'
import { reviseRulesForPermissionBundleInTransaction } from './group-rule-revisions.js'
import {
  loadManagementAuthority,
  type OrganizationManagementAuthority,
} from './management-authority.js'
import { lockCurrentOrganization } from './organization-lock.js'
import { appendPermissionBundleAudit } from './permission-bundle-audit.js'
import type { PermissionSelection } from './permission-catalog-policy.js'
import {
  listEnabledPermissionCatalog,
  OrganizationPermissionCatalogError,
  resolveCurrentPermissionSelections,
  type StoredPermission,
} from './permission-catalog-store.js'

type Transaction = DatabaseTransaction

export async function createOrganizationPermissionBundle(input: {
  actorUserId: string
  name: string
  reason: string
  permissions: PermissionSelection[]
}) {
  return db.transaction(async (transaction) => {
    const organization = await lockCurrentOrganization(transaction)
    await requireOwner(transaction, organization.organizationVersion, input.actorUserId)
    const [existing] = await transaction
      .select({ bundleId: organizationPermissionBundles.bundleId })
      .from(organizationPermissionBundles)
      .where(
        and(
          eq(organizationPermissionBundles.deploymentId, 1),
          eq(organizationPermissionBundles.organizationVersion, organization.organizationVersion),
          sql`lower(${organizationPermissionBundles.name}) = ${input.name.toLowerCase()}`,
        ),
      )
    if (existing) {
      throw new OrganizationGroupMutationError('bundle-name-conflict')
    }

    const [bundle] = await transaction
      .insert(organizationPermissionBundles)
      .values({
        createdByUserId: input.actorUserId,
        deploymentId: 1,
        name: input.name,
        organizationVersion: organization.organizationVersion,
      })
      .returning()
    if (!bundle) {
      throw new Error('Failed to create organization permission bundle')
    }

    const permissions = await resolvePermissions(transaction, input.permissions)
    await transaction.insert(organizationPermissionBundleEntries).values(
      permissions.map((permission) => ({
        bundleId: bundle.bundleId,
        deploymentId: 1,
        moduleId: permission.type === 'module' ? permission.moduleId : undefined,
        organizationVersion: organization.organizationVersion,
        permissionKey: permission.key,
        permissionType: permission.type,
        publisherPackage: permission.type === 'module' ? permission.publisherPackage : undefined,
        reviewAllowed: permission.reviewAllowed,
      })),
    )
    await appendPermissionBundleAudit(transaction, organization, {
      actorUserId: input.actorUserId,
      bundleId: bundle.bundleId,
      eventType: 'permission-bundle.created',
      now: new Date(),
      reason: input.reason,
    })
    return {
      bundleId: bundle.bundleId,
      name: bundle.name,
      organizationVersion: bundle.organizationVersion,
      permissions,
    }
  })
}

export async function updateOrganizationPermissionBundle(input: {
  actorUserId: string
  bundleId: string
  name: string
  reason: string
  permissions: PermissionSelection[]
  retainedUnavailableEntryIds: string[]
}) {
  return db.transaction(async (transaction) => {
    const organization = await lockCurrentOrganization(transaction)
    await requireOwner(transaction, organization.organizationVersion, input.actorUserId)
    const [bundle] = await transaction
      .select()
      .from(organizationPermissionBundles)
      .where(
        and(
          eq(organizationPermissionBundles.bundleId, input.bundleId),
          eq(organizationPermissionBundles.deploymentId, 1),
          eq(organizationPermissionBundles.organizationVersion, organization.organizationVersion),
        ),
      )
      .for('update')
    if (!bundle) {
      throw new OrganizationGroupMutationError('bundle-not-found')
    }
    const [existing] = await transaction
      .select({ bundleId: organizationPermissionBundles.bundleId })
      .from(organizationPermissionBundles)
      .where(
        and(
          eq(organizationPermissionBundles.deploymentId, 1),
          eq(organizationPermissionBundles.organizationVersion, organization.organizationVersion),
          ne(organizationPermissionBundles.bundleId, input.bundleId),
          sql`lower(${organizationPermissionBundles.name}) = ${input.name.toLowerCase()}`,
        ),
      )
    if (existing) {
      throw new OrganizationGroupMutationError('bundle-name-conflict')
    }

    const [permissions, retainedPermissions] = await Promise.all([
      resolvePermissions(transaction, input.permissions),
      loadRetainedUnavailablePermissions(
        transaction,
        organization.organizationVersion,
        input.bundleId,
        input.retainedUnavailableEntryIds,
      ),
    ])
    await transaction
      .update(organizationPermissionBundles)
      .set({ name: input.name, updatedAt: new Date() })
      .where(eq(organizationPermissionBundles.bundleId, input.bundleId))
    await transaction
      .delete(organizationPermissionBundleEntries)
      .where(eq(organizationPermissionBundleEntries.bundleId, input.bundleId))
    if (permissions.length > 0 || retainedPermissions.length > 0) {
      await transaction.insert(organizationPermissionBundleEntries).values([
        ...permissions.map((permission) => ({
          bundleId: input.bundleId,
          deploymentId: 1,
          moduleId: permission.type === 'module' ? permission.moduleId : undefined,
          organizationVersion: organization.organizationVersion,
          permissionKey: permission.key,
          permissionType: permission.type,
          publisherPackage: permission.type === 'module' ? permission.publisherPackage : undefined,
          reviewAllowed: permission.reviewAllowed,
        })),
        ...retainedPermissions,
      ])
    }
    await appendPermissionBundleAudit(transaction, organization, {
      actorUserId: input.actorUserId,
      bundleId: input.bundleId,
      eventType: 'permission-bundle.updated',
      now: new Date(),
      reason: input.reason,
    })
    await reviseRulesForPermissionBundleInTransaction(
      transaction,
      organization,
      input.bundleId,
      input.actorUserId,
      input.reason,
    )
    return {
      bundleId: input.bundleId,
      name: input.name,
      organizationVersion: organization.organizationVersion,
      permissions,
    }
  })
}

export async function listCurrentOrganizationPermissionBundles(actorUserId: string) {
  return db.transaction(async (transaction) => {
    const organization = await lockCurrentOrganization(transaction)
    await requireOwner(transaction, organization.organizationVersion, actorUserId)
    const [bundles, entries, currentCatalog] = await Promise.all([
      transaction
        .select()
        .from(organizationPermissionBundles)
        .where(
          and(
            eq(organizationPermissionBundles.deploymentId, 1),
            eq(organizationPermissionBundles.organizationVersion, organization.organizationVersion),
          ),
        )
        .orderBy(
          asc(organizationPermissionBundles.name),
          asc(organizationPermissionBundles.bundleId),
        ),
      transaction
        .select()
        .from(organizationPermissionBundleEntries)
        .where(
          and(
            eq(organizationPermissionBundleEntries.deploymentId, 1),
            eq(
              organizationPermissionBundleEntries.organizationVersion,
              organization.organizationVersion,
            ),
          ),
        )
        .orderBy(
          asc(organizationPermissionBundleEntries.bundleId),
          asc(organizationPermissionBundleEntries.permissionType),
          asc(organizationPermissionBundleEntries.publisherPackage),
          asc(organizationPermissionBundleEntries.moduleId),
          asc(organizationPermissionBundleEntries.permissionKey),
        ),
      listEnabledPermissionCatalog(transaction),
    ])
    const declarations = new Map(
      currentCatalog.permissions.map((permission) => [
        `${permission.publisherPackage}\u0000${permission.moduleId}\u0000${permission.key}`,
        permission,
      ]),
    )
    return {
      bundles: bundles.map((bundle) => ({
        bundleId: bundle.bundleId,
        name: bundle.name,
        organizationVersion: bundle.organizationVersion,
        permissions: entries
          .filter(({ bundleId }) => bundleId === bundle.bundleId)
          .map((entry) => {
            if (entry.permissionType === 'service') {
              return {
                entryId: entry.entryId,
                type: 'service' as const,
                key: entry.permissionKey,
                reviewAllowed: entry.reviewAllowed,
                available: true,
              }
            }
            const declaration = declarations.get(
              `${entry.publisherPackage ?? ''}\u0000${entry.moduleId ?? ''}\u0000${entry.permissionKey}`,
            )
            if (declaration) {
              return {
                entryId: entry.entryId,
                type: 'module' as const,
                publisherPackage: entry.publisherPackage,
                moduleId: entry.moduleId,
                key: entry.permissionKey,
                reviewAllowed: entry.reviewAllowed,
                available: true,
                label: declaration.label,
                purpose: declaration.purpose,
                audiences: declaration.audiences,
                sensitivity: declaration.sensitivity,
                currentReviewAllowed: declaration.reviewAllowed,
              }
            }
            return {
              entryId: entry.entryId,
              type: 'module' as const,
              publisherPackage: entry.publisherPackage,
              moduleId: entry.moduleId,
              key: entry.permissionKey,
              reviewAllowed: entry.reviewAllowed,
              available: false,
            }
          }),
      })),
    }
  })
}

export async function createOrganizationGroup(input: {
  actorUserId: string
  name: string
  restricted: boolean
  managementMode: OrganizationGroupManagementMode
  complianceSource: OrganizationComplianceSource | null
  bundleIds: string[]
}) {
  return db.transaction(async (transaction) => {
    const organization = await lockCurrentOrganization(transaction)
    const now = new Date()
    await requireOwner(transaction, organization.organizationVersion, input.actorUserId)

    const [existing] = await transaction
      .select({ groupId: organizationGroups.groupId })
      .from(organizationGroups)
      .where(
        and(
          eq(organizationGroups.deploymentId, 1),
          eq(organizationGroups.organizationVersion, organization.organizationVersion),
          sql`lower(${organizationGroups.name}) = ${input.name.toLowerCase()}`,
        ),
      )
    if (existing) {
      throw new OrganizationGroupMutationError('group-name-conflict')
    }

    const bundleIds = [...new Set(input.bundleIds)]
    const bundles = await transaction
      .select({ bundleId: organizationPermissionBundles.bundleId })
      .from(organizationPermissionBundles)
      .where(
        and(
          eq(organizationPermissionBundles.deploymentId, 1),
          eq(organizationPermissionBundles.organizationVersion, organization.organizationVersion),
          inArray(organizationPermissionBundles.bundleId, bundleIds),
        ),
      )
    if (bundles.length !== bundleIds.length) {
      throw new OrganizationGroupMutationError('bundle-not-found')
    }

    const [group] = await transaction
      .insert(organizationGroups)
      .values({
        complianceSource: input.complianceSource,
        createdByUserId: input.actorUserId,
        deploymentId: 1,
        managementMode: input.managementMode,
        name: input.name,
        organizationVersion: organization.organizationVersion,
        restricted: input.restricted,
      })
      .returning()
    if (!group) {
      throw new Error('Failed to create organization group')
    }

    await transaction.insert(organizationGroupPermissionBundles).values(
      bundleIds.map((bundleId) => ({
        bundleId,
        deploymentId: 1,
        groupId: group.groupId,
        organizationVersion: organization.organizationVersion,
      })),
    )
    if (group.managementMode === 'compliance' && group.complianceSource === 'core.registration') {
      const eligibleAccounts = await transaction
        .select({ userId: organizationAccountCompliance.userId })
        .from(organizationAccountCompliance)
        .where(
          and(
            eq(organizationAccountCompliance.deploymentId, 1),
            eq(organizationAccountCompliance.organizationVersion, organization.organizationVersion),
            eq(organizationAccountCompliance.authoritative, true),
            gt(organizationAccountCompliance.accessValidUntil, now),
          ),
        )
        .orderBy(asc(organizationAccountCompliance.userId))
      for (const { userId } of eligibleAccounts) {
        // oxlint-disable-next-line no-await-in-loop -- Group locks must follow stable user order.
        await convergeRegistrationComplianceGroupsInTransaction(transaction, {
          eligible: true,
          now,
          organizationVersion: organization.organizationVersion,
          policyVersion: organization.policyVersion,
          userId,
        })
      }
    }
    return toGroup(group, bundleIds)
  })
}

export async function assignOrganizationGroup(input: {
  actorUserId: string
  groupId: string
  targetUserId: string
  reason: string
  expiresAt: Date | null
}) {
  return db.transaction(async (transaction) => {
    const organization = await lockCurrentOrganization(transaction)
    const group = await loadCurrentGroupForUpdate(
      transaction,
      organization.organizationVersion,
      input.groupId,
    )
    const authority = await requireManager(
      transaction,
      organization.organizationVersion,
      input.actorUserId,
    )
    requireGroupManagementAuthority(group, authority)
    return assignManualOrganizationGroupInTransaction(transaction, organization, group, input)
  })
}

export async function assignManualOrganizationGroupInTransaction(
  transaction: Transaction,
  organization: { organizationVersion: number; policyVersion: number },
  group: typeof organizationGroups.$inferSelect,
  input: {
    actorUserId: string
    targetUserId: string
    reason: string
    expiresAt: Date | null
  },
) {
  assertManualGroup(group)

  const [target] = await transaction
    .select({ userId: users.id })
    .from(users)
    .where(eq(users.id, input.targetUserId))
  if (!target) {
    throw new OrganizationGroupMutationError('target-not-found')
  }

  const now = new Date()
  if (input.expiresAt && input.expiresAt <= now) {
    throw new OrganizationGroupMutationError('invalid-expiry')
  }
  const existing = await loadUnrevokedGroupAssignmentForUpdate(
    transaction,
    organization.organizationVersion,
    group.groupId,
    input.targetUserId,
  )
  if (existing && (!existing.expiresAt || existing.expiresAt > now)) {
    throw new OrganizationGroupMutationError('assignment-already-active')
  }
  if (existing) {
    const expiredAt = existing.expiresAt!
    const expired = await revokeGroupAssignmentRecord(transaction, existing.assignmentId, {
      actorType: 'system',
      actorUserId: null,
      now: expiredAt,
      reason: expiredGroupAssignmentReason,
    })
    await appendGroupAudit(transaction, organization, {
      actorId: null,
      actorType: 'system',
      assignment: expired,
      eventType: 'group.revoked',
      now: expiredAt,
      outcome: 'revoked',
      reason: expiredGroupAssignmentReason,
    })
  }

  const [assignment] = await transaction
    .insert(organizationGroupAssignments)
    .values({
      assignedActorType: 'user',
      assignedAt: now,
      assignedByUserId: input.actorUserId,
      assignmentSource: 'manual',
      complianceSource: null,
      deploymentId: 1,
      expiresAt: input.expiresAt,
      groupId: group.groupId,
      organizationVersion: organization.organizationVersion,
      reason: input.reason,
      userId: input.targetUserId,
    })
    .returning()
  if (!assignment) {
    throw new Error('Failed to assign organization group')
  }
  await appendGroupAudit(transaction, organization, {
    actorId: input.actorUserId,
    actorType: 'user',
    assignment,
    eventType: 'group.assigned',
    now,
    outcome: 'granted',
    reason: input.reason,
  })
  return toOrganizationGroupAssignment(assignment)
}

export async function listCurrentOrganizationGroups() {
  return db.transaction(async (transaction) => {
    const organization = await lockCurrentOrganization(transaction)
    await expireOrganizationGroupAssignments(transaction, organization, new Date())
    const groups = await transaction
      .select()
      .from(organizationGroups)
      .where(
        and(
          eq(organizationGroups.deploymentId, 1),
          eq(organizationGroups.organizationVersion, organization.organizationVersion),
        ),
      )
      .orderBy(asc(organizationGroups.name), asc(organizationGroups.groupId))
    const assignments = await transaction
      .select()
      .from(organizationGroupAssignments)
      .where(
        and(
          eq(organizationGroupAssignments.deploymentId, 1),
          eq(organizationGroupAssignments.organizationVersion, organization.organizationVersion),
          isNull(organizationGroupAssignments.revokedAt),
        ),
      )
      .orderBy(
        asc(organizationGroupAssignments.groupId),
        asc(organizationGroupAssignments.assignedAt),
      )
    return {
      groups: groups.map((group) => ({
        assignments: assignments
          .filter((assignment) => assignment.groupId === group.groupId)
          .map(toOrganizationGroupAssignment),
        complianceSource: group.complianceSource,
        groupId: group.groupId,
        managementMode: group.managementMode,
        name: group.name,
        organizationVersion: group.organizationVersion,
        restricted: group.restricted,
      })),
    }
  })
}

export async function revokeOrganizationGroupAssignment(input: {
  actorUserId: string
  groupId: string
  assignmentId: string
  reason: string
}) {
  return db.transaction(async (transaction) => {
    const organization = await lockCurrentOrganization(transaction)
    const group = await loadCurrentGroupForUpdate(
      transaction,
      organization.organizationVersion,
      input.groupId,
    )
    const authority = await requireManager(
      transaction,
      organization.organizationVersion,
      input.actorUserId,
    )
    requireGroupManagementAuthority(group, authority)
    assertManualGroup(group)

    const assignment = await loadUnrevokedGroupAssignmentByIdForUpdate(
      transaction,
      organization.organizationVersion,
      group.groupId,
      input.assignmentId,
    )
    if (!assignment) {
      throw new OrganizationGroupMutationError('assignment-not-found')
    }
    return revokeManualOrganizationGroupAssignmentInTransaction(
      transaction,
      organization,
      group,
      assignment,
      input,
    )
  })
}

export async function revokeManualOrganizationGroupAssignmentInTransaction(
  transaction: Transaction,
  organization: { organizationVersion: number; policyVersion: number },
  group: typeof organizationGroups.$inferSelect,
  assignment: typeof organizationGroupAssignments.$inferSelect,
  input: { actorUserId: string; reason: string },
) {
  assertManualGroup(group)
  const now = new Date()
  const revoked = await revokeGroupAssignmentRecord(transaction, assignment.assignmentId, {
    actorType: 'user',
    actorUserId: input.actorUserId,
    now,
    reason: input.reason,
  })
  await appendGroupAudit(transaction, organization, {
    actorId: input.actorUserId,
    actorType: 'user',
    assignment: revoked,
    eventType: 'group.revoked',
    now,
    outcome: 'revoked',
    reason: input.reason,
  })
  return toOrganizationGroupAssignment(revoked)
}

async function requireManager(
  transaction: Transaction,
  organizationVersion: number,
  userId: string,
) {
  const authority = await loadManagementAuthority(
    transaction,
    organizationVersion,
    userId,
    new Date(),
    'mutate',
  )
  if (!authority) {
    throw new OrganizationGroupMutationError('manager-authority-required')
  }
  return authority
}

async function requireOwner(transaction: Transaction, organizationVersion: number, userId: string) {
  const authority = await requireManager(transaction, organizationVersion, userId)
  if (authority !== 'organization_owner') {
    throw new OrganizationGroupMutationError('owner-authority-required')
  }
}

function requireGroupManagementAuthority(
  group: typeof organizationGroups.$inferSelect,
  authority: OrganizationManagementAuthority,
) {
  if (group.restricted && authority !== 'organization_owner') {
    throw new OrganizationGroupMutationError('owner-authority-required')
  }
}

function assertManualGroup(group: typeof organizationGroups.$inferSelect) {
  if (group.managementMode === 'compliance') {
    throw new OrganizationGroupMutationError('compliance-group-manual-change')
  }
  if (group.managementMode === 'rule') {
    throw new OrganizationGroupMutationError('rule-group-manual-change')
  }
}

async function resolvePermissions(
  transaction: Transaction,
  permissions: readonly PermissionSelection[],
): Promise<readonly StoredPermission[]> {
  try {
    return await resolveCurrentPermissionSelections(transaction, permissions)
  } catch (error) {
    if (error instanceof OrganizationPermissionCatalogError) {
      throw new OrganizationGroupMutationError('permission-unavailable')
    }
    throw error
  }
}

async function loadRetainedUnavailablePermissions(
  transaction: Transaction,
  organizationVersion: number,
  bundleId: string,
  entryIds: readonly string[],
) {
  if (new Set(entryIds).size !== entryIds.length) {
    throw new OrganizationGroupMutationError('retained-permission-invalid')
  }
  if (entryIds.length === 0) {
    return []
  }

  const [entries, currentCatalog] = await Promise.all([
    transaction
      .select()
      .from(organizationPermissionBundleEntries)
      .where(
        and(
          eq(organizationPermissionBundleEntries.bundleId, bundleId),
          eq(organizationPermissionBundleEntries.deploymentId, 1),
          eq(organizationPermissionBundleEntries.organizationVersion, organizationVersion),
          inArray(organizationPermissionBundleEntries.entryId, entryIds),
        ),
      )
      .for('update'),
    listEnabledPermissionCatalog(transaction),
  ])
  const availablePermissions = new Set(
    currentCatalog.permissions.map(
      (permission) =>
        `${permission.publisherPackage}\u0000${permission.moduleId}\u0000${permission.key}`,
    ),
  )
  if (
    entries.length !== entryIds.length ||
    entries.some(
      (entry) =>
        entry.permissionType !== 'module' ||
        availablePermissions.has(
          `${entry.publisherPackage ?? ''}\u0000${entry.moduleId ?? ''}\u0000${entry.permissionKey}`,
        ),
    )
  ) {
    throw new OrganizationGroupMutationError('retained-permission-invalid')
  }

  return entries.map((entry) => ({
    bundleId: entry.bundleId,
    createdAt: entry.createdAt,
    deploymentId: entry.deploymentId,
    entryId: entry.entryId,
    moduleId: entry.moduleId,
    organizationVersion: entry.organizationVersion,
    permissionKey: entry.permissionKey,
    permissionType: entry.permissionType,
    publisherPackage: entry.publisherPackage,
    reviewAllowed: entry.reviewAllowed,
  }))
}

function toGroup(group: typeof organizationGroups.$inferSelect, bundleIds: string[]) {
  return {
    bundleIds,
    complianceSource: group.complianceSource,
    groupId: group.groupId,
    managementMode: group.managementMode,
    name: group.name,
    organizationVersion: group.organizationVersion,
    restricted: group.restricted,
  }
}
