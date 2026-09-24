import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { deploymentSettings, organizationAccountCompliance } from '../db/schema.js'
import { normalizeScopeSet } from '../scopes.js'
import { appendOrganizationAuditEvent } from './audit.js'
import {
  invalidateDerivedAuthorityPolicySourcesInTransaction,
  reconcileAuthorityPolicyDeadlinesInTransaction,
} from './authority-convergence.js'
import {
  maximumAuthorityEvidenceFreshDurationSeconds,
  minimumAuthorityEvidenceFreshDurationSeconds,
} from './authority-policy.js'
import { recomputeAllOrganizationAccountsInTransaction } from './compliance.js'
import { hasCurrentOrganizationOwnerAuthorityInTransaction } from './role-store.js'
import {
  maximumStaleEvidenceGraceDurationSeconds,
  maximumStrictRemediationDurationSeconds,
} from './registration-policy.js'

export class OrganizationRegistrationPolicyMutationError extends Error {
  constructor(
    readonly code: 'owner-authority-required' | 'owner-policy-noncompliant' | 'invalid-policy',
  ) {
    super(code)
  }
}

interface RegistrationPolicyInput {
  actorUserId: string
  requiredScopes: string[]
  strictRemediationDurationSeconds: number
  staleEvidenceGraceDurationSeconds: number
  derivedDirectorAuthorityEnabled: boolean
  authorityEvidenceFreshDurationSeconds: number
  reason: string
}

