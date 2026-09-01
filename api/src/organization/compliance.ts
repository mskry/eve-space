import { and, eq, gt, isNull, notInArray, or, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  characters,
  deploymentSettings,
  eveTokens,
  organizationAccountCompliance,
  organizationCharacterExceptions,
  organizationComplianceIssues,
  organizationManagedCorporations,
  platformCollectionState,
  platformSubjectLifecycles,
  users,
} from '../db/schema.js'
import { appendDomainEvent } from '../domain-events/store.js'
import { appendOrganizationAuditEvent } from './audit.js'
import {
  evaluateAccountCompliance,
  type AccountComplianceEvaluation,
  type AccountComplianceIssue,
} from './compliance-evaluator.js'

export async function recomputeOrganizationAccountCompliance(input: {
  deploymentId: 1
  organizationVersion: number
  userId: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  return db.transaction(async (transaction) => {
    const [account] = await transaction
      .select({ userId: users.id })
      .from(users)
      .where(eq(users.id, input.userId))
      .for('update')
    if (!account) return { outcome: 'obsolete' as const }
    const [organization] = await transaction
      .select({
        organizationVersion: deploymentSettings.organizationVersion,
        organizationType: deploymentSettings.organizationType,
        policyVersion: deploymentSettings.registrationPolicyVersion,
        requiredScopes: deploymentSettings.requiredRegistrationScopes,
        strictRemediationDurationSeconds: deploymentSettings.strictRemediationDurationSeconds,
        staleEvidenceGraceDurationSeconds: deploymentSettings.staleEvidenceGraceDurationSeconds,
      })
      .from(deploymentSettings)
      .where(
        and(
          eq(deploymentSettings.id, input.deploymentId),
          eq(deploymentSettings.organizationVersion, input.organizationVersion),
        ),
      )
      .for('key share')
    if (!organization) return { outcome: 'obsolete' as const }

    const [
      characterRows,
      managedRows,
      managedCollectionRows,
      exceptionRows,
      previousRows,
      previousIssues,
    ] = await Promise.all([
      transaction
        .select({
          characterId: characters.characterId,
          corporationId: characters.corporationId,
          affiliationCheckedAt: characters.affiliationCheckedAt,
          nextAffiliationCheck: characters.nextAffiliationCheck,
          affiliationResolutionState: characters.affiliationResolutionState,
          scopes: eveTokens.scopes,
        })
        .from(characters)
        .leftJoin(eveTokens, eq(eveTokens.characterId, characters.characterId))
        .where(eq(characters.userId, input.userId)),
      transaction
        .select({ corporationId: organizationManagedCorporations.corporationId })
        .from(organizationManagedCorporations)
        .where(
          and(
            eq(organizationManagedCorporations.deploymentId, input.deploymentId),
            eq(organizationManagedCorporations.organizationVersion, input.organizationVersion),
            eq(organizationManagedCorporations.isCurrent, true),
          ),
        ),
      transaction
        .select({
          validatedAt: platformCollectionState.validatedAt,
          nextEligibleAt: platformCollectionState.nextEligibleAt,
          lastFailureClass: platformCollectionState.lastFailureClass,
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
            eq(platformSubjectLifecycles.organizationDeploymentId, input.deploymentId),
            eq(platformSubjectLifecycles.organizationVersion, input.organizationVersion),
          ),
        ),
      transaction
        .select({ characterId: organizationCharacterExceptions.characterId })
        .from(organizationCharacterExceptions)
        .where(
          and(
            eq(organizationCharacterExceptions.deploymentId, input.deploymentId),
            eq(organizationCharacterExceptions.organizationVersion, input.organizationVersion),
            eq(organizationCharacterExceptions.userId, input.userId),
            isNull(organizationCharacterExceptions.revokedAt),
            or(
              isNull(organizationCharacterExceptions.expiresAt),
              gt(organizationCharacterExceptions.expiresAt, now),
            ),
          ),
        ),
      transaction
        .select()
        .from(organizationAccountCompliance)
        .where(
          and(
            eq(organizationAccountCompliance.deploymentId, input.deploymentId),
            eq(organizationAccountCompliance.organizationVersion, input.organizationVersion),
            eq(organizationAccountCompliance.userId, input.userId),
          ),
        )
        .for('update'),
      transaction
        .select()
        .from(organizationComplianceIssues)
        .where(
          and(
            eq(organizationComplianceIssues.deploymentId, input.deploymentId),
            eq(organizationComplianceIssues.organizationVersion, input.organizationVersion),
            eq(organizationComplianceIssues.userId, input.userId),
          ),
        ),
    ])
    const previous = previousRows[0] ?? null
    const activeExceptions = new Set(exceptionRows.map(({ characterId }) => characterId))
    const evaluation = evaluateAccountCompliance({
      characters: characterRows.map((character) =>
        Object.assign(character, {
          scopes: character.scopes ?? [],
          hasActiveException: activeExceptions.has(character.characterId),
        }),
      ),
      managedCorporationIds: new Set(managedRows.map(({ corporationId }) => corporationId)),
      managedCorporationEvidence:
        organization.organizationType === 'corporation'
          ? { freshness: 'fresh', evidenceAt: null }
          : projectManagedCorporationEvidence(managedCollectionRows[0], now),
      requiredScopes: organization.requiredScopes,
      strictRemediationDurationSeconds: organization.strictRemediationDurationSeconds,
      staleEvidenceGraceDurationSeconds: organization.staleEvidenceGraceDurationSeconds,
      previous: previous
        ? {
            state: previous.state,
            evidenceFreshness: previous.evidenceFreshness,
            evidenceAt: previous.evidenceAt,
            reviewDeadline: previous.reviewDeadline,
            establishedCompliantAt: previous.establishedCompliantAt,
            issues: previousIssues.map(toIssue),
            issueFirstObservedAt: new Map(
              previousIssues.map(({ issueKey, firstObservedAt }) => [issueKey, firstObservedAt]),
            ),
          }
        : null,
      now,
    })
    const changed = materiallyChanged(previous, previousIssues, evaluation)

    await transaction
      .insert(organizationAccountCompliance)
      .values({
        deploymentId: input.deploymentId,
        organizationVersion: input.organizationVersion,
        userId: input.userId,
        state: evaluation.state,
        evidenceFreshness: evaluation.evidenceFreshness,
        evidenceAt: evaluation.evidenceAt,
        reviewDeadline: evaluation.reviewDeadline,
        establishedCompliantAt: evaluation.establishedCompliantAt,
        authoritative: true,
        invalidatedAt: null,
        evaluatedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          organizationAccountCompliance.deploymentId,
          organizationAccountCompliance.organizationVersion,
          organizationAccountCompliance.userId,
        ],
        set: {
          state: evaluation.state,
          evidenceFreshness: evaluation.evidenceFreshness,
          evidenceAt: evaluation.evidenceAt,
          reviewDeadline: evaluation.reviewDeadline,
          establishedCompliantAt: evaluation.establishedCompliantAt,
          authoritative: true,
          invalidatedAt: null,
          evaluatedAt: now,
          updatedAt: now,
        },
      })
    await reconcileIssues(transaction, input, evaluation, previousIssues, now)
    if (changed) {
      await appendOrganizationAuditEvent(transaction, {
        deploymentId: input.deploymentId,
        organizationVersion: input.organizationVersion,
        policyVersion: organization.policyVersion,
        eventType: 'compliance.transitioned',
        actorType: 'system',
        actorId: null,
        subjectType: 'compliance',
        subjectId: input.userId,
        reason: `Account compliance changed from ${previous?.state ?? 'unprojected'} to ${evaluation.state}.`,
        outcome: 'transitioned',
        occurredAt: now,
      })
      await appendDomainEvent(transaction, {
        type: 'organization.compliance-transitioned',
        payloadVersion: 1,
        aggregateId: input.userId,
        payload: {
          deploymentId: input.deploymentId,
          organizationVersion: input.organizationVersion,
          userId: input.userId,
          state: evaluation.state,
          evidenceFreshness: evaluation.evidenceFreshness,
        },
        occurredAt: now,
      })
    }
    return { outcome: changed ? ('changed' as const) : ('unchanged' as const), evaluation }
  })
}

