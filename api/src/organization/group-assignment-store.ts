import { and, eq, isNull } from 'drizzle-orm'
import type { DatabaseTransaction } from '../db/client.js'
import { organizationGroupAssignments, organizationGroups } from '../db/schema.js'
import { OrganizationGroupMutationError } from './group-mutation-error.js'

export async function loadCurrentGroupForUpdate(
  transaction: DatabaseTransaction,
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
  if (!group) {
    throw new OrganizationGroupMutationError('group-not-found')
  }
  return group
}

export async function loadUnrevokedGroupAssignmentForUpdate(
  transaction: DatabaseTransaction,
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

export async function loadUnrevokedGroupAssignmentByIdForUpdate(
  transaction: DatabaseTransaction,
  organizationVersion: number,
  groupId: string,
  assignmentId: string,
) {
  const [assignment] = await transaction
    .select()
    .from(organizationGroupAssignments)
    .where(
      and(
        eq(organizationGroupAssignments.assignmentId, assignmentId),
        eq(organizationGroupAssignments.groupId, groupId),
        eq(organizationGroupAssignments.deploymentId, 1),
        eq(organizationGroupAssignments.organizationVersion, organizationVersion),
        isNull(organizationGroupAssignments.revokedAt),
      ),
    )
    .for('update')
  return assignment
}

export async function revokeGroupAssignmentRecord(
  transaction: DatabaseTransaction,
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
      revocationReason: input.reason,
      revokedActorType: input.actorType,
      revokedAt: input.now,
      revokedByUserId: input.actorUserId,
      updatedAt: input.now,
    })
    .where(eq(organizationGroupAssignments.assignmentId, assignmentId))
    .returning()
  if (!revoked) {
    throw new Error('Failed to revoke organization group assignment')
  }
  return revoked
}

export function toOrganizationGroupAssignment(
  assignment: typeof organizationGroupAssignments.$inferSelect,
) {
  return {
    assignedActorType: assignment.assignedActorType,
    assignedAt: assignment.assignedAt.toISOString(),
    assignedByUserId: assignment.assignedByUserId,
    assignmentId: assignment.assignmentId,
    assignmentSource: assignment.assignmentSource,
    complianceSource: assignment.complianceSource,
    expiresAt: assignment.expiresAt?.toISOString() ?? null,
    groupId: assignment.groupId,
    organizationVersion: assignment.organizationVersion,
    reason: assignment.reason,
    revocationReason: assignment.revocationReason,
    revokedActorType: assignment.revokedActorType,
    revokedAt: assignment.revokedAt?.toISOString() ?? null,
    revokedByUserId: assignment.revokedByUserId,
    userId: assignment.userId,
  }
}
