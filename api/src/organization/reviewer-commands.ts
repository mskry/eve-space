import { and, eq, gt, isNull, or } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '../db/client.js'
import {
  organizationGroupAssignments,
  organizationGroupPermissionBundles,
  organizationGroups,
  organizationManagedMemberLifecycles,
  organizationMemberBlocks,
  organizationPermissionBundleEntries,
  organizationRoleGrants,
  deploymentModules,
} from '../db/schema.js'
import { organizationAuditReasonSchema } from './audit.js'
import {
  blockOrganizationMemberInTransaction,
  unblockOrganizationMemberInTransaction,
} from './block-store.js'
import { hasCurrentComplianceAccess } from './compliance-access.js'
import { loadEffectiveOrganizationAuthority } from './effective-authority.js'
import {
  loadCurrentGroupForUpdate,
  loadUnrevokedGroupAssignmentByIdForUpdate,
} from './group-assignment-store.js'
import {
  assignManualOrganizationGroupInTransaction,
  revokeManualOrganizationGroupAssignmentInTransaction,
} from './group-store.js'
import { lockCurrentOrganization } from './organization-lock.js'
import { organizationReviewerPermissionExists } from './reviewer-group-policy.js'
import { currentCatalogPermission } from './permission-catalog-store.js'

export interface OrganizationReviewerCommandBinding {
  readonly organizationDeploymentId: 1
  readonly organizationVersion: number
  readonly actorUserId: string
  readonly publisherPackage: string
  readonly moduleId: string
  readonly targetUserId: string
  readonly managedMemberLifecycleId: string
  readonly requiredPermission: string
  readonly reason: string
}

export interface AssignOrganizationReviewerGroupCommand extends OrganizationReviewerCommandBinding {
  readonly groupId: string
  readonly expiresAt?: Date | null
}

export interface RevokeOrganizationReviewerGroupCommand extends OrganizationReviewerCommandBinding {
  readonly groupId: string
  readonly assignmentId: string
}

export type BlockOrganizationReviewerMemberCommand = OrganizationReviewerCommandBinding

export type UnblockOrganizationReviewerMemberCommand = OrganizationReviewerCommandBinding

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
      | 'rule-group-not-allowed'
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
    const organization = await authorizeCommand(transaction, input)
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
        expiresAt: input.expiresAt ?? null,
        reason,
        targetUserId: input.targetUserId,
      },
    )
    return {
      assignmentId: assignment.assignmentId,
      decision: 'assigned' as const,
      expiresAt: assignment.expiresAt,
      groupId: assignment.groupId,
      organizationVersion: assignment.organizationVersion,
      targetUserId: assignment.userId,
    }
  })
}

export async function revokeOrganizationReviewerOrdinaryGroup(
  input: RevokeOrganizationReviewerGroupCommand,
) {
  const reason = requireReason(input.reason)
  return db.transaction(async (transaction) => {
    const organization = await authorizeCommand(transaction, input)
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
    if (assignment?.userId !== input.targetUserId) {
      throw new OrganizationReviewerCommandError('assignment-binding-invalid')
    }
    const revoked = await revokeManualOrganizationGroupAssignmentInTransaction(
      transaction,
      organization,
      group,
      assignment,
      { actorUserId: input.actorUserId, reason },
    )
    return {
      assignmentId: revoked.assignmentId,
      decision: 'revoked' as const,
      groupId: revoked.groupId,
      organizationVersion: revoked.organizationVersion,
      revokedAt: revoked.revokedAt,
      targetUserId: revoked.userId,
    }
  })
}

export async function blockOrganizationReviewerMember(
  input: BlockOrganizationReviewerMemberCommand,
) {
  const reason = requireReason(input.reason)
  return db.transaction(async (transaction) => {
    const organization = await authorizeCommand(transaction, input)
    requireDifferentTarget(input)
    await requireNonReviewerTarget(transaction, input)
    const block = await blockOrganizationMemberInTransaction(transaction, organization, {
      actorUserId: input.actorUserId,
      reason,
      targetUserId: input.targetUserId,
    })
    return {
      blockId: block.blockId,
      blockedAt: block.blockedAt,
      decision: 'blocked' as const,
      organizationVersion: block.organizationVersion,
      targetUserId: block.userId,
    }
  })
}

export async function unblockOrganizationReviewerMember(
  input: UnblockOrganizationReviewerMemberCommand,
) {
  const reason = requireReason(input.reason)
  return db.transaction(async (transaction) => {
    const organization = await authorizeCommand(transaction, input)
    requireDifferentTarget(input)
    await requireNonReviewerTarget(transaction, input)
    const block = await unblockOrganizationMemberInTransaction(transaction, organization, {
      actorUserId: input.actorUserId,
      reason,
      targetUserId: input.targetUserId,
    })
    return {
      blockId: block.blockId,
      decision: 'unblocked' as const,
      organizationVersion: block.organizationVersion,
      targetUserId: block.userId,
      unblockedAt: block.unblockedAt,
    }
  })
}