export async function recomputeComplianceForManagedCorporation(input: {
  deploymentId: 1
  organizationVersion: number
  corporationId: number
}) {
  const affectedUsers = await db
    .selectDistinct({ userId: characters.userId })
    .from(characters)
    .innerJoin(
      deploymentSettings,
      and(
        eq(deploymentSettings.id, input.deploymentId),
        eq(deploymentSettings.organizationVersion, input.organizationVersion),
      ),
    )
    .where(eq(characters.corporationId, input.corporationId))
  await Promise.all(
    affectedUsers.map(({ userId }) =>
      recomputeOrganizationAccountCompliance({
        deploymentId: input.deploymentId,
        organizationVersion: input.organizationVersion,
        userId,
      }),
    ),
  )
}

function projectManagedCorporationEvidence(
  state:
    | {
        validatedAt: Date | null
        nextEligibleAt: Date | null
        lastFailureClass: string | null
      }
    | undefined,
  now: Date,
) {
  if (!state?.validatedAt) return { freshness: 'unavailable' as const, evidenceAt: null }
  if (
    state.lastFailureClass ||
    !state.nextEligibleAt ||
    state.nextEligibleAt.getTime() <= now.getTime()
  )
    return { freshness: 'stale' as const, evidenceAt: state.validatedAt }
  return { freshness: 'fresh' as const, evidenceAt: state.validatedAt }
}

type ComplianceTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function reconcileIssues(
  transaction: ComplianceTransaction,
  input: { deploymentId: 1; organizationVersion: number; userId: string },
  evaluation: AccountComplianceEvaluation,
  previousIssues: (typeof organizationComplianceIssues.$inferSelect)[],
  now: Date,
) {
  const issueKeys = evaluation.issues.map(({ issueKey }) => issueKey)
  if (issueKeys.length === 0)
    await transaction
      .delete(organizationComplianceIssues)
      .where(
        and(
          eq(organizationComplianceIssues.deploymentId, input.deploymentId),
          eq(organizationComplianceIssues.organizationVersion, input.organizationVersion),
          eq(organizationComplianceIssues.userId, input.userId),
        ),
      )
  else {
    await transaction
      .delete(organizationComplianceIssues)
      .where(
        and(
          eq(organizationComplianceIssues.deploymentId, input.deploymentId),
          eq(organizationComplianceIssues.organizationVersion, input.organizationVersion),
          eq(organizationComplianceIssues.userId, input.userId),
          notInArray(organizationComplianceIssues.issueKey, issueKeys),
        ),
      )
    const previousByKey = new Map(previousIssues.map((issue) => [issue.issueKey, issue]))
    await transaction
      .insert(organizationComplianceIssues)
      .values(
        evaluation.issues.map((issue) => ({
          deploymentId: input.deploymentId,
          organizationVersion: input.organizationVersion,
          userId: input.userId,
          ...issue,
          firstObservedAt: previousByKey.get(issue.issueKey)?.firstObservedAt ?? now,
          lastObservedAt:
            evaluation.evidenceFreshness === 'fresh'
              ? now
              : (previousByKey.get(issue.issueKey)?.lastObservedAt ?? now),
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [
          organizationComplianceIssues.deploymentId,
          organizationComplianceIssues.organizationVersion,
          organizationComplianceIssues.userId,
          organizationComplianceIssues.issueKey,
        ],
        set: {
          lastObservedAt: sql`greatest(
            ${organizationComplianceIssues.lastObservedAt},
            excluded.last_observed_at
          )`,
          updatedAt: now,
        },
      })
  }
}

function materiallyChanged(
  previous: typeof organizationAccountCompliance.$inferSelect | null,
  previousIssues: (typeof organizationComplianceIssues.$inferSelect)[],
  next: AccountComplianceEvaluation,
) {
  if (
    !previous ||
    previous.state !== next.state ||
    previous.evidenceFreshness !== next.evidenceFreshness ||
    previous.reviewDeadline?.getTime() !== next.reviewDeadline?.getTime()
  )
    return true
  return (
    issueSignatures(previousIssues.map(toIssue)).join('\n') !==
    issueSignatures(next.issues).join('\n')
  )
}

function issueSignatures(issues: readonly AccountComplianceIssue[]) {
  return issues
    .map(
      ({ issueKey, issueCode, characterId, requiredScope }) =>
        `${issueKey}\u0000${issueCode}\u0000${characterId ?? ''}\u0000${requiredScope ?? ''}`,
    )
    .toSorted()
}

function toIssue(issue: typeof organizationComplianceIssues.$inferSelect): AccountComplianceIssue {
  return {
    issueKey: issue.issueKey,
    issueCode: issue.issueCode,
    characterId: issue.characterId,
    requiredScope: issue.requiredScope,
  }
}
