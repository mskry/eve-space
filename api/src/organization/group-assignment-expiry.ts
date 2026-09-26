import { and, asc, eq, isNull, lte, sql } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '../db/client.js'
import { organizationGroupAssignments } from '../db/schema.js'
import { appendGroupAudit } from './group-audit.js'
import { loadRuleAttestations, toRuleAuditSource } from './group-rule-attestation-store.js'
import { getOrganizationGroupPermissionsFromDatabase } from './group-permission-reader.js'
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
    .select()
    .from(organizationGroupAssignments)
    .where(
      and(
        eq(organizationGroupAssignments.deploymentId, 1),
        eq(organizationGroupAssignments.organizationVersion, organization.organizationVersion),
        isNull(organizationGroupAssignments.revokedAt),
        lte(organizationGroupAssignments.expiresAt, now),
      ),
    )
    .orderBy(
      asc(organizationGroupAssignments.expiresAt),
      asc(organizationGroupAssignments.assignmentId),
    )
    .for('update')
  /* oxlint-disable no-await-in-loop -- Each expiry is committed to audit before the next revocation. */
  for (const expired of expiredAssignments) {
    const expiredAt = expired.expiresAt!
    const [assignment] = await transaction
      .update(organizationGroupAssignments)
      .set({
        revocationReason: expiredGroupAssignmentReason,
        revokedActorType: 'system',
        revokedAt: sql`${organizationGroupAssignments.expiresAt}`,
        revokedByUserId: null,
        updatedAt: sql`${organizationGroupAssignments.expiresAt}`,
      })
      .where(eq(organizationGroupAssignments.assignmentId, expired.assignmentId))
      .returning()
    if (!assignment) throw new Error('Expired group assignment was not found')
    const sources =
      assignment.assignmentSource === 'rule'
        ? await loadRuleAttestations(transaction, assignment.assignmentId)
        : []
    const effective =
      assignment.assignmentSource === 'rule'
        ? await getOrganizationGroupPermissionsFromDatabase(
            transaction,
            assignment.userId,
            expiredAt,
            organization.organizationVersion,
          )
        : null
    await appendGroupAudit(transaction, organization, {
      actorId: null,
      actorType: 'system',
      assignment,
      eventType: 'group.revoked',
      now: expiredAt,
      outcome: 'revoked',
      reason: expiredGroupAssignmentReason,
      effectivePermissions: effective?.identities,
      sources: sources.map(toRuleAuditSource),
    })
  }
  /* oxlint-enable no-await-in-loop */
}
