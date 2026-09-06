import { and, asc, eq } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '../db/client.js'
import {
  organizationGroupAssignments,
  organizationGroups,
  users,
  type OrganizationComplianceSource,
} from '../db/schema.js'
import {
  loadCurrentGroupForUpdate,
  loadUnrevokedGroupAssignmentForUpdate,
  revokeGroupAssignmentRecord,
  toOrganizationGroupAssignment,
} from './group-assignment-store.js'
import { appendGroupAudit } from './group-audit.js'
import { OrganizationGroupMutationError } from './group-mutation-error.js'
import { lockCurrentOrganization } from './organization-lock.js'

export function convergeRegistrationComplianceGroupAssignment(input: {
  groupId: string
  targetUserId: string
  eligible: boolean
  reason: string
}) {
  return convergeComplianceGroupAssignment('core.registration', input)
}

export async function convergeRegistrationComplianceGroupsInTransaction(
  transaction: DatabaseTransaction,
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
    const existing = await loadUnrevokedGroupAssignmentForUpdate(
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
    const revoked = await revokeGroupAssignmentRecord(transaction, existing!.assignmentId, {
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
    const existing = await loadUnrevokedGroupAssignmentForUpdate(
      transaction,
      organization.organizationVersion,
      group.groupId,
      input.targetUserId,
    )
    if (input.eligible === Boolean(existing))
      return {
        changed: false,
        assignment: existing ? toOrganizationGroupAssignment(existing) : null,
      }

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
      return { changed: true, assignment: toOrganizationGroupAssignment(assignment) }
    }

    const revoked = await revokeGroupAssignmentRecord(transaction, existing!.assignmentId, {
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
    return { changed: true, assignment: toOrganizationGroupAssignment(revoked) }
  })
}
