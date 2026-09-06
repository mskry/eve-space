import { and, eq, isNull, lte, sql } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '../db/client.js'
import { organizationGroupAssignments } from '../db/schema.js'
import { appendGroupAudits } from './group-audit.js'
import { lockCurrentOrganization } from './organization-lock.js'

export const expiredGroupAssignmentReason = 'Group assignment expired.'

export async function expireCurrentOrganizationGroupAssignments(now: Date) {
  await db.transaction(async (transaction) => {
    const organization = await lockCurrentOrganization(transaction)
    await expireOrganizationGroupAssignments(transaction, organization, now)
  })
}

export async function expireOrganizationGroupAssignments(
  transaction: DatabaseTransaction,
  organization: { organizationVersion: number; policyVersion: number },
  now: Date,
) {
  const expiredAssignments = await transaction
    .update(organizationGroupAssignments)
    .set({
      revokedAt: sql`${organizationGroupAssignments.expiresAt}`,
      revokedActorType: 'system',
      revokedByUserId: null,
      revocationReason: expiredGroupAssignmentReason,
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
  await appendGroupAudits(
    transaction,
    organization,
    expiredAssignments.map((assignment) => ({
      eventType: 'group.revoked',
      actorType: 'system',
      actorId: null,
      assignment,
      reason: expiredGroupAssignmentReason,
      outcome: 'revoked',
      now: assignment.expiresAt!,
    })),
  )
}
