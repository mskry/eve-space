import { and, eq, gt, inArray, isNull, like, or } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '../db/client.js'
import {
  organizationGroupAssignments,
  organizationGroupPermissionBundles,
  organizationGroups,
  organizationManagedMemberLifecycles,
  organizationMemberBlocks,
  organizationPermissionBundleEntries,
  organizationRoleGrants,
} from '../db/schema.js'
import { organizationAuditReasonSchema } from './audit.js'
import {
  blockOrganizationMemberInTransaction,
  unblockOrganizationMemberInTransaction,
} from './block-store.js'
import { hasCurrentComplianceAccess } from './compliance-access.js'
import {
  loadCurrentGroupForUpdate,
  loadUnrevokedGroupAssignmentByIdForUpdate,
} from './group-assignment-store.js'
import {
  assignManualOrganizationGroupInTransaction,
  revokeManualOrganizationGroupAssignmentInTransaction,
} from './group-store.js'
import { lockCurrentOrganization } from './organization-lock.js'

type OrganizationReviewerActionPermission =
  | 'member-audit.groups.manage'
  | 'member-audit.members.block'

export interface OrganizationReviewerCommandBinding<
  Permission extends OrganizationReviewerActionPermission,
> {
  readonly organizationDeploymentId: 1
  readonly organizationVersion: number
  readonly actorUserId: string
  readonly targetUserId: string
  readonly managedMemberLifecycleId: string
  readonly requiredPermission: Permission
  readonly reason: string
}

export interface AssignOrganizationReviewerGroupCommand extends OrganizationReviewerCommandBinding<'member-audit.groups.manage'> {
  readonly groupId: string
  readonly expiresAt?: Date | null
}

export interface RevokeOrganizationReviewerGroupCommand extends OrganizationReviewerCommandBinding<'member-audit.groups.manage'> {
  readonly groupId: string
  readonly assignmentId: string
}

export type BlockOrganizationReviewerMemberCommand =
  OrganizationReviewerCommandBinding<'member-audit.members.block'>

export type UnblockOrganizationReviewerMemberCommand =
  OrganizationReviewerCommandBinding<'member-audit.members.block'>

export class OrganizationReviewerCommandError extends Error {
  constructor(
    readonly code:
      | 'invalid-binding'
      | 'invalid-reason'
      | 'reviewer-authority-required'
      | 'reviewer-permission-required'
      | 'self-target-not-allowed'
      | 'reviewer-target-not-allowed'
      | 'restricted-group-not-allowed'
      | 'compliance-group-not-allowed'
      | 'reviewer-permission-group-not-allowed'
      | 'assignment-binding-invalid',
  ) {
    super(code)
  }
}

export async function assignOrganizationReviewerOrdinaryGroup(
  input: AssignOrganizationReviewerGroupCommand,
) {
  const reason = requireReason(input.reason)
  return db.transaction(async (transaction) => {
    const organization = await authorizeCommand(transaction, input, 'member-audit.groups.manage')
    requireDifferentTarget(input)
    const group = await loadOrdinaryGroupForUpdate(
      transaction,
      input.organizationVersion,
      input.groupId,
    )
    const assignment = await assignManualOrganizationGroupInTransaction(
      transaction,
      organization,
      group,
      {
        actorUserId: input.actorUserId,
        targetUserId: input.targetUserId,
        reason,
        expiresAt: input.expiresAt ?? null,
      },
    )
    return {
      decision: 'assigned' as const,
      organizationVersion: assignment.organizationVersion,
      targetUserId: assignment.userId,
      groupId: assignment.groupId,
      assignmentId: assignment.assignmentId,
      expiresAt: assignment.expiresAt,
    }
  })
}

export async function revokeOrganizationReviewerOrdinaryGroup(
  input: RevokeOrganizationReviewerGroupCommand,
) {
  const reason = requireReason(input.reason)
  return db.transaction(async (transaction) => {
    const organization = await authorizeCommand(transaction, input, 'member-audit.groups.manage')
    requireDifferentTarget(input)
    const group = await loadOrdinaryGroupForUpdate(
      transaction,
      input.organizationVersion,
      input.groupId,
    )
    const assignment = await loadUnrevokedGroupAssignmentByIdForUpdate(
      transaction,
      input.organizationVersion,
      group.groupId,
      input.assignmentId,
    )
    if (assignment?.userId !== input.targetUserId)
      throw new OrganizationReviewerCommandError('assignment-binding-invalid')
    const revoked = await revokeManualOrganizationGroupAssignmentInTransaction(
      transaction,
      organization,
      group,
      assignment,
      { actorUserId: input.actorUserId, reason },
    )
    return {
      decision: 'revoked' as const,
      organizationVersion: revoked.organizationVersion,
      targetUserId: revoked.userId,
      groupId: revoked.groupId,
      assignmentId: revoked.assignmentId,
      revokedAt: revoked.revokedAt,
    }
  })
}

