import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { deploymentSettings, organizationAccountCompliance } from '../db/schema.js'
import { normalizeScopeSet } from '../domain-events/definitions.js'
import { appendOrganizationAuditEvent } from './audit.js'
import { recomputeAllOrganizationAccountsInTransaction } from './compliance.js'
import { hasCurrentOrganizationOwnerAuthorityInTransaction } from './role-store.js'

const maximumStrictRemediationDurationSeconds = 30 * 24 * 60 * 60
const maximumStaleEvidenceGraceDurationSeconds = 24 * 60 * 60

export class OrganizationRegistrationPolicyMutationError extends Error {
  constructor(
    readonly code: 'owner-authority-required' | 'owner-policy-noncompliant' | 'invalid-policy',
  ) {
    super(code)
  }
}

export async function updateOrganizationRegistrationPolicy(input: {
  actorUserId: string
  requiredScopes: string[]
  strictRemediationDurationSeconds: number
  staleEvidenceGraceDurationSeconds: number
  reason: string
}) {
  return db.transaction(async (transaction) => {
    const [current] = await transaction
      .select()
      .from(deploymentSettings)
      .where(eq(deploymentSettings.id, 1))
      .for('update')
    if (!current) throw new Error('Deployment organization is not configured')
    if (!(await hasCurrentOrganizationOwnerAuthorityInTransaction(transaction, input.actorUserId)))
      throw new OrganizationRegistrationPolicyMutationError('owner-authority-required')

    const requiredScopes = normalizeScopeSet(input.requiredScopes.map((scope) => scope.trim()))
    if (
      requiredScopes.some((scope) => !scope || scope.length > 200) ||
      !Number.isInteger(input.strictRemediationDurationSeconds) ||
      input.strictRemediationDurationSeconds < 0 ||
      input.strictRemediationDurationSeconds > maximumStrictRemediationDurationSeconds ||
      !Number.isInteger(input.staleEvidenceGraceDurationSeconds) ||
      input.staleEvidenceGraceDurationSeconds < 0 ||
      input.staleEvidenceGraceDurationSeconds > maximumStaleEvidenceGraceDurationSeconds ||
      !input.reason.trim()
    )
      throw new OrganizationRegistrationPolicyMutationError('invalid-policy')

    const unchanged =
      JSON.stringify(current.requiredRegistrationScopes) === JSON.stringify(requiredScopes) &&
      current.strictRemediationDurationSeconds === input.strictRemediationDurationSeconds &&
      current.staleEvidenceGraceDurationSeconds === input.staleEvidenceGraceDurationSeconds
    if (unchanged) return toPolicy(current)

    const now = new Date()
    const registrationPolicyVersion = current.registrationPolicyVersion + 1
    const [updated] = await transaction
      .update(deploymentSettings)
      .set({
        requiredRegistrationScopes: requiredScopes,
        strictRemediationDurationSeconds: input.strictRemediationDurationSeconds,
        staleEvidenceGraceDurationSeconds: input.staleEvidenceGraceDurationSeconds,
        registrationPolicyVersion,
        updatedAt: now,
      })
      .where(eq(deploymentSettings.id, 1))
      .returning()
    if (!updated) throw new Error('Failed to update organization registration policy')

    await appendOrganizationAuditEvent(transaction, {
      deploymentId: 1,
      organizationVersion: current.organizationVersion,
      policyVersion: registrationPolicyVersion,
      eventType: 'registration-policy.changed',
      actorType: 'user',
      actorId: input.actorUserId,
      subjectType: 'deployment',
      subjectId: '1',
      reason: input.reason,
      outcome: 'transitioned',
      occurredAt: now,
    })
    await recomputeAllOrganizationAccountsInTransaction(transaction, {
      deploymentId: 1,
      organizationVersion: current.organizationVersion,
      now,
    })
    const [actorCompliance] = await transaction
      .select({ state: organizationAccountCompliance.state })
      .from(organizationAccountCompliance)
      .where(
        and(
          eq(organizationAccountCompliance.deploymentId, 1),
          eq(organizationAccountCompliance.organizationVersion, current.organizationVersion),
          eq(organizationAccountCompliance.userId, input.actorUserId),
        ),
      )
    if (actorCompliance?.state !== 'compliant')
      throw new OrganizationRegistrationPolicyMutationError('owner-policy-noncompliant')
    return toPolicy(updated)
  })
}

function toPolicy(settings: typeof deploymentSettings.$inferSelect) {
  return {
    organizationVersion: settings.organizationVersion,
    policyVersion: settings.registrationPolicyVersion,
    requiredScopes: settings.requiredRegistrationScopes,
    strictRemediationDurationSeconds: settings.strictRemediationDurationSeconds,
    staleEvidenceGraceDurationSeconds: settings.staleEvidenceGraceDurationSeconds,
  }
}
