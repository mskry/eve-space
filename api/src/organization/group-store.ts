import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  deploymentSettings,
  organizationAccountCompliance,
  organizationAuthorityEvidence,
  organizationGroupAssignments,
  organizationGroupPermissionBundles,
  organizationGroups,
  organizationMemberBlocks,
  organizationPermissionBundleEntries,
  organizationPermissionBundles,
  organizationRoleGrants,
  users,
  type OrganizationComplianceSource,
  type OrganizationGroupManagementMode,
  type OrganizationPermissionType,
} from '../db/schema.js'
import {
  appendOrganizationAuditEvent,
  appendOrganizationAuditEvents,
  type OrganizationAuditInput,
} from './audit.js'
import { hasCurrentComplianceAccess } from './compliance-access.js'

export type OrganizationManagementAuthority = 'director' | 'organization_owner'

const expiredAssignmentReason = 'Group assignment expired.'

export class OrganizationGroupMutationError extends Error {
  constructor(
    readonly code:
      | 'manager-authority-required'
      | 'owner-authority-required'
      | 'bundle-name-conflict'
      | 'bundle-not-found'
      | 'group-name-conflict'
      | 'group-not-found'
      | 'target-not-found'
      | 'compliance-group-manual-change'
      | 'compliance-source-mismatch'
      | 'assignment-already-active'
      | 'assignment-not-found'
      | 'invalid-expiry',
  ) {
    super(code)
  }
}

interface PermissionInput {
  type: OrganizationPermissionType
  key: string
  reviewAllowed?: boolean
}