export async function blockOrganizationReviewerMember(
  input: BlockOrganizationReviewerMemberCommand,
) {
  const reason = requireReason(input.reason)
  return db.transaction(async (transaction) => {
    const organization = await authorizeCommand(transaction, input, 'member-audit.members.block')
    requireDifferentTarget(input)
    await requireNonReviewerTarget(transaction, input)
    const block = await blockOrganizationMemberInTransaction(transaction, organization, {
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId,
      reason,
    })
    return {
      decision: 'blocked' as const,
      organizationVersion: block.organizationVersion,
      targetUserId: block.userId,
      blockId: block.blockId,
      blockedAt: block.blockedAt,
    }
  })
}

export async function unblockOrganizationReviewerMember(
  input: UnblockOrganizationReviewerMemberCommand,
) {
  const reason = requireReason(input.reason)
  return db.transaction(async (transaction) => {
    const organization = await authorizeCommand(transaction, input, 'member-audit.members.block')
    requireDifferentTarget(input)
    await requireNonReviewerTarget(transaction, input)
    const block = await unblockOrganizationMemberInTransaction(transaction, organization, {
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId,
      reason,
    })
    return {
      decision: 'unblocked' as const,
      organizationVersion: block.organizationVersion,
      targetUserId: block.userId,
      blockId: block.blockId,
      unblockedAt: block.unblockedAt,
    }
  })
}

