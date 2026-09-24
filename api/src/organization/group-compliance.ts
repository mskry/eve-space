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
    if (input.eligible === Boolean(existing)) {
      continue
    }
    if (input.eligible) {
      const [assignment] = await transaction
        .insert(organizationGroupAssignments)
        .values({
          assignedActorType: 'system',
          assignedAt: input.now,
          assignedByUserId: null,
          assignmentSource: 'compliance',
          complianceSource: 'core.registration',
          deploymentId: 1,
          expiresAt: null,
          groupId: group.groupId,
          organizationVersion: input.organizationVersion,
          reason: 'Account registration compliance established.',
          userId: input.userId,
        })
        .returning()
      if (!assignment) {
        throw new Error('Failed to converge organization group assignment')
      }
      await appendGroupAudit(
        transaction,
        { organizationVersion: input.organizationVersion, policyVersion: input.policyVersion },
        {
          actorId: null,
          actorType: 'system',
          assignment,
          eventType: 'group.assigned',
          now: input.now,
          outcome: 'granted',
          reason: assignment.reason,
        },
      )
      continue
    }
    const revoked = await revokeGroupAssignmentRecord(transaction, existing!.assignmentId, {
      actorType: 'system',
      actorUserId: null,
      now: input.now,
      reason: 'Account registration compliance no longer grants this group.',
    })
    await appendGroupAudit(
      transaction,
      { organizationVersion: input.organizationVersion, policyVersion: input.policyVersion },
      {
        actorId: null,
        actorType: 'system',
        assignment: revoked,
        eventType: 'group.revoked',
        now: input.now,
        outcome: 'revoked',
        reason: revoked.revocationReason!,
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
    if (group.managementMode !== 'compliance' || group.complianceSource !== complianceSource) {
      throw new OrganizationGroupMutationError('compliance-source-mismatch')
    }

    const [target] = await transaction
      .select({ userId: users.id })
      .from(users)
      .where(eq(users.id, input.targetUserId))
    if (!target) {
      throw new OrganizationGroupMutationError('target-not-found')
    }
    const existing = await loadUnrevokedGroupAssignmentForUpdate(
      transaction,
      organization.organizationVersion,
      group.groupId,
      input.targetUserId,
    )
    if (input.eligible === Boolean(existing)) {
      return {
        assignment: existing ? toOrganizationGroupAssignment(existing) : null,
        changed: false,
      }
    }

    const now = new Date()
    if (input.eligible) {
      const [assignment] = await transaction
        .insert(organizationGroupAssignments)
        .values({
          assignedActorType: 'system',
          assignedAt: now,
          assignedByUserId: null,
          assignmentSource: 'compliance',
          complianceSource,
          deploymentId: 1,
          expiresAt: null,
          groupId: group.groupId,
          organizationVersion: organization.organizationVersion,
          reason: input.reason,
          userId: input.targetUserId,
        })
        .returning()
      if (!assignment) {
        throw new Error('Failed to converge organization group assignment')
      }
      await appendGroupAudit(transaction, organization, {
        actorId: null,
        actorType: 'system',
        assignment,
        eventType: 'group.assigned',
        now,
        outcome: 'granted',
        reason: input.reason,
      })
      return { assignment: toOrganizationGroupAssignment(assignment), changed: true }
    }

    const revoked = await revokeGroupAssignmentRecord(transaction, existing!.assignmentId, {
      actorType: 'system',
      actorUserId: null,
      now,
      reason: input.reason,
    })
    await appendGroupAudit(transaction, organization, {
      actorId: null,
      actorType: 'system',
      assignment: revoked,
      eventType: 'group.revoked',
      now,
      outcome: 'revoked',
      reason: input.reason,
    })
    return { assignment: toOrganizationGroupAssignment(revoked), changed: true }
  })
}
