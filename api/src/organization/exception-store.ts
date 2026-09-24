import { and, asc, eq, gt, inArray, isNull, lte, notExists, or, sql } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '../db/client.js'
import {
  characters,
  deploymentSettings,
  organizationAccountCompliance,
  organizationCharacterExceptions,
  organizationComplianceIssues,
  organizationManagedCorporations,
  organizationMemberBlocks,
  organizationRoleGrants,
  platformCollectionState,
  platformSubjectLifecycles,
  users,
} from '../db/schema.js'
import { appendOrganizationAuditEvent, appendOrganizationAuditEvents } from './audit.js'
import { hasCurrentComplianceAccess } from './compliance-access.js'
import { recomputeOrganizationAccountCompliance } from './compliance.js'
import { lockCurrentOrganization } from './organization-lock.js'

type Transaction = DatabaseTransaction

export class OrganizationCharacterExceptionMutationError extends Error {
  constructor(
    readonly code:
      | 'hr-authority-required'
      | 'character-not-found'
      | 'character-affiliation-stale'
      | 'managed-corporation-evidence-stale'
      | 'character-not-external'
      | 'exception-already-active'
      | 'exception-not-found'
      | 'invalid-expiry',
  ) {
    super(code)
  }
}

export async function listCurrentOrganizationCharacterExceptions() {
  return db
    .select({
      approvedAt: organizationCharacterExceptions.approvedAt,
      approverUserId: organizationCharacterExceptions.approverUserId,
      characterId: organizationCharacterExceptions.characterId,
      characterName: characters.name,
      exceptionId: organizationCharacterExceptions.exceptionId,
      expiredAt: organizationCharacterExceptions.expiredAt,
      expiresAt: organizationCharacterExceptions.expiresAt,
      organizationVersion: organizationCharacterExceptions.organizationVersion,
      reason: organizationCharacterExceptions.reason,
      revocationReason: organizationCharacterExceptions.revocationReason,
      revokedAt: organizationCharacterExceptions.revokedAt,
      revokedByUserId: organizationCharacterExceptions.revokedByUserId,
      userId: organizationCharacterExceptions.userId,
    })
    .from(deploymentSettings)
    .innerJoin(
      organizationCharacterExceptions,
      and(
        eq(organizationCharacterExceptions.deploymentId, deploymentSettings.id),
        eq(
          organizationCharacterExceptions.organizationVersion,
          deploymentSettings.organizationVersion,
        ),
      ),
    )
    .innerJoin(characters, eq(characters.characterId, organizationCharacterExceptions.characterId))
    .where(eq(deploymentSettings.id, 1))
    .orderBy(
      asc(organizationCharacterExceptions.approvedAt),
      asc(organizationCharacterExceptions.exceptionId),
    )
}

