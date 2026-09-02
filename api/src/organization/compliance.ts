import { and, asc, eq, gt, inArray, isNull, notInArray, or, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  characters,
  deploymentSettings,
  eveTokens,
  organizationAccountCompliance,
  organizationCharacterExceptions,
  organizationComplianceIssues,
  organizationGroupAssignments,
  organizationGroupPermissionBundles,
  organizationManagedCorporations,
  organizationMemberBlocks,
  organizationPermissionBundleEntries,
  platformCollectionState,
  platformSubjectLifecycles,
  users,
} from '../db/schema.js'
import { appendDomainEvent } from '../domain-events/store.js'
import { appendOrganizationAuditEvent, appendOrganizationAuditEvents } from './audit.js'
import {
  evaluateAccountCompliance,
  type AccountComplianceEvaluation,
  type AccountComplianceIssue,
} from './compliance-evaluator.js'
import type { OrganizationEntitlementScope } from './compliance-access.js'
import { convergeRegistrationComplianceGroupsInTransaction } from './group-store.js'

interface RecomputeAccountComplianceInput {
  deploymentId: 1
  organizationVersion: number
  userId: string
  now?: Date
}

type ComplianceTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export function recomputeOrganizationAccountCompliance(
  input: RecomputeAccountComplianceInput,
  outerTransaction?: ComplianceTransaction,
) {
  const now = input.now ?? new Date()
  const recompute = async (transaction: ComplianceTransaction) => {
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
    const [account] = await transaction
      .select({ userId: users.id })
      .from(users)
      .where(eq(users.id, input.userId))
      .for('update')
    if (!account) return { outcome: 'obsolete' as const }

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
          failureStartedAt: platformCollectionState.failureStartedAt,
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
        .select({
          characterId: organizationCharacterExceptions.characterId,
          expiresAt: organizationCharacterExceptions.expiresAt,
        })
        .from(organizationCharacterExceptions)
        .where(
          and(
            eq(organizationCharacterExceptions.deploymentId, input.deploymentId),
            eq(organizationCharacterExceptions.organizationVersion, input.organizationVersion),
            eq(organizationCharacterExceptions.userId, input.userId),
            isNull(organizationCharacterExceptions.revokedAt),
            isNull(organizationCharacterExceptions.expiredAt),
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
    const activeExceptions = new Map(
      exceptionRows.map(({ characterId, expiresAt }) => [characterId, expiresAt]),
    )
    const evaluation = evaluateAccountCompliance({
      characters: characterRows.map((character) =>
        Object.assign(character, {
          scopes: character.scopes ?? [],
          hasActiveException: activeExceptions.has(character.characterId),
          activeExceptionExpiresAt: activeExceptions.get(character.characterId) ?? null,
        }),
      ),
      managedCorporationIds: new Set(managedRows.map(({ corporationId }) => corporationId)),
      managedCorporationEvidence:
        organization.organizationType === 'corporation'
          ? { freshness: 'fresh', evidenceAt: null, freshUntil: null, staleSince: null }
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
            accessValidUntil: previous.accessValidUntil,
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
        accessValidUntil: evaluation.accessValidUntil,
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
          accessValidUntil: evaluation.accessValidUntil,
          establishedCompliantAt: evaluation.establishedCompliantAt,
          authoritative: true,
          invalidatedAt: null,
          evaluatedAt: now,
          updatedAt: now,
        },
      })
    await reconcileIssues(transaction, input, evaluation, previousIssues, now)
    const transitionAudit = changed
      ? await appendOrganizationAuditEvent(transaction, {
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
      : null
    const nextEntitlementScope = projectedEntitlementScope(evaluation, now)
    const previousEntitlementScope = projectedPreviousEntitlementScope(
      previous,
      nextEntitlementScope,
      now,
    )
    const revokedPermissionScope = changedPermissionScope(
      previousEntitlementScope,
      nextEntitlementScope,
    )
    if (transitionAudit && revokedPermissionScope)
      await appendExternalServiceEntitlementTransitions(transaction, {
        organizationVersion: input.organizationVersion,
        policyVersion: organization.policyVersion,
        userId: input.userId,
        granted: false,
        causationAuditId: transitionAudit.auditId,
        now,
        reason: 'Account compliance no longer grants this external-service entitlement.',
        permissionScope: revokedPermissionScope,
      })
    await convergeRegistrationComplianceGroupsInTransaction(transaction, {
      organizationVersion: input.organizationVersion,
      policyVersion: organization.policyVersion,
      userId: input.userId,
      eligible:
        evaluation.accessValidUntil !== null &&
        evaluation.accessValidUntil.getTime() > now.getTime(),
      now,
    })
    const grantedPermissionScope = changedPermissionScope(
      nextEntitlementScope,
      previousEntitlementScope,
    )
    if (transitionAudit && grantedPermissionScope)
      await appendExternalServiceEntitlementTransitions(transaction, {
        organizationVersion: input.organizationVersion,
        policyVersion: organization.policyVersion,
        userId: input.userId,
        granted: true,
        causationAuditId: transitionAudit.auditId,
        now,
        reason: 'Account compliance grants this external-service entitlement.',
        permissionScope: grantedPermissionScope,
      })
    if (changed) {
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
  }
  return outerTransaction ? recompute(outerTransaction) : db.transaction(recompute)
}

function projectedEntitlementScope(
  projection:
    | Pick<typeof organizationAccountCompliance.$inferSelect, 'state' | 'accessValidUntil'>
    | AccountComplianceEvaluation
    | null,
  now: Date,
): OrganizationEntitlementScope {
  if (!projection?.accessValidUntil || projection.accessValidUntil <= now) return 'none'
  if (projection.state === 'compliant') return 'all'
  if (projection.state === 'review_required') return 'review'
  return 'none'
}

function projectedPreviousEntitlementScope(
  previous: typeof organizationAccountCompliance.$inferSelect | null,
  next: OrganizationEntitlementScope,
  now: Date,
): OrganizationEntitlementScope {
  const projected = projectedEntitlementScope(previous, now)
  if (projected !== 'none' || !previous?.accessValidUntil) return projected
  if (previous.state === 'compliant' && next !== 'all') return 'all'
  if (previous.state === 'review_required' && next === 'none') return 'review'
  return projected
}

function changedPermissionScope(
  from: OrganizationEntitlementScope,
  to: OrganizationEntitlementScope,
): 'all' | 'review' | 'non-review' | null {
  if (from === 'all' && to === 'review') return 'non-review'
  if (from === 'all' && to === 'none') return 'all'
  if (from === 'review' && to === 'none') return 'review'
  return null
}

export async function appendExternalServiceEntitlementTransitions(
  transaction: ComplianceTransaction,
  input: {
    organizationVersion: number
    policyVersion: number
    userId: string
    granted: boolean
    causationAuditId: string
    now: Date
    reason: string
    permissionScope: 'all' | 'review' | 'non-review'
    ignoreBlock?: boolean
  },
) {
  if (!input.ignoreBlock) {
    const [block] = await transaction
      .select({ blockId: organizationMemberBlocks.blockId })
      .from(organizationMemberBlocks)
      .where(
        and(
          eq(organizationMemberBlocks.deploymentId, 1),
          eq(organizationMemberBlocks.organizationVersion, input.organizationVersion),
          eq(organizationMemberBlocks.userId, input.userId),
          isNull(organizationMemberBlocks.unblockedAt),
        ),
      )
      .limit(1)
    if (block) return
  }
  const serviceEntries = await transaction
    .selectDistinct({
      permissionKey: organizationPermissionBundleEntries.permissionKey,
      reviewAllowed: organizationPermissionBundleEntries.reviewAllowed,
    })
    .from(organizationGroupAssignments)
    .innerJoin(
      organizationGroupPermissionBundles,
      and(
        eq(organizationGroupPermissionBundles.groupId, organizationGroupAssignments.groupId),
        eq(
          organizationGroupPermissionBundles.organizationVersion,
          organizationGroupAssignments.organizationVersion,
        ),
      ),
    )
    .innerJoin(
      organizationPermissionBundleEntries,
      eq(organizationPermissionBundleEntries.bundleId, organizationGroupPermissionBundles.bundleId),
    )
    .where(
      and(
        eq(organizationGroupAssignments.deploymentId, 1),
        eq(organizationGroupAssignments.organizationVersion, input.organizationVersion),
        eq(organizationGroupAssignments.userId, input.userId),
        isNull(organizationGroupAssignments.revokedAt),
        or(
          isNull(organizationGroupAssignments.expiresAt),
          gt(organizationGroupAssignments.expiresAt, input.now),
        ),
        eq(organizationPermissionBundleEntries.permissionType, 'service'),
      ),
    )
    .orderBy(asc(organizationPermissionBundleEntries.permissionKey))
  const reviewAccessByService = new Map<string, boolean>()
  for (const { permissionKey, reviewAllowed } of serviceEntries)
    reviewAccessByService.set(
      permissionKey,
      Boolean(reviewAccessByService.get(permissionKey) || reviewAllowed),
    )
  const services = [...reviewAccessByService]
    .filter(
      ([, reviewAllowed]) =>
        input.permissionScope === 'all' ||
        (input.permissionScope === 'review' && reviewAllowed) ||
        (input.permissionScope === 'non-review' && !reviewAllowed),
    )
    .map(([permissionKey]) => permissionKey)
  await appendOrganizationAuditEvents(
    transaction,
    services.map((permissionKey) => ({
      deploymentId: 1 as const,
      organizationVersion: input.organizationVersion,
      policyVersion: input.policyVersion,
      eventType: input.granted
        ? ('entitlement.granted' as const)
        : ('entitlement.revoked' as const),
      actorType: 'system' as const,
      actorId: null,
      subjectType: 'external_service' as const,
      subjectId: permissionKey,
      reason: input.reason,
      outcome: input.granted ? ('granted' as const) : ('revoked' as const),
      causationAuditId: input.causationAuditId,
      occurredAt: input.now,
    })),
  )
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

export async function lockCurrentOrganizationVersionForCompliance(
  transaction: ComplianceTransaction,
) {
  const [organization] = await transaction
    .select({ organizationVersion: deploymentSettings.organizationVersion })
    .from(deploymentSettings)
    .where(eq(deploymentSettings.id, 1))
    .for('key share')
  return organization?.organizationVersion ?? null
}

export function recomputeCurrentOrganizationAccountCompliance(userId: string, now = new Date()) {
  return db.transaction(async (transaction) => {
    const organizationVersion = await lockCurrentOrganizationVersionForCompliance(transaction)
    if (!organizationVersion) return { outcome: 'obsolete' as const }
    return recomputeOrganizationAccountCompliance(
      { deploymentId: 1, organizationVersion, userId, now },
      transaction,
    )
  })
}

export async function recomputeAllOrganizationAccountsInTransaction(
  transaction: ComplianceTransaction,
  input: { deploymentId: 1; organizationVersion: number; now?: Date },
) {
  const accounts = await transaction.select({ userId: users.id }).from(users).orderBy(asc(users.id))
  return recomputeAccountsInTransaction(
    transaction,
    input,
    accounts.map(({ userId }) => userId),
  )
}

export async function recomputeComplianceForManagedCorporationsInTransaction(
  transaction: ComplianceTransaction,
  input: {
    deploymentId: 1
    organizationVersion: number
    corporationIds: readonly number[]
    now?: Date
  },
) {
  if (input.corporationIds.length === 0) return []
  const affectedUsers = await transaction
    .selectDistinct({ userId: characters.userId })
    .from(characters)
    .innerJoin(
      deploymentSettings,
      and(
        eq(deploymentSettings.id, input.deploymentId),
        eq(deploymentSettings.organizationVersion, input.organizationVersion),
      ),
    )
    .where(inArray(characters.corporationId, [...new Set(input.corporationIds)]))
    .orderBy(asc(characters.userId))
  return recomputeAccountsInTransaction(
    transaction,
    input,
    affectedUsers.map(({ userId }) => userId),
  )
}

async function recomputeAccountsInTransaction(
  transaction: ComplianceTransaction,
  input: { deploymentId: 1; organizationVersion: number; now?: Date },
  userIds: readonly string[],
) {
  const orderedUserIds = [...new Set(userIds)].toSorted((left, right) => left.localeCompare(right))
  if (orderedUserIds.length === 0) return []
  await transaction
    .select({ userId: users.id })
    .from(users)
    .where(inArray(users.id, orderedUserIds))
    .orderBy(asc(users.id))
    .for('update')
  const results = []
  for (const userId of orderedUserIds)
    // oxlint-disable-next-line no-await-in-loop -- Accounts are recomputed after all user locks are acquired.
    results.push(await recomputeOrganizationAccountCompliance({ ...input, userId }, transaction))
  return results
}

function projectManagedCorporationEvidence(
  state:
    | {
        validatedAt: Date | null
        nextEligibleAt: Date | null
        lastFailureClass: string | null
        failureStartedAt: Date | null
      }
    | undefined,
  now: Date,
) {
  if (!state?.validatedAt)
    return {
      freshness: 'unavailable' as const,
      evidenceAt: null,
      freshUntil: null,
      staleSince: state?.failureStartedAt ?? null,
    }
  if (
    state.lastFailureClass ||
    !state.nextEligibleAt ||
    state.nextEligibleAt.getTime() <= now.getTime()
  )
    return {
      freshness: 'stale' as const,
      evidenceAt: state.validatedAt,
      freshUntil: null,
      staleSince: state.lastFailureClass
        ? (state.failureStartedAt ?? state.validatedAt)
        : (state.nextEligibleAt ?? state.validatedAt),
    }
  return {
    freshness: 'fresh' as const,
    evidenceAt: state.validatedAt,
    freshUntil: state.nextEligibleAt,
    staleSince: null,
  }
}

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
    previous?.state !== next.state ||
    previous?.evidenceFreshness !== next.evidenceFreshness ||
    previous?.reviewDeadline?.getTime() !== next.reviewDeadline?.getTime()
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
    .toSorted((left, right) => left.localeCompare(right))
}

function toIssue(issue: typeof organizationComplianceIssues.$inferSelect): AccountComplianceIssue {
  return {
    issueKey: issue.issueKey,
    issueCode: issue.issueCode,
    characterId: issue.characterId,
    requiredScope: issue.requiredScope,
  }
}