export async function hasCurrentOrganizationManagerAuthority(userId: string) {
  const [organization] = await db
    .select({ organizationVersion: deploymentSettings.organizationVersion })
    .from(deploymentSettings)
    .where(eq(deploymentSettings.id, 1))
  if (!organization) return false
  return Boolean(await loadManagementAuthority(db, organization.organizationVersion, userId))
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
    const existing = await loadUnrevokedAssignmentForUpdate(
      transaction,
      organization.organizationVersion,
      group.groupId,
      input.targetUserId,
    )
    if (existing && (!existing.expiresAt || existing.expiresAt > now))
      throw new OrganizationGroupMutationError('assignment-already-active')
    if (existing) {
      const expiredAt = existing.expiresAt!
      const expired = await revokeAssignment(transaction, existing.assignmentId, {
        actorType: 'system',
        actorUserId: null,
        reason: expiredAssignmentReason,
        now: expiredAt,
      })
      await appendGroupAudit(transaction, organization, {
        eventType: 'group.revoked',
        actorType: 'system',
        actorId: null,
        assignment: expired,
        reason: expiredAssignmentReason,
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
    return toAssignment(assignment)
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
          .map(toAssignment),
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
    const revoked = await revokeAssignment(transaction, assignment.assignmentId, {
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
    return toAssignment(revoked)
  })
}

export function convergeRegistrationComplianceGroupAssignment(input: {
  groupId: string
  targetUserId: string
  eligible: boolean
  reason: string
}) {
  return convergeComplianceGroupAssignment('core.registration', input)
}

export async function convergeRegistrationComplianceGroupsInTransaction(
  transaction: Transaction,
  input: {
    organizationVersion: number
    policyVersion: number
    userId: string
    eligible: boolean
    now: Date
  },
) {
  const groups = await transaction
    .select()
    .from(organizationGroups)
    .where(
      and(
        eq(organizationGroups.deploymentId, 1),
        eq(organizationGroups.organizationVersion, input.organizationVersion),
        eq(organizationGroups.managementMode, 'compliance'),
        eq(organizationGroups.complianceSource, 'core.registration'),
      ),
    )
    .orderBy(asc(organizationGroups.groupId))
    .for('update')
  /* oxlint-disable no-await-in-loop -- Assignment writes follow the locked group order. */
  for (const group of groups) {
    const existing = await loadUnrevokedAssignmentForUpdate(
      transaction,
      input.organizationVersion,
      group.groupId,
      input.userId,
    )
    if (input.eligible === Boolean(existing)) continue
    if (input.eligible) {
      const [assignment] = await transaction
        .insert(organizationGroupAssignments)
        .values({
          groupId: group.groupId,
          deploymentId: 1,
          organizationVersion: input.organizationVersion,
          userId: input.userId,
          assignmentSource: 'compliance',
          complianceSource: 'core.registration',
          assignedActorType: 'system',
          assignedByUserId: null,
          reason: 'Account registration compliance established.',
          assignedAt: input.now,
          expiresAt: null,
        })
        .returning()
      if (!assignment) throw new Error('Failed to converge organization group assignment')
      await appendGroupAudit(
        transaction,
        { organizationVersion: input.organizationVersion, policyVersion: input.policyVersion },
        {
          eventType: 'group.assigned',
          actorType: 'system',
          actorId: null,
          assignment,
          reason: assignment.reason,
          outcome: 'granted',
          now: input.now,
        },
      )
      continue
    }
    const revoked = await revokeAssignment(transaction, existing!.assignmentId, {
      actorType: 'system',
      actorUserId: null,
      reason: 'Account registration compliance no longer grants this group.',
      now: input.now,
    })
    await appendGroupAudit(
      transaction,
      { organizationVersion: input.organizationVersion, policyVersion: input.policyVersion },
      {
        eventType: 'group.revoked',
        actorType: 'system',
        actorId: null,
        assignment: revoked,
        reason: revoked.revocationReason!,
        outcome: 'revoked',
        now: input.now,
      },
    )
  }
  /* oxlint-enable no-await-in-loop */
}

async function convergeComplianceGroupAssignment(
  complianceSource: OrganizationComplianceSource,
  input: {
    groupId: string
    targetUserId: string
    eligible: boolean
    reason: string
  },
) {
  return db.transaction(async (transaction) => {
    const organization = await lockCurrentOrganization(transaction)
    const group = await loadCurrentGroupForUpdate(
      transaction,
      organization.organizationVersion,
      input.groupId,
    )
    if (group.managementMode !== 'compliance' || group.complianceSource !== complianceSource)
      throw new OrganizationGroupMutationError('compliance-source-mismatch')

    const [target] = await transaction
      .select({ userId: users.id })
      .from(users)
      .where(eq(users.id, input.targetUserId))
    if (!target) throw new OrganizationGroupMutationError('target-not-found')
    const existing = await loadUnrevokedAssignmentForUpdate(
      transaction,
      organization.organizationVersion,
      group.groupId,
      input.targetUserId,
    )
    if (input.eligible === Boolean(existing))
      return { changed: false, assignment: existing ? toAssignment(existing) : null }

    const now = new Date()
    if (input.eligible) {
      const [assignment] = await transaction
        .insert(organizationGroupAssignments)
        .values({
          groupId: group.groupId,
          deploymentId: 1,
          organizationVersion: organization.organizationVersion,
          userId: input.targetUserId,
          assignmentSource: 'compliance',
          complianceSource,
          assignedActorType: 'system',
          assignedByUserId: null,
          reason: input.reason,
          assignedAt: now,
          expiresAt: null,
        })
        .returning()
      if (!assignment) throw new Error('Failed to converge organization group assignment')
      await appendGroupAudit(transaction, organization, {
        eventType: 'group.assigned',
        actorType: 'system',
        actorId: null,
        assignment,
        reason: input.reason,
        outcome: 'granted',
        now,
      })
      return { changed: true, assignment: toAssignment(assignment) }
    }

    const revoked = await revokeAssignment(transaction, existing!.assignmentId, {
      actorType: 'system',
      actorUserId: null,
      reason: input.reason,
      now,
    })
    await appendGroupAudit(transaction, organization, {
      eventType: 'group.revoked',
      actorType: 'system',
      actorId: null,
      assignment: revoked,
      reason: input.reason,
      outcome: 'revoked',
      now,
    })
    return { changed: true, assignment: toAssignment(revoked) }
  })
}

export async function getOrganizationGroupPermissions(
  userId: string,
  now = new Date(),
  organizationVersion?: number,
) {
  await expireCurrentOrganizationGroupAssignments(now)
  const permissions = await db
    .select({
      type: organizationPermissionBundleEntries.permissionType,
      key: organizationPermissionBundleEntries.permissionKey,
    })
    .from(deploymentSettings)
    .leftJoin(
      organizationMemberBlocks,
      and(
        eq(organizationMemberBlocks.deploymentId, deploymentSettings.id),
        eq(organizationMemberBlocks.organizationVersion, deploymentSettings.organizationVersion),
        eq(organizationMemberBlocks.userId, userId),
        isNull(organizationMemberBlocks.unblockedAt),
      ),
    )
    .innerJoin(
      organizationAccountCompliance,
      and(
        eq(organizationAccountCompliance.deploymentId, deploymentSettings.id),
        eq(
          organizationAccountCompliance.organizationVersion,
          deploymentSettings.organizationVersion,
        ),
        eq(organizationAccountCompliance.userId, userId),
        eq(organizationAccountCompliance.authoritative, true),
        or(
          eq(organizationAccountCompliance.state, 'compliant'),
          and(
            eq(organizationAccountCompliance.state, 'review_required'),
            gt(organizationAccountCompliance.reviewDeadline, now),
          ),
        ),
        gt(organizationAccountCompliance.accessValidUntil, now),
      ),
    )
    .innerJoin(
      organizationGroupAssignments,
      and(
        eq(deploymentSettings.id, 1),
        eq(organizationGroupAssignments.deploymentId, deploymentSettings.id),
        eq(
          organizationGroupAssignments.organizationVersion,
          deploymentSettings.organizationVersion,
        ),
      ),
    )
    .innerJoin(
      organizationGroupPermissionBundles,
      and(
        eq(organizationGroupPermissionBundles.groupId, organizationGroupAssignments.groupId),
        eq(
          organizationGroupPermissionBundles.deploymentId,
          organizationGroupAssignments.deploymentId,
        ),
        eq(
          organizationGroupPermissionBundles.organizationVersion,
          organizationGroupAssignments.organizationVersion,
        ),
      ),
    )
    .innerJoin(
      organizationPermissionBundleEntries,
      and(
        eq(
          organizationPermissionBundleEntries.bundleId,
          organizationGroupPermissionBundles.bundleId,
        ),
        eq(
          organizationPermissionBundleEntries.deploymentId,
          organizationGroupPermissionBundles.deploymentId,
        ),
        eq(
          organizationPermissionBundleEntries.organizationVersion,
          organizationGroupPermissionBundles.organizationVersion,
        ),
      ),
    )
    .where(
      and(
        eq(organizationGroupAssignments.userId, userId),
        organizationVersion === undefined
          ? undefined
          : eq(deploymentSettings.organizationVersion, organizationVersion),
        isNull(organizationMemberBlocks.blockId),
        isNull(organizationGroupAssignments.revokedAt),
        or(
          isNull(organizationGroupAssignments.expiresAt),
          gt(organizationGroupAssignments.expiresAt, now),
        ),
        or(
          eq(organizationAccountCompliance.state, 'compliant'),
          eq(organizationPermissionBundleEntries.reviewAllowed, true),
        ),
      ),
    )
    .orderBy(
      asc(organizationPermissionBundleEntries.permissionType),
      asc(organizationPermissionBundleEntries.permissionKey),
    )
  return {
    modules: [
      ...new Set(permissions.filter(({ type }) => type === 'module').map(({ key }) => key)),
    ],
    services: [
      ...new Set(permissions.filter(({ type }) => type === 'service').map(({ key }) => key)),
    ],
  }
}

async function expireCurrentOrganizationGroupAssignments(now: Date) {
  await db.transaction(async (transaction) => {
    const organization = await lockCurrentOrganization(transaction)
    await expireOrganizationGroupAssignments(transaction, organization, now)
  })
}

async function expireOrganizationGroupAssignments(
  transaction: Transaction,
  organization: { organizationVersion: number; policyVersion: number },
  now: Date,
) {
  const expiredAssignments = await transaction
    .update(organizationGroupAssignments)
    .set({
      revokedAt: sql`${organizationGroupAssignments.expiresAt}`,
      revokedActorType: 'system',
      revokedByUserId: null,
      revocationReason: expiredAssignmentReason,
      updatedAt: sql`${organizationGroupAssignments.expiresAt}`,
    })
    .where(
      and(
        eq(organizationGroupAssignments.deploymentId, 1),
        eq(organizationGroupAssignments.organizationVersion, organization.organizationVersion),
        isNull(organizationGroupAssignments.revokedAt),
        lte(organizationGroupAssignments.expiresAt, now),
      ),
    )
    .returning()
  await appendOrganizationAuditEvents(
    transaction,
    expiredAssignments.map((assignment) =>
      groupAuditInput(organization, {
        eventType: 'group.revoked',
        actorType: 'system',
        actorId: null,
        assignment,
        reason: expiredAssignmentReason,
        outcome: 'revoked',
        now: assignment.expiresAt!,
      }),
    ),
  )
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Database = Transaction | typeof db

async function lockCurrentOrganization(transaction: Transaction) {
  const [organization] = await transaction
    .select({
      organizationVersion: deploymentSettings.organizationVersion,
      policyVersion: deploymentSettings.registrationPolicyVersion,
    })
    .from(deploymentSettings)
    .where(eq(deploymentSettings.id, 1))
    .for('update')
  if (!organization) throw new Error('Deployment organization is not configured')
  return organization
}

export async function loadManagementAuthority(
  database: Database,
  organizationVersion: number,
  userId: string,
  now = new Date(),
) {
  if (!(await hasCurrentComplianceAccess(database, organizationVersion, userId, now))) return null
  const [block] = await database
    .select({ blockId: organizationMemberBlocks.blockId })
    .from(organizationMemberBlocks)
    .where(
      and(
        eq(organizationMemberBlocks.deploymentId, 1),
        eq(organizationMemberBlocks.organizationVersion, organizationVersion),
        eq(organizationMemberBlocks.userId, userId),
        isNull(organizationMemberBlocks.unblockedAt),
      ),
    )
    .limit(1)
  if (block) return null

  const grants = await database
    .select({
      role: organizationRoleGrants.role,
      evidenceStatus: organizationAuthorityEvidence.status,
      reviewDeadline: organizationAuthorityEvidence.reviewDeadline,
    })
    .from(organizationRoleGrants)
    .leftJoin(
      organizationAuthorityEvidence,
      eq(organizationAuthorityEvidence.grantId, organizationRoleGrants.grantId),
    )
    .where(
      and(
        eq(organizationRoleGrants.deploymentId, 1),
        eq(organizationRoleGrants.organizationVersion, organizationVersion),
        eq(organizationRoleGrants.userId, userId),
        or(
          eq(organizationRoleGrants.role, 'organization_owner'),
          eq(organizationRoleGrants.role, 'director'),
        ),
        isNull(organizationRoleGrants.revokedAt),
      ),
    )
  if (
    grants.some(
      (grant) =>
        grant.role === 'organization_owner' &&
        (grant.evidenceStatus === 'fresh' ||
          (grant.evidenceStatus === 'review_required' &&
            grant.reviewDeadline !== null &&
            grant.reviewDeadline > now)),
    )
  )
    return 'organization_owner' as const
  if (grants.some(({ role }) => role === 'director')) return 'director' as const
  return null
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

async function loadCurrentGroupForUpdate(
  transaction: Transaction,
  organizationVersion: number,
  groupId: string,
) {
  const [group] = await transaction
    .select()
    .from(organizationGroups)
    .where(
      and(
        eq(organizationGroups.groupId, groupId),
        eq(organizationGroups.deploymentId, 1),
        eq(organizationGroups.organizationVersion, organizationVersion),
      ),
    )
    .for('update')
  if (!group) throw new OrganizationGroupMutationError('group-not-found')
  return group
}

function requireGroupManagementAuthority(
  group: typeof organizationGroups.$inferSelect,
  authority: OrganizationManagementAuthority,
) {
  if (group.restricted && authority !== 'organization_owner')
    throw new OrganizationGroupMutationError('owner-authority-required')
}

async function loadUnrevokedAssignmentForUpdate(
  transaction: Transaction,
  organizationVersion: number,
  groupId: string,
  userId: string,
) {
  const [assignment] = await transaction
    .select()
    .from(organizationGroupAssignments)
    .where(
      and(
        eq(organizationGroupAssignments.deploymentId, 1),
        eq(organizationGroupAssignments.organizationVersion, organizationVersion),
        eq(organizationGroupAssignments.groupId, groupId),
        eq(organizationGroupAssignments.userId, userId),
        isNull(organizationGroupAssignments.revokedAt),
      ),
    )
    .for('update')
  return assignment
}

async function revokeAssignment(
  transaction: Transaction,
  assignmentId: string,
  input: {
    actorType: 'user' | 'system'
    actorUserId: string | null
    reason: string
    now: Date
  },
) {
  const [revoked] = await transaction
    .update(organizationGroupAssignments)
    .set({
      revokedAt: input.now,
      revokedActorType: input.actorType,
      revokedByUserId: input.actorUserId,
      revocationReason: input.reason,
      updatedAt: input.now,
    })
    .where(eq(organizationGroupAssignments.assignmentId, assignmentId))
    .returning()
  if (!revoked) throw new Error('Failed to revoke organization group assignment')
  return revoked
}

function appendGroupAudit(
  transaction: Transaction,
  organization: { organizationVersion: number; policyVersion: number },
  input: GroupAuditInput,
) {
  return appendOrganizationAuditEvent(transaction, groupAuditInput(organization, input))
}

type GroupAuditInput = {
  eventType: 'group.assigned' | 'group.revoked'
  actorType: 'user' | 'system'
  actorId: string | null
  assignment: typeof organizationGroupAssignments.$inferSelect
  reason: string
  outcome: 'granted' | 'revoked'
  now: Date
}

function groupAuditInput(
  organization: { organizationVersion: number; policyVersion: number },
  input: GroupAuditInput,
): OrganizationAuditInput {
  return {
    deploymentId: 1,
    organizationVersion: organization.organizationVersion,
    policyVersion: organization.policyVersion,
    eventType: input.eventType,
    actorType: input.actorType,
    actorId: input.actorId,
    subjectType: 'group',
    subjectId: input.assignment.groupId,
    reason: input.reason,
    outcome: input.outcome,
    groupId: input.assignment.groupId,
    assignmentId: input.assignment.assignmentId,
    targetUserId: input.assignment.userId,
    assignmentSource: input.assignment.assignmentSource,
    complianceSource: input.assignment.complianceSource,
    entitlementExpiresAt: input.assignment.expiresAt,
    occurredAt: input.now,
  }
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

function toAssignment(assignment: typeof organizationGroupAssignments.$inferSelect) {
  return {
    assignmentId: assignment.assignmentId,
    groupId: assignment.groupId,
    organizationVersion: assignment.organizationVersion,
    userId: assignment.userId,
    assignmentSource: assignment.assignmentSource,
    complianceSource: assignment.complianceSource,
    assignedActorType: assignment.assignedActorType,
    assignedByUserId: assignment.assignedByUserId,
    reason: assignment.reason,
    assignedAt: assignment.assignedAt.toISOString(),
    expiresAt: assignment.expiresAt?.toISOString() ?? null,
    revokedAt: assignment.revokedAt?.toISOString() ?? null,
    revokedActorType: assignment.revokedActorType,
    revokedByUserId: assignment.revokedByUserId,
    revocationReason: assignment.revocationReason,
  }
}