export async function listCurrentOrganizationCharacterExceptionCandidates(now = new Date()) {
  return db
    .select({
      affiliationCheckedAt: characters.affiliationCheckedAt,
      characterId: characters.characterId,
      characterName: characters.name,
      evidenceFreshness: organizationAccountCompliance.evidenceFreshness,
      reasonCode: organizationComplianceIssues.issueCode,
      reviewDeadline: organizationAccountCompliance.reviewDeadline,
      state: organizationAccountCompliance.state,
      userId: organizationComplianceIssues.userId,
    })
    .from(deploymentSettings)
    .innerJoin(
      organizationComplianceIssues,
      and(
        eq(organizationComplianceIssues.deploymentId, deploymentSettings.id),
        eq(
          organizationComplianceIssues.organizationVersion,
          deploymentSettings.organizationVersion,
        ),
      ),
    )
    .innerJoin(
      organizationAccountCompliance,
      and(
        eq(organizationAccountCompliance.deploymentId, organizationComplianceIssues.deploymentId),
        eq(
          organizationAccountCompliance.organizationVersion,
          organizationComplianceIssues.organizationVersion,
        ),
        eq(organizationAccountCompliance.userId, organizationComplianceIssues.userId),
      ),
    )
    .innerJoin(
      characters,
      and(
        eq(characters.userId, organizationComplianceIssues.userId),
        eq(characters.characterId, organizationComplianceIssues.characterId),
      ),
    )
    .where(
      and(
        eq(deploymentSettings.id, 1),
        eq(organizationComplianceIssues.issueCode, 'character-outside-managed-organization'),
        eq(organizationAccountCompliance.authoritative, true),
        inArray(organizationAccountCompliance.state, ['review_required', 'suspended']),
        notExists(
          db
            .select({ value: sql`1` })
            .from(organizationCharacterExceptions)
            .where(
              and(
                eq(
                  organizationCharacterExceptions.deploymentId,
                  organizationComplianceIssues.deploymentId,
                ),
                eq(
                  organizationCharacterExceptions.organizationVersion,
                  organizationComplianceIssues.organizationVersion,
                ),
                eq(organizationCharacterExceptions.userId, organizationComplianceIssues.userId),
                eq(
                  organizationCharacterExceptions.characterId,
                  organizationComplianceIssues.characterId,
                ),
                isNull(organizationCharacterExceptions.expiredAt),
                isNull(organizationCharacterExceptions.revokedAt),
                or(
                  isNull(organizationCharacterExceptions.expiresAt),
                  gt(organizationCharacterExceptions.expiresAt, now),
                ),
              ),
            ),
        ),
      ),
    )
    .orderBy(
      asc(organizationAccountCompliance.reviewDeadline),
      asc(characters.name),
      asc(characters.characterId),
    )
}