async function authorizeCommand(
  transaction: DatabaseTransaction,
  input: OrganizationReviewerCommandBinding,
) {
  if (
    !currentCatalogPermission({
      key: input.requiredPermission,
      moduleId: input.moduleId,
      publisherPackage: input.publisherPackage,
    })
  ) {
    throw new OrganizationReviewerCommandError('reviewer-permission-required')
  }
  const organization = await lockCurrentOrganization(transaction)
  if (
    input.organizationDeploymentId !== 1 ||
    input.organizationVersion !== organization.organizationVersion
  ) {
    throw new OrganizationReviewerCommandError('invalid-binding')
  }

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
  if (!targetLifecycle) {
    throw new OrganizationReviewerCommandError('invalid-binding')
  }

  if (
    !(await hasCurrentComplianceAccess(
      transaction,
      input.organizationVersion,
      input.actorUserId,
      now,
    ))
  ) {
    throw new OrganizationReviewerCommandError('reviewer-authority-required')
  }
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
  if (actorBlock) {
    throw new OrganizationReviewerCommandError('reviewer-authority-required')
  }
  const [hrGrant] = await transaction
    .select({ id: organizationRoleGrants.grantId })
    .from(organizationRoleGrants)
    .where(
      and(
        eq(organizationRoleGrants.deploymentId, input.organizationDeploymentId),
        eq(organizationRoleGrants.organizationVersion, input.organizationVersion),
        eq(organizationRoleGrants.userId, input.actorUserId),
        eq(organizationRoleGrants.role, 'hr_auditor'),
        isNull(organizationRoleGrants.revokedAt),
      ),
    )
    .for('key share')
  const authority = await loadEffectiveOrganizationAuthority(
    transaction,
    input.organizationVersion,
    input.actorUserId,
    'mutate',
    now,
  )
  if (!hrGrant && !authority.director) {
    throw new OrganizationReviewerCommandError('reviewer-authority-required')
  }

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
    .innerJoin(
      deploymentModules,
      and(
        eq(deploymentModules.moduleId, organizationPermissionBundleEntries.moduleId),
        eq(deploymentModules.enabled, true),
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
        eq(organizationPermissionBundleEntries.publisherPackage, input.publisherPackage),
        eq(organizationPermissionBundleEntries.moduleId, input.moduleId),
        eq(organizationPermissionBundleEntries.permissionKey, input.requiredPermission),
      ),
    )
    .for('key share')
  if (!permission) {
    throw new OrganizationReviewerCommandError('reviewer-permission-required')
  }
  return organization
}

async function loadOrdinaryGroupForUpdate(
  transaction: DatabaseTransaction,
  organizationVersion: number,
  groupId: string,
) {
  const group = await loadCurrentGroupForUpdate(transaction, organizationVersion, groupId)
  if (group.managementMode === 'compliance') {
    throw new OrganizationReviewerCommandError('compliance-group-not-allowed')
  }
  if (group.managementMode === 'rule') {
    throw new OrganizationReviewerCommandError('rule-group-not-allowed')
  }
  if (group.restricted) {
    throw new OrganizationReviewerCommandError('restricted-group-not-allowed')
  }
  const [reviewerPermission] = await transaction
    .select({
      exists: organizationReviewerPermissionExists(organizationVersion, group.groupId),
    })
    .from(organizationGroups)
    .where(eq(organizationGroups.groupId, group.groupId))
    .limit(1)
  if (reviewerPermission?.exists) {
    throw new OrganizationReviewerCommandError('reviewer-permission-group-not-allowed')
  }
  return group
}

async function requireNonReviewerTarget(
  transaction: DatabaseTransaction,
  input: OrganizationReviewerCommandBinding,
) {
  const [hrGrant] = await transaction
    .select({ id: organizationRoleGrants.grantId })
    .from(organizationRoleGrants)
    .where(
      and(
        eq(organizationRoleGrants.deploymentId, input.organizationDeploymentId),
        eq(organizationRoleGrants.organizationVersion, input.organizationVersion),
        eq(organizationRoleGrants.userId, input.targetUserId),
        eq(organizationRoleGrants.role, 'hr_auditor'),
        isNull(organizationRoleGrants.revokedAt),
      ),
    )
    .for('key share')
  const authority = await loadEffectiveOrganizationAuthority(
    transaction,
    input.organizationVersion,
    input.targetUserId,
    'read-continuity',
  )
  if (hrGrant || authority.director || authority.organizationOwner) {
    throw new OrganizationReviewerCommandError('reviewer-target-not-allowed')
  }
}

function requireDifferentTarget(input: OrganizationReviewerCommandBinding) {
  if (input.actorUserId === input.targetUserId) {
    throw new OrganizationReviewerCommandError('self-target-not-allowed')
  }
}

function requireReason(reason: string) {
  const result = organizationAuditReasonSchema.safeParse(reason)
  if (!result.success) {
    throw new OrganizationReviewerCommandError('invalid-reason')
  }
  return result.data
}