async function authorizeCommand(
  transaction: DatabaseTransaction,
  input: OrganizationReviewerCommandBinding<OrganizationReviewerActionPermission>,
  expectedPermission: OrganizationReviewerActionPermission,
) {
  const organization = await lockCurrentOrganization(transaction)
  if (
    input.organizationDeploymentId !== 1 ||
    input.organizationVersion !== organization.organizationVersion ||
    input.requiredPermission !== expectedPermission
  )
    throw new OrganizationReviewerCommandError('invalid-binding')

  const now = new Date()
  const [targetLifecycle] = await transaction
    .select({ id: organizationManagedMemberLifecycles.managedMemberLifecycleId })
    .from(organizationManagedMemberLifecycles)
    .where(
      and(
        eq(
          organizationManagedMemberLifecycles.managedMemberLifecycleId,
          input.managedMemberLifecycleId,
        ),
        eq(organizationManagedMemberLifecycles.deploymentId, input.organizationDeploymentId),
        eq(organizationManagedMemberLifecycles.organizationVersion, input.organizationVersion),
        eq(organizationManagedMemberLifecycles.userId, input.targetUserId),
        isNull(organizationManagedMemberLifecycles.endedAt),
      ),
    )
    .for('key share')
  if (!targetLifecycle) throw new OrganizationReviewerCommandError('invalid-binding')

  if (
    !(await hasCurrentComplianceAccess(
      transaction,
      input.organizationVersion,
      input.actorUserId,
      now,
    ))
  )
    throw new OrganizationReviewerCommandError('reviewer-authority-required')
  const [actorBlock] = await transaction
    .select({ id: organizationMemberBlocks.blockId })
    .from(organizationMemberBlocks)
    .where(
      and(
        eq(organizationMemberBlocks.deploymentId, input.organizationDeploymentId),
        eq(organizationMemberBlocks.organizationVersion, input.organizationVersion),
        eq(organizationMemberBlocks.userId, input.actorUserId),
        isNull(organizationMemberBlocks.unblockedAt),
      ),
    )
    .for('key share')
  if (actorBlock) throw new OrganizationReviewerCommandError('reviewer-authority-required')
  const [reviewerGrant] = await transaction
    .select({ id: organizationRoleGrants.grantId })
    .from(organizationRoleGrants)
    .where(
      and(
        eq(organizationRoleGrants.deploymentId, input.organizationDeploymentId),
        eq(organizationRoleGrants.organizationVersion, input.organizationVersion),
        eq(organizationRoleGrants.userId, input.actorUserId),
        inArray(organizationRoleGrants.role, ['hr_auditor', 'director']),
        isNull(organizationRoleGrants.revokedAt),
      ),
    )
    .for('key share')
  if (!reviewerGrant) throw new OrganizationReviewerCommandError('reviewer-authority-required')

  const [permission] = await transaction
    .select({ assignmentId: organizationGroupAssignments.assignmentId })
    .from(organizationGroupAssignments)
    .innerJoin(
      organizationGroups,
      and(
        eq(organizationGroups.groupId, organizationGroupAssignments.groupId),
        eq(organizationGroups.deploymentId, organizationGroupAssignments.deploymentId),
        eq(
          organizationGroups.organizationVersion,
          organizationGroupAssignments.organizationVersion,
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
        eq(organizationGroupAssignments.deploymentId, input.organizationDeploymentId),
        eq(organizationGroupAssignments.organizationVersion, input.organizationVersion),
        eq(organizationGroupAssignments.userId, input.actorUserId),
        isNull(organizationGroupAssignments.revokedAt),
        or(
          isNull(organizationGroupAssignments.expiresAt),
          gt(organizationGroupAssignments.expiresAt, now),
        ),
        eq(organizationGroups.restricted, true),
        eq(organizationGroups.managementMode, 'manual'),
        eq(organizationPermissionBundleEntries.permissionType, 'module'),
        eq(organizationPermissionBundleEntries.permissionKey, expectedPermission),
      ),
    )
    .for('key share')
  if (!permission) throw new OrganizationReviewerCommandError('reviewer-permission-required')
  return organization
}

async function loadOrdinaryGroupForUpdate(
  transaction: DatabaseTransaction,
  organizationVersion: number,
  groupId: string,
) {
  const group = await loadCurrentGroupForUpdate(transaction, organizationVersion, groupId)
  if (group.restricted) throw new OrganizationReviewerCommandError('restricted-group-not-allowed')
  if (group.managementMode === 'compliance')
    throw new OrganizationReviewerCommandError('compliance-group-not-allowed')
  const [reviewerPermission] = await transaction
    .select({ key: organizationPermissionBundleEntries.permissionKey })
    .from(organizationGroupPermissionBundles)
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
        eq(organizationGroupPermissionBundles.groupId, group.groupId),
        eq(organizationGroupPermissionBundles.deploymentId, 1),
        eq(organizationGroupPermissionBundles.organizationVersion, organizationVersion),
        eq(organizationPermissionBundleEntries.permissionType, 'module'),
        like(organizationPermissionBundleEntries.permissionKey, 'member-audit.%'),
      ),
    )
    .limit(1)
  if (reviewerPermission)
    throw new OrganizationReviewerCommandError('reviewer-permission-group-not-allowed')
  return group
}

async function requireNonReviewerTarget(
  transaction: DatabaseTransaction,
  input: OrganizationReviewerCommandBinding<OrganizationReviewerActionPermission>,
) {
  const [reviewerGrant] = await transaction
    .select({ id: organizationRoleGrants.grantId })
    .from(organizationRoleGrants)
    .where(
      and(
        eq(organizationRoleGrants.deploymentId, input.organizationDeploymentId),
        eq(organizationRoleGrants.organizationVersion, input.organizationVersion),
        eq(organizationRoleGrants.userId, input.targetUserId),
        inArray(organizationRoleGrants.role, ['hr_auditor', 'director', 'organization_owner']),
        isNull(organizationRoleGrants.revokedAt),
      ),
    )
    .for('key share')
  if (reviewerGrant) throw new OrganizationReviewerCommandError('reviewer-target-not-allowed')
}

function requireDifferentTarget(
  input: OrganizationReviewerCommandBinding<OrganizationReviewerActionPermission>,
) {
  if (input.actorUserId === input.targetUserId)
    throw new OrganizationReviewerCommandError('self-target-not-allowed')
}

function requireReason(reason: string) {
  const result = organizationAuditReasonSchema.safeParse(reason)
  if (!result.success) throw new OrganizationReviewerCommandError('invalid-reason')
  return result.data
}