export async function approveOrganizationCharacterException(input: {
  actorUserId: string
  userId: string
  characterId: number
  reason: string
  expiresAt: Date | null
}) {
  return db.transaction(async (transaction) => {
    const organization = await lockCurrentOrganization(transaction, 'key share')
    if (!(await hasHrAuthority(transaction, organization.organizationVersion, input.actorUserId))) {
      throw new OrganizationCharacterExceptionMutationError('hr-authority-required')
    }
    const now = new Date()
    if (input.expiresAt && input.expiresAt <= now) {
      throw new OrganizationCharacterExceptionMutationError('invalid-expiry')
    }

    const [account] = await transaction
      .select({ userId: users.id })
      .from(users)
      .where(eq(users.id, input.userId))
      .for('update')
    if (!account) {
      throw new OrganizationCharacterExceptionMutationError('character-not-found')
    }
    const [character] = await transaction
      .select({
        affiliationCheckedAt: characters.affiliationCheckedAt,
        affiliationResolutionState: characters.affiliationResolutionState,
        corporationId: characters.corporationId,
        nextAffiliationCheck: characters.nextAffiliationCheck,
      })
      .from(characters)
      .where(
        and(eq(characters.userId, input.userId), eq(characters.characterId, input.characterId)),
      )
      .for('update')
    if (!character) {
      throw new OrganizationCharacterExceptionMutationError('character-not-found')
    }
    if (
      character.affiliationResolutionState !== 'resolved' ||
      !character.affiliationCheckedAt ||
      !character.nextAffiliationCheck ||
      character.nextAffiliationCheck <= now
    ) {
      throw new OrganizationCharacterExceptionMutationError('character-affiliation-stale')
    }
    if (organization.organizationType === 'alliance') {
      const [managedEvidence] = await transaction
        .select({
          lastFailureClass: platformCollectionState.lastFailureClass,
          nextEligibleAt: platformCollectionState.nextEligibleAt,
          validatedAt: platformCollectionState.validatedAt,
        })
        .from(platformSubjectLifecycles)
        .leftJoin(
          platformCollectionState,
          and(
            eq(platformCollectionState.moduleId, 'core'),
            eq(platformCollectionState.resourceId, 'managed-corporations'),
            eq(platformCollectionState.subjectKind, 'alliance'),
            eq(
              platformCollectionState.subjectLifecycleId,
              platformSubjectLifecycles.subjectLifecycleId,
            ),
          ),
        )
        .where(
          and(
            eq(platformSubjectLifecycles.subjectKind, 'alliance'),
            eq(platformSubjectLifecycles.organizationDeploymentId, 1),
            eq(platformSubjectLifecycles.organizationVersion, organization.organizationVersion),
          ),
        )
      if (
        !managedEvidence?.validatedAt ||
        managedEvidence.lastFailureClass ||
        !managedEvidence.nextEligibleAt ||
        managedEvidence.nextEligibleAt <= now
      ) {
        throw new OrganizationCharacterExceptionMutationError('managed-corporation-evidence-stale')
      }
    }

    const [managed] = await transaction
      .select({ corporationId: organizationManagedCorporations.corporationId })
      .from(organizationManagedCorporations)
      .where(
        and(
          eq(organizationManagedCorporations.deploymentId, 1),
          eq(organizationManagedCorporations.organizationVersion, organization.organizationVersion),
          eq(organizationManagedCorporations.corporationId, character.corporationId),
          eq(organizationManagedCorporations.isCurrent, true),
        ),
      )
    if (managed) {
      throw new OrganizationCharacterExceptionMutationError('character-not-external')
    }

    const [existing] = await transaction
      .select({ exceptionId: organizationCharacterExceptions.exceptionId })
      .from(organizationCharacterExceptions)
      .where(
        and(
          eq(organizationCharacterExceptions.deploymentId, 1),
          eq(organizationCharacterExceptions.organizationVersion, organization.organizationVersion),
          eq(organizationCharacterExceptions.userId, input.userId),
          eq(organizationCharacterExceptions.characterId, input.characterId),
          isNull(organizationCharacterExceptions.revokedAt),
          isNull(organizationCharacterExceptions.expiredAt),
          or(
            isNull(organizationCharacterExceptions.expiresAt),
            gt(organizationCharacterExceptions.expiresAt, now),
          ),
        ),
      )
      .for('update')
    if (existing) {
      throw new OrganizationCharacterExceptionMutationError('exception-already-active')
    }

    const [exception] = await transaction
      .insert(organizationCharacterExceptions)
      .values({
        approvedAt: now,
        approverUserId: input.actorUserId,
        characterId: input.characterId,
        deploymentId: 1,
        expiresAt: input.expiresAt,
        organizationVersion: organization.organizationVersion,
        reason: input.reason,
        userId: input.userId,
      })
      .returning()
    if (!exception) {
      throw new Error('Failed to approve organization character exception')
    }
    await appendOrganizationAuditEvent(transaction, {
      actorId: input.actorUserId,
      actorType: 'user',
      deploymentId: 1,
      eventType: 'exception.approved',
      occurredAt: now,
      organizationVersion: organization.organizationVersion,
      outcome: 'granted',
      policyVersion: organization.policyVersion,
      reason: input.reason,
      subjectId: exception.exceptionId,
      subjectType: 'exception',
    })
    await recomputeOrganizationAccountCompliance(
      {
        deploymentId: 1,
        now,
        organizationVersion: organization.organizationVersion,
        userId: input.userId,
      },
      transaction,
    )
    return exception
  })
}

