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
  if (!group) throw new OrganizationGroupMutationError('group-not-found')
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

export function toOrganizationGroupAssignment(
  assignment: typeof organizationGroupAssignments.$inferSelect,
) {
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
