import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
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
  type OrganizationPermissionType,
} from '../db/schema.js'
import {
  loadCurrentGroupForUpdate,
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
import {
  loadManagementAuthority,
  type OrganizationManagementAuthority,
} from './management-authority.js'
import { lockCurrentOrganization } from './organization-lock.js'

type Transaction = DatabaseTransaction

interface PermissionInput {
  type: OrganizationPermissionType
  key: string
  reviewAllowed?: boolean
}

export async function createOrganizationPermissionBundle(input: {
  actorUserId: string
  name: string
  permissions: PermissionInput[]
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
    if (existing) throw new OrganizationGroupMutationError('bundle-name-conflict')

    const [bundle] = await transaction
      .insert(organizationPermissionBundles)
      .values({
        deploymentId: 1,
        organizationVersion: organization.organizationVersion,
        name: input.name,
        createdByUserId: input.actorUserId,
      })
      .returning()
    if (!bundle) throw new Error('Failed to create organization permission bundle')

    const permissions = uniquePermissions(input.permissions)
    await transaction.insert(organizationPermissionBundleEntries).values(
      permissions.map((permission) => ({
        bundleId: bundle.bundleId,
        deploymentId: 1,
        organizationVersion: organization.organizationVersion,
        permissionType: permission.type,
        permissionKey: permission.key,
        reviewAllowed: permission.reviewAllowed,
      })),
    )
    return {
      bundleId: bundle.bundleId,
      organizationVersion: bundle.organizationVersion,
      name: bundle.name,
      permissions,
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
    if (existing) throw new OrganizationGroupMutationError('group-name-conflict')

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
    if (bundles.length !== bundleIds.length)
      throw new OrganizationGroupMutationError('bundle-not-found')

    const [group] = await transaction
      .insert(organizationGroups)
      .values({
        deploymentId: 1,
        organizationVersion: organization.organizationVersion,
        name: input.name,
        restricted: input.restricted,
        managementMode: input.managementMode,
        complianceSource: input.complianceSource,
        createdByUserId: input.actorUserId,
      })
      .returning()
    if (!group) throw new Error('Failed to create organization group')

    await transaction.insert(organizationGroupPermissionBundles).values(
      bundleIds.map((bundleId) => ({
        groupId: group.groupId,
        bundleId,
        deploymentId: 1,
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
      for (const { userId } of eligibleAccounts)
        // oxlint-disable-next-line no-await-in-loop -- Group locks must follow stable user order.
        await convergeRegistrationComplianceGroupsInTransaction(transaction, {
          organizationVersion: organization.organizationVersion,
          policyVersion: organization.policyVersion,
          userId,
          eligible: true,
          now,
        })
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
    if (group.managementMode === 'compliance')
      throw new OrganizationGroupMutationError('compliance-group-manual-change')

    const [target] = await transaction
      .select({ userId: users.id })
      .from(users)
      .where(eq(users.id, input.targetUserId))
    if (!target) throw new OrganizationGroupMutationError('target-not-found')

    const now = new Date()
    if (input.expiresAt && input.expiresAt <= now)
      throw new OrganizationGroupMutationError('invalid-expiry')
    const existing = await loadUnrevokedGroupAssignmentForUpdate(
      transaction,
      organization.organizationVersion,
      group.groupId,
      input.targetUserId,
    )
    if (existing && (!existing.expiresAt || existing.expiresAt > now))
      throw new OrganizationGroupMutationError('assignment-already-active')
    if (existing) {
      const expiredAt = existing.expiresAt!
      const expired = await revokeGroupAssignmentRecord(transaction, existing.assignmentId, {
        actorType: 'system',
        actorUserId: null,
        reason: expiredGroupAssignmentReason,
        now: expiredAt,
      })
      await appendGroupAudit(transaction, organization, {
        eventType: 'group.revoked',
        actorType: 'system',
        actorId: null,
        assignment: expired,
        reason: expiredGroupAssignmentReason,
        outcome: 'revoked',
        now: expiredAt,
      })
    }

    const [assignment] = await transaction
      .insert(organizationGroupAssignments)
      .values({
        groupId: group.groupId,
        deploymentId: 1,
        organizationVersion: organization.organizationVersion,
        userId: input.targetUserId,
        assignmentSource: 'manual',
        complianceSource: null,
        assignedActorType: 'user',
        assignedByUserId: input.actorUserId,
        reason: input.reason,
        assignedAt: now,
        expiresAt: input.expiresAt,
      })
      .returning()
    if (!assignment) throw new Error('Failed to assign organization group')
    await appendGroupAudit(transaction, organization, {
      eventType: 'group.assigned',
      actorType: 'user',
      actorId: input.actorUserId,
      assignment,
      reason: input.reason,
      outcome: 'granted',
      now,
    })
    return toOrganizationGroupAssignment(assignment)
  })
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
        groupId: group.groupId,
        organizationVersion: group.organizationVersion,
        name: group.name,
        restricted: group.restricted,
        managementMode: group.managementMode,
        complianceSource: group.complianceSource,
        assignments: assignments
          .filter((assignment) => assignment.groupId === group.groupId)
          .map(toOrganizationGroupAssignment),
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
    if (group.managementMode === 'compliance')
      throw new OrganizationGroupMutationError('compliance-group-manual-change')

    const [assignment] = await transaction
      .select({ assignmentId: organizationGroupAssignments.assignmentId })
      .from(organizationGroupAssignments)
      .where(
        and(
          eq(organizationGroupAssignments.assignmentId, input.assignmentId),
          eq(organizationGroupAssignments.groupId, group.groupId),
          eq(organizationGroupAssignments.deploymentId, 1),
          eq(organizationGroupAssignments.organizationVersion, organization.organizationVersion),
          isNull(organizationGroupAssignments.revokedAt),
        ),
      )
      .for('update')
    if (!assignment) throw new OrganizationGroupMutationError('assignment-not-found')

    const now = new Date()
    const revoked = await revokeGroupAssignmentRecord(transaction, assignment.assignmentId, {
      actorType: 'user',
      actorUserId: input.actorUserId,
      reason: input.reason,
      now,
    })
    await appendGroupAudit(transaction, organization, {
      eventType: 'group.revoked',
      actorType: 'user',
      actorId: input.actorUserId,
      assignment: revoked,
      reason: input.reason,
      outcome: 'revoked',
      now,
    })
    return toOrganizationGroupAssignment(revoked)
  })
}

async function requireManager(
  transaction: Transaction,
  organizationVersion: number,
  userId: string,
) {
  const authority = await loadManagementAuthority(transaction, organizationVersion, userId)
  if (!authority) throw new OrganizationGroupMutationError('manager-authority-required')
  return authority
}

async function requireOwner(transaction: Transaction, organizationVersion: number, userId: string) {
  const authority = await requireManager(transaction, organizationVersion, userId)
  if (authority !== 'organization_owner')
    throw new OrganizationGroupMutationError('owner-authority-required')
}

function requireGroupManagementAuthority(
  group: typeof organizationGroups.$inferSelect,
  authority: OrganizationManagementAuthority,
) {
  if (group.restricted && authority !== 'organization_owner')
    throw new OrganizationGroupMutationError('owner-authority-required')
}

function uniquePermissions(permissions: PermissionInput[]) {
  const unique = new Map<string, PermissionInput & { reviewAllowed: boolean }>()
  for (const permission of permissions) {
    const identity = `${permission.type}:${permission.key}`
    const existing = unique.get(identity)
    unique.set(identity, {
      ...permission,
      reviewAllowed: Boolean(existing?.reviewAllowed || permission.reviewAllowed),
    })
  }
  return [...unique.values()]
}

function toGroup(group: typeof organizationGroups.$inferSelect, bundleIds: string[]) {
  return {
    groupId: group.groupId,
    organizationVersion: group.organizationVersion,
    name: group.name,
    restricted: group.restricted,
    managementMode: group.managementMode,
    complianceSource: group.complianceSource,
    bundleIds,
  }
}