export async function revokeOrganizationCharacterException(input: {
  actorUserId: string
  exceptionId: string
  reason: string
}) {
  return db.transaction(async (transaction) => {
    const organization = await lockCurrentOrganization(transaction, 'key share')
    if (!(await hasHrAuthority(transaction, organization.organizationVersion, input.actorUserId))) {
      throw new OrganizationCharacterExceptionMutationError('hr-authority-required')
    }
    const [candidate] = await transaction
      .select({ userId: organizationCharacterExceptions.userId })
      .from(organizationCharacterExceptions)
      .where(
        and(
          eq(organizationCharacterExceptions.exceptionId, input.exceptionId),
          eq(organizationCharacterExceptions.deploymentId, 1),
          eq(organizationCharacterExceptions.organizationVersion, organization.organizationVersion),
          isNull(organizationCharacterExceptions.revokedAt),
          isNull(organizationCharacterExceptions.expiredAt),
        ),
      )
    if (!candidate) {
      throw new OrganizationCharacterExceptionMutationError('exception-not-found')
    }
    await transaction
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, candidate.userId))
      .for('update')
    const now = new Date()
    const [exception] = await transaction
      .update(organizationCharacterExceptions)
      .set({
        revocationReason: input.reason,
        revokedAt: now,
        revokedByUserId: input.actorUserId,
        updatedAt: now,
      })
      .where(
        and(
          eq(organizationCharacterExceptions.exceptionId, input.exceptionId),
          isNull(organizationCharacterExceptions.revokedAt),
          isNull(organizationCharacterExceptions.expiredAt),
          or(
            isNull(organizationCharacterExceptions.expiresAt),
            gt(organizationCharacterExceptions.expiresAt, now),
          ),
        ),
      )
      .returning()
    if (!exception) {
      throw new OrganizationCharacterExceptionMutationError('exception-not-found')
    }
    await appendOrganizationAuditEvent(transaction, {
      actorId: input.actorUserId,
      actorType: 'user',
      deploymentId: 1,
      eventType: 'exception.revoked',
      occurredAt: now,
      organizationVersion: organization.organizationVersion,
      outcome: 'revoked',
      policyVersion: organization.policyVersion,
      reason: input.reason,
      subjectId: exception.exceptionId,
      subjectType: 'exception',
    })
    await recomputeOrganizationAccountCompliance(
      {
        deploymentId: 1,
        now,
        organizationVersion: organization.organizationVersion,
        userId: exception.userId,
      },
      transaction,
    )
    return exception
  })
}

export async function expireOrganizationCharacterException(input: {
  actorUserId: string
  exceptionId: string
  reason: string
}) {
  return db.transaction(async (transaction) => {
    const organization = await lockCurrentOrganization(transaction, 'key share')
    if (!(await hasHrAuthority(transaction, organization.organizationVersion, input.actorUserId))) {
      throw new OrganizationCharacterExceptionMutationError('hr-authority-required')
    }
    const [candidate] = await transaction
      .select({
        approvedAt: organizationCharacterExceptions.approvedAt,
        userId: organizationCharacterExceptions.userId,
      })
      .from(organizationCharacterExceptions)
      .where(
        and(
          eq(organizationCharacterExceptions.exceptionId, input.exceptionId),
          eq(organizationCharacterExceptions.deploymentId, 1),
          eq(organizationCharacterExceptions.organizationVersion, organization.organizationVersion),
          isNull(organizationCharacterExceptions.revokedAt),
          isNull(organizationCharacterExceptions.expiredAt),
        ),
      )
      .for('update')
    if (!candidate) {
      throw new OrganizationCharacterExceptionMutationError('exception-not-found')
    }
    await transaction
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, candidate.userId))
      .for('update')
    const now = new Date(Math.max(Date.now(), candidate.approvedAt.getTime() + 1))
    const [exception] = await transaction
      .update(organizationCharacterExceptions)
      .set({ expiredAt: now, expiresAt: now, updatedAt: now })
      .where(
        and(
          eq(organizationCharacterExceptions.exceptionId, input.exceptionId),
          isNull(organizationCharacterExceptions.revokedAt),
          isNull(organizationCharacterExceptions.expiredAt),
        ),
      )
      .returning()
    if (!exception) {
      throw new OrganizationCharacterExceptionMutationError('exception-not-found')
    }
    await appendOrganizationAuditEvent(transaction, {
      actorId: input.actorUserId,
      actorType: 'user',
      deploymentId: 1,
      eventType: 'exception.expired',
      occurredAt: now,
      organizationVersion: organization.organizationVersion,
      outcome: 'transitioned',
      policyVersion: organization.policyVersion,
      reason: input.reason,
      subjectId: exception.exceptionId,
      subjectType: 'exception',
    })
    await recomputeOrganizationAccountCompliance(
      {
        deploymentId: 1,
        now,
        organizationVersion: organization.organizationVersion,
        userId: exception.userId,
      },
      transaction,
    )
    return exception
  })
}