export async function updateOrganizationRegistrationPolicy(input: RegistrationPolicyInput) {
  return db.transaction(async (transaction) => {
    const [current] = await transaction
      .select()
      .from(deploymentSettings)
      .where(eq(deploymentSettings.id, 1))
      .for('update')
    if (!current) {
      throw new Error('Deployment organization is not configured')
    }
    if (
      !(await hasCurrentOrganizationOwnerAuthorityInTransaction(
        transaction,
        input.actorUserId,
        new Date(),
        'mutate',
        { requireComplianceAccess: false },
      ))
    ) {
      throw new OrganizationRegistrationPolicyMutationError('owner-authority-required')
    }

    const requiredScopes = normalizeScopeSet(input.requiredScopes.map((scope) => scope.trim()))
    if (invalidRegistrationPolicy(input, requiredScopes)) {
      throw new OrganizationRegistrationPolicyMutationError('invalid-policy')
    }

    if (registrationPolicyUnchanged(current, input, requiredScopes)) {
      return toPolicy(current)
    }

    const now = new Date()
    const registrationPolicyVersion = current.registrationPolicyVersion + 1
    const [updated] = await transaction
      .update(deploymentSettings)
      .set({
        authorityEvidenceFreshDurationSeconds: input.authorityEvidenceFreshDurationSeconds,
        derivedDirectorAuthorityEnabled: input.derivedDirectorAuthorityEnabled,
        registrationPolicyVersion,
        requiredRegistrationScopes: requiredScopes,
        staleEvidenceGraceDurationSeconds: input.staleEvidenceGraceDurationSeconds,
        strictRemediationDurationSeconds: input.strictRemediationDurationSeconds,
        updatedAt: now,
      })
      .where(eq(deploymentSettings.id, 1))
      .returning()
    if (!updated) {
      throw new Error('Failed to update organization registration policy')
    }
    if (current.derivedDirectorAuthorityEnabled && !updated.derivedDirectorAuthorityEnabled) {
      await invalidateDerivedAuthorityPolicySourcesInTransaction(transaction, {
        now,
        organizationVersion: current.organizationVersion,
        policyVersion: registrationPolicyVersion,
      })
    }
    if (
      updated.authorityEvidenceFreshDurationSeconds <
        current.authorityEvidenceFreshDurationSeconds ||
      updated.staleEvidenceGraceDurationSeconds < current.staleEvidenceGraceDurationSeconds
    ) {
      await reconcileAuthorityPolicyDeadlinesInTransaction(transaction, {
        freshDurationSeconds: updated.authorityEvidenceFreshDurationSeconds,
        now,
        organizationVersion: current.organizationVersion,
        policyVersion: registrationPolicyVersion,
        staleGraceDurationSeconds: updated.staleEvidenceGraceDurationSeconds,
      })
    }
    if (
      !(await hasCurrentOrganizationOwnerAuthorityInTransaction(
        transaction,
        input.actorUserId,
        now,
        'mutate',
        { requireComplianceAccess: false },
      ))
    ) {
      throw new OrganizationRegistrationPolicyMutationError('owner-policy-noncompliant')
    }

    await appendOrganizationAuditEvent(transaction, {
      actorId: input.actorUserId,
      actorType: 'user',
      deploymentId: 1,
      eventType: 'registration-policy.changed',
      occurredAt: now,
      organizationVersion: current.organizationVersion,
      outcome: 'transitioned',
      policyVersion: registrationPolicyVersion,
      reason: input.reason,
      subjectId: '1',
      subjectType: 'deployment',
    })
    await recomputeAllOrganizationAccountsInTransaction(transaction, {
      deploymentId: 1,
      now,
      organizationVersion: current.organizationVersion,
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
    if (actorCompliance?.state !== 'compliant') {
      throw new OrganizationRegistrationPolicyMutationError('owner-policy-noncompliant')
    }
    return toPolicy(updated)
  })
}

function invalidRegistrationPolicy(input: RegistrationPolicyInput, requiredScopes: string[]) {
  return (
    requiredScopes.some((scope) => !scope || scope.length > 200) ||
    !Number.isInteger(input.strictRemediationDurationSeconds) ||
    input.strictRemediationDurationSeconds < 0 ||
    input.strictRemediationDurationSeconds > maximumStrictRemediationDurationSeconds ||
    !Number.isInteger(input.staleEvidenceGraceDurationSeconds) ||
    input.staleEvidenceGraceDurationSeconds < 0 ||
    input.staleEvidenceGraceDurationSeconds > maximumStaleEvidenceGraceDurationSeconds ||
    !Number.isInteger(input.authorityEvidenceFreshDurationSeconds) ||
    input.authorityEvidenceFreshDurationSeconds < minimumAuthorityEvidenceFreshDurationSeconds ||
    input.authorityEvidenceFreshDurationSeconds > maximumAuthorityEvidenceFreshDurationSeconds ||
    !input.reason.trim()
  )
}

function registrationPolicyUnchanged(
  current: typeof deploymentSettings.$inferSelect,
  input: RegistrationPolicyInput,
  requiredScopes: string[],
) {
  return (
    JSON.stringify(current.requiredRegistrationScopes) === JSON.stringify(requiredScopes) &&
    current.strictRemediationDurationSeconds === input.strictRemediationDurationSeconds &&
    current.staleEvidenceGraceDurationSeconds === input.staleEvidenceGraceDurationSeconds &&
    current.derivedDirectorAuthorityEnabled === input.derivedDirectorAuthorityEnabled &&
    current.authorityEvidenceFreshDurationSeconds === input.authorityEvidenceFreshDurationSeconds
  )
}

function toPolicy(settings: typeof deploymentSettings.$inferSelect) {
  return {
    authorityEvidenceFreshDurationSeconds: settings.authorityEvidenceFreshDurationSeconds,
    derivedDirectorAuthorityEnabled: settings.derivedDirectorAuthorityEnabled,
    organizationVersion: settings.organizationVersion,
    policyVersion: settings.registrationPolicyVersion,
    requiredScopes: settings.requiredRegistrationScopes,
    staleEvidenceGraceDurationSeconds: settings.staleEvidenceGraceDurationSeconds,
    strictRemediationDurationSeconds: settings.strictRemediationDurationSeconds,
  }
}