export async function expireOrganizationCharacterExceptions(now = new Date(), limit = 100) {
  return db.transaction(async (transaction) => {
    const organization = await lockCurrentOrganization(transaction, 'key share')
    const due = await transaction
      .select({
        exceptionId: organizationCharacterExceptions.exceptionId,
        userId: organizationCharacterExceptions.userId,
      })
      .from(organizationCharacterExceptions)
      .where(
        and(
          eq(organizationCharacterExceptions.deploymentId, 1),
          eq(organizationCharacterExceptions.organizationVersion, organization.organizationVersion),
          isNull(organizationCharacterExceptions.revokedAt),
          isNull(organizationCharacterExceptions.expiredAt),
          lte(organizationCharacterExceptions.expiresAt, now),
        ),
      )
      .orderBy(
        asc(organizationCharacterExceptions.expiresAt),
        asc(organizationCharacterExceptions.exceptionId),
      )
      .limit(Math.max(1, Math.min(1000, Math.floor(limit))))
    if (due.length === 0) {
      return []
    }

    const userIds = [...new Set(due.map(({ userId }) => userId))].toSorted((left, right) =>
      left.localeCompare(right),
    )
    await transaction
      .select({ userId: users.id })
      .from(users)
      .where(or(...userIds.map((userId) => eq(users.id, userId))))
      .orderBy(asc(users.id))
      .for('update')
    const expired = await transaction
      .update(organizationCharacterExceptions)
      .set({ expiredAt: now, updatedAt: now })
      .where(
        and(
          eq(organizationCharacterExceptions.deploymentId, 1),
          eq(organizationCharacterExceptions.organizationVersion, organization.organizationVersion),
          inArray(
            organizationCharacterExceptions.exceptionId,
            due.map(({ exceptionId }) => exceptionId),
          ),
          isNull(organizationCharacterExceptions.revokedAt),
          isNull(organizationCharacterExceptions.expiredAt),
          lte(organizationCharacterExceptions.expiresAt, now),
        ),
      )
      .returning()
    await appendOrganizationAuditEvents(
      transaction,
      expired.map((exception) => ({
        actorId: null,
        actorType: 'system' as const,
        deploymentId: 1 as const,
        eventType: 'exception.expired' as const,
        occurredAt: now,
        organizationVersion: organization.organizationVersion,
        outcome: 'transitioned' as const,
        policyVersion: organization.policyVersion,
        reason: 'The character exception reached its configured expiry.',
        subjectId: exception.exceptionId,
        subjectType: 'exception' as const,
      })),
    )
    const affectedUserIds = [...new Set(expired.map(({ userId }) => userId))].toSorted(
      (left, right) => left.localeCompare(right),
    )
    for (const affectedUserId of affectedUserIds) {
      // oxlint-disable-next-line no-await-in-loop -- User locks must follow stable ID order.
      await recomputeOrganizationAccountCompliance(
        {
          deploymentId: 1,
          now,
          organizationVersion: organization.organizationVersion,
          userId: affectedUserId,
        },
        transaction,
      )
    }
    return expired
  })
}

async function hasHrAuthority(
  transaction: Transaction,
  organizationVersion: number,
  userId: string,
) {
  if (!(await hasCurrentComplianceAccess(transaction, organizationVersion, userId))) {
    return false
  }
  const [grant] = await transaction
    .select({ grantId: organizationRoleGrants.grantId })
    .from(organizationRoleGrants)
    .where(
      and(
        eq(organizationRoleGrants.deploymentId, 1),
        eq(organizationRoleGrants.organizationVersion, organizationVersion),
        eq(organizationRoleGrants.userId, userId),
        eq(organizationRoleGrants.role, 'hr_auditor'),
        isNull(organizationRoleGrants.revokedAt),
        notExists(
          transaction
            .select({ one: sql`1` })
            .from(organizationMemberBlocks)
            .where(
              and(
                eq(organizationMemberBlocks.deploymentId, 1),
                eq(organizationMemberBlocks.organizationVersion, organizationVersion),
                eq(organizationMemberBlocks.userId, userId),
                isNull(organizationMemberBlocks.unblockedAt),
              ),
            ),
        ),
      ),
    )
    .limit(1)
  return Boolean(grant)
}
