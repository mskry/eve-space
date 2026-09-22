import { and, eq, isNull, lte, ne, or } from 'drizzle-orm'
import { CharacterTokenNotFoundError } from '../auth/character-token-store.js'
import { EveSsoTokenRefreshError } from '../auth/sso.js'
import { ScopeRequiredError, TokenRefreshUnavailableError } from '../auth/token-errors.js'
import { getCharacterCorporationRolesEvidence } from '../characters/corporation-roles.js'
import { observeAndPersistCharacterAffiliation } from '../characters/affiliation-sync.js'
import { db } from '../db/client.js'
import {
  characters,
  deploymentSettings,
  eveTokens,
  organizationAuthorityEvidence,
  organizationRoleGrants,
  platformSubjectLifecycles,
  type OrganizationAuthorityInvalidationOutcome,
} from '../db/schema.js'
import {
  classifyEsiRefreshFailure,
  EsiQuotaError,
  getEsiFailureStatus,
} from '../esi-gateway/failures.js'
import { env } from '../env.js'
import { resolveOrganizationAuthorityCorporationEvidence } from './authority.js'
import { appendOrganizationAuditEvent } from './audit.js'
import {
  convergeObservedAffiliationInTransaction,
  invalidateCharacterAuthoritySourcesInTransaction,
} from './authority-convergence.js'
import {
  assertOrganizationOwnerDirectorRole,
  OrganizationAuthorityError,
} from './authority-policy.js'
import { hasActiveOrganizationMemberBlock } from './member-block.js'

const failedEvidenceRetryIntervalMilliseconds = 5 * 60 * 1_000
const evidenceRefreshAheadMilliseconds = 20 * 60 * 1_000

type AuthorityFailureKind = 'strict' | 'transient'

interface AuthorityFailure {
  kind: AuthorityFailureKind
  failureClass: string
}

interface SuccessfulEvidenceRefresh {
  grantId: string
  organizationVersion: number
  characterId: number
  subjectLifecycleId: string
  authorityCorporationId: number
  observedAllianceId: number | null
  sourceAuthorizationGeneration: number
  sourceRoleEvidenceRevision: string
  refreshedRoleEvidenceRevision: string
  evidenceAuthorizationGeneration: number
  evidenceFreshUntil: Date
  affiliationObservedAt: Date
  checkedAt: Date
  signal?: AbortSignal
}

export interface OrganizationOwnerEvidenceJobCandidate {
  grantId: string
  organizationVersion: number
  sourceSubjectLifecycleId: string
  authorizationGeneration: number
  roleEvidenceRevision: string
}

export async function selectDueOrganizationOwnerEvidence(
  now = new Date(),
  limit = env.QUEUE_RESOURCE_PLANNER_PAGE_SIZE,
) {
  const retryCutoff = new Date(now.getTime() - failedEvidenceRetryIntervalMilliseconds)
  const refreshBoundary = new Date(now.getTime() + evidenceRefreshAheadMilliseconds)
  return db
    .select({
      grantId: organizationAuthorityEvidence.grantId,
      organizationVersion: organizationAuthorityEvidence.organizationVersion,
      sourceSubjectLifecycleId: organizationAuthorityEvidence.sourceSubjectLifecycleId,
      authorizationGeneration: organizationAuthorityEvidence.authorizationGeneration,
      roleEvidenceRevision: organizationAuthorityEvidence.roleEvidenceRevision,
    })
    .from(organizationAuthorityEvidence)
    .innerJoin(
      organizationRoleGrants,
      eq(organizationRoleGrants.grantId, organizationAuthorityEvidence.grantId),
    )
    .innerJoin(
      deploymentSettings,
      and(
        eq(deploymentSettings.id, organizationAuthorityEvidence.deploymentId),
        eq(
          deploymentSettings.organizationVersion,
          organizationAuthorityEvidence.organizationVersion,
        ),
      ),
    )
    .innerJoin(eveTokens, eq(eveTokens.characterId, organizationAuthorityEvidence.characterId))
    .where(
      and(
        isNull(organizationRoleGrants.revokedAt),
        isNull(organizationAuthorityEvidence.invalidatedAt),
        or(
          ne(organizationAuthorityEvidence.authorizationGeneration, eveTokens.tokenVersion),
          and(
            eq(organizationAuthorityEvidence.status, 'fresh'),
            lte(organizationAuthorityEvidence.freshUntil, refreshBoundary),
          ),
          and(
            eq(organizationAuthorityEvidence.status, 'degraded'),
            or(
              lte(organizationAuthorityEvidence.lastCheckedAt, retryCutoff),
              lte(organizationAuthorityEvidence.graceUntil, now),
            ),
          ),
        ),
      ),
    )
    .orderBy(organizationAuthorityEvidence.lastCheckedAt, organizationAuthorityEvidence.grantId)
    .limit(Math.max(1, limit))
}

export async function refreshOrganizationOwnerEvidence(
  candidate: OrganizationOwnerEvidenceJobCandidate,
  options: { readonly signal?: AbortSignal } = {},
) {
  options.signal?.throwIfAborted()
  const snapshot = await loadRefreshSnapshot(candidate)
  options.signal?.throwIfAborted()
  if (!snapshot) return 'ineligible' as const

  const checkedAt = new Date()
  if (snapshot.sourceSubjectLifecycleId !== snapshot.currentSubjectLifecycleId)
    return applyEvidenceFailure(
      snapshot,
      {
        kind: 'strict',
        failureClass: 'lifecycle-replaced',
      },
      checkedAt,
      options.signal,
    )
  try {
    const affiliation = await observeAndPersistCharacterAffiliation(
      snapshot.characterId,
      options.signal,
      convergeObservedAffiliationInTransaction,
    )
    if (!affiliation || affiliation.stale) throw new OrganizationAuthorityError('stale-affiliation')
    options.signal?.throwIfAborted()
    const authorityCorporation = await resolveOrganizationAuthorityCorporationEvidence(
      {
        organizationType: snapshot.organizationType,
        organizationId: snapshot.organizationId,
      },
      affiliation,
    )
    options.signal?.throwIfAborted()
    const roles = await getCharacterCorporationRolesEvidence(
      snapshot.characterId,
      snapshot.sourceSubjectLifecycleId,
      options.signal,
    )
    options.signal?.throwIfAborted()
    if (roles.stale) throw new OrganizationAuthorityError('stale-role-evidence')
    assertOrganizationOwnerDirectorRole(roles)
    const outcome = await applySuccessfulEvidenceRefresh({
      grantId: candidate.grantId,
      organizationVersion: snapshot.organizationVersion,
      characterId: snapshot.characterId,
      subjectLifecycleId: snapshot.sourceSubjectLifecycleId,
      authorityCorporationId: authorityCorporation.corporationId,
      observedAllianceId: affiliation.allianceId,
      sourceAuthorizationGeneration: snapshot.authorizationGeneration,
      sourceRoleEvidenceRevision: snapshot.roleEvidenceRevision,
      refreshedRoleEvidenceRevision: roles.roleEvidenceRevision,
      evidenceAuthorizationGeneration: roles.authorizationGeneration,
      evidenceFreshUntil: earliestDate(
        affiliation.affiliationFreshUntil,
        roles.freshUntil,
        authorityCorporation.freshUntil,
      ),
      affiliationObservedAt: affiliation.affiliationCheckedAt,
      checkedAt,
      signal: options.signal,
    })
    options.signal?.throwIfAborted()
    return outcome
  } catch (error) {
    options.signal?.throwIfAborted()
    const failure = classifyOrganizationAuthorityFailure(error)
    if (!failure) throw error
    return applyEvidenceFailure(snapshot, failure, checkedAt, options.signal)
  }
}

export function classifyOrganizationAuthorityFailure(error: unknown): AuthorityFailure | null {
  if (error instanceof OrganizationAuthorityError) {
    return error.code === 'stale-affiliation' ||
      error.code === 'stale-role-evidence' ||
      error.code === 'executor-unavailable'
      ? { kind: 'transient', failureClass: 'affiliation-unavailable' }
      : { kind: 'strict', failureClass: error.code }
  }
  if (error instanceof ScopeRequiredError) return { kind: 'strict', failureClass: 'missing-scope' }
  if (error instanceof CharacterTokenNotFoundError)
    return { kind: 'strict', failureClass: 'authorization-missing' }
  if (error instanceof EveSsoTokenRefreshError)
    return error.authorizationRevoked
      ? { kind: 'strict', failureClass: 'authorization-revoked' }
      : { kind: 'transient', failureClass: 'sso-unavailable' }
  if (
    error instanceof EsiQuotaError ||
    error instanceof TokenRefreshUnavailableError ||
    classifyEsiRefreshFailure(error) === 'esi-unavailable'
  )
    return { kind: 'transient', failureClass: 'esi-unavailable' }
  const status = getEsiFailureStatus(error)
  if (status === 401 || status === 403)
    return { kind: 'strict', failureClass: 'authorization-rejected' }
  return null
}

async function loadRefreshSnapshot(candidate: OrganizationOwnerEvidenceJobCandidate) {
  const [snapshot] = await db
    .select({
      grantId: organizationAuthorityEvidence.grantId,
      organizationType: deploymentSettings.organizationType,
      organizationId: deploymentSettings.organizationId,
      organizationVersion: deploymentSettings.organizationVersion,
      userId: organizationAuthorityEvidence.userId,
      characterId: organizationAuthorityEvidence.characterId,
      sourceSubjectLifecycleId: organizationAuthorityEvidence.sourceSubjectLifecycleId,
      authorizationGeneration: organizationAuthorityEvidence.authorizationGeneration,
      currentSubjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
      currentAuthorizationGeneration: eveTokens.tokenVersion,
      roleEvidenceRevision: organizationAuthorityEvidence.roleEvidenceRevision,
    })
    .from(organizationAuthorityEvidence)
    .innerJoin(
      organizationRoleGrants,
      eq(organizationRoleGrants.grantId, organizationAuthorityEvidence.grantId),
    )
    .innerJoin(
      deploymentSettings,
      and(
        eq(deploymentSettings.id, organizationAuthorityEvidence.deploymentId),
        eq(
          deploymentSettings.organizationVersion,
          organizationAuthorityEvidence.organizationVersion,
        ),
      ),
    )
    .innerJoin(
      platformSubjectLifecycles,
      eq(platformSubjectLifecycles.characterId, organizationAuthorityEvidence.characterId),
    )
    .innerJoin(eveTokens, eq(eveTokens.characterId, organizationAuthorityEvidence.characterId))
    .where(
      and(
        eq(organizationAuthorityEvidence.grantId, candidate.grantId),
        eq(organizationAuthorityEvidence.organizationVersion, candidate.organizationVersion),
        eq(
          organizationAuthorityEvidence.sourceSubjectLifecycleId,
          candidate.sourceSubjectLifecycleId,
        ),
        eq(
          organizationAuthorityEvidence.authorizationGeneration,
          candidate.authorizationGeneration,
        ),
        eq(organizationAuthorityEvidence.roleEvidenceRevision, candidate.roleEvidenceRevision),
        eq(eveTokens.tokenVersion, candidate.authorizationGeneration),
        isNull(organizationAuthorityEvidence.invalidatedAt),
        isNull(organizationRoleGrants.revokedAt),
      ),
    )
  if (!snapshot) return null
  if (await hasActiveOrganizationMemberBlock(db, snapshot.organizationVersion, snapshot.userId))
    return null
  return snapshot
}

async function applySuccessfulEvidenceRefresh(input: SuccessfulEvidenceRefresh) {
  input.signal?.throwIfAborted()
  return db.transaction(async (transaction) => {
    const [organization] = await transaction
      .select({
        organizationVersion: deploymentSettings.organizationVersion,
        policyVersion: deploymentSettings.registrationPolicyVersion,
        freshDurationSeconds: deploymentSettings.authorityEvidenceFreshDurationSeconds,
      })
      .from(deploymentSettings)
      .where(eq(deploymentSettings.id, 1))
      .for('update')
    input.signal?.throwIfAborted()
    if (organization?.organizationVersion !== input.organizationVersion)
      return 'superseded' as const

    const [current] = await transaction
      .select({
        userId: organizationAuthorityEvidence.userId,
        corporationId: characters.corporationId,
        allianceId: characters.allianceId,
        affiliationCheckedAt: characters.affiliationCheckedAt,
        subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
        authorizationGeneration: eveTokens.tokenVersion,
        scopes: eveTokens.scopes,
        requiredScope: organizationAuthorityEvidence.requiredScope,
        evidenceAuthorizationGeneration: organizationAuthorityEvidence.authorizationGeneration,
        roleEvidenceRevision: organizationAuthorityEvidence.roleEvidenceRevision,
        invalidatedAt: organizationAuthorityEvidence.invalidatedAt,
      })
      .from(organizationAuthorityEvidence)
      .innerJoin(
        organizationRoleGrants,
        eq(organizationRoleGrants.grantId, organizationAuthorityEvidence.grantId),
      )
      .innerJoin(characters, eq(characters.characterId, organizationAuthorityEvidence.characterId))
      .innerJoin(
        platformSubjectLifecycles,
        eq(platformSubjectLifecycles.characterId, characters.characterId),
      )
      .innerJoin(eveTokens, eq(eveTokens.characterId, characters.characterId))
      .where(
        and(
          eq(organizationAuthorityEvidence.grantId, input.grantId),
          eq(organizationAuthorityEvidence.characterId, input.characterId),
          eq(platformSubjectLifecycles.subjectLifecycleId, input.subjectLifecycleId),
          isNull(organizationRoleGrants.revokedAt),
        ),
      )
      .for('update')
    input.signal?.throwIfAborted()
    if (!current) return 'superseded' as const
    const blocked = await hasActiveOrganizationMemberBlock(
      transaction,
      input.organizationVersion,
      current.userId,
    )
    input.signal?.throwIfAborted()
    if (
      current.corporationId !== input.authorityCorporationId ||
      current.invalidatedAt !== null ||
      blocked ||
      current.allianceId !== input.observedAllianceId ||
      !current.affiliationCheckedAt ||
      current.affiliationCheckedAt < input.affiliationObservedAt ||
      current.authorizationGeneration !== input.evidenceAuthorizationGeneration ||
      current.evidenceAuthorizationGeneration !== input.sourceAuthorizationGeneration ||
      current.roleEvidenceRevision !== input.sourceRoleEvidenceRevision ||
      !current.scopes.includes(current.requiredScope)
    )
      return 'superseded' as const

    const freshUntil = earliestDate(
      input.evidenceFreshUntil,
      new Date(input.checkedAt.getTime() + organization.freshDurationSeconds * 1_000),
    )
    if (freshUntil <= input.checkedAt) return 'superseded' as const

    const [updated] = await transaction
      .update(organizationAuthorityEvidence)
      .set({
        authorityCorporationId: input.authorityCorporationId,
        observedCorporationId: input.authorityCorporationId,
        observedAllianceId: input.observedAllianceId,
        directorRolePresent: true,
        status: 'fresh',
        authorizationGeneration: current.authorizationGeneration,
        roleEvidenceRevision: input.refreshedRoleEvidenceRevision,
        observedAt: input.checkedAt,
        freshUntil,
        graceUntil: null,
        lastCheckedAt: input.checkedAt,
        failureClass: null,
        invalidatedAt: null,
        invalidationOutcome: null,
        updatedAt: input.checkedAt,
      })
      .where(
        and(
          eq(organizationAuthorityEvidence.grantId, input.grantId),
          eq(
            organizationAuthorityEvidence.authorizationGeneration,
            input.sourceAuthorizationGeneration,
          ),
          eq(organizationAuthorityEvidence.roleEvidenceRevision, input.sourceRoleEvidenceRevision),
          isNull(organizationAuthorityEvidence.invalidatedAt),
        ),
      )
      .returning({ evidenceId: organizationAuthorityEvidence.evidenceId })
    input.signal?.throwIfAborted()
    if (!updated) return 'superseded' as const
    await appendOrganizationAuditEvent(transaction, {
      deploymentId: 1,
      organizationVersion: input.organizationVersion,
      policyVersion: organization.policyVersion,
      eventType: 'authority-source.observed',
      actorType: 'system',
      actorId: null,
      subjectType: 'authority_source',
      subjectId: updated.evidenceId,
      reason: 'Fresh organization-owner authority evidence was observed.',
      outcome: 'unchanged',
      occurredAt: input.checkedAt,
    })
    return 'fresh' as const
  })
}

async function applyEvidenceFailure(
  snapshot: NonNullable<Awaited<ReturnType<typeof loadRefreshSnapshot>>>,
  failure: AuthorityFailure,
  checkedAt: Date,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  return db.transaction(async (transaction) => {
    const [organization] = await transaction
      .select({
        organizationVersion: deploymentSettings.organizationVersion,
        staleSeconds: deploymentSettings.staleEvidenceGraceDurationSeconds,
      })
      .from(deploymentSettings)
      .where(eq(deploymentSettings.id, 1))
      .for('update')
    signal?.throwIfAborted()
    if (organization?.organizationVersion !== snapshot.organizationVersion)
      return 'superseded' as const

    const [current] = await transaction
      .select({
        userId: organizationAuthorityEvidence.userId,
        revokedAt: organizationRoleGrants.revokedAt,
        status: organizationAuthorityEvidence.status,
        freshUntil: organizationAuthorityEvidence.freshUntil,
        graceUntil: organizationAuthorityEvidence.graceUntil,
        failureClass: organizationAuthorityEvidence.failureClass,
        directorRolePresent: organizationAuthorityEvidence.directorRolePresent,
        authorizationGeneration: organizationAuthorityEvidence.authorizationGeneration,
        roleEvidenceRevision: organizationAuthorityEvidence.roleEvidenceRevision,
        invalidatedAt: organizationAuthorityEvidence.invalidatedAt,
      })
      .from(organizationAuthorityEvidence)
      .innerJoin(
        organizationRoleGrants,
        eq(organizationRoleGrants.grantId, organizationAuthorityEvidence.grantId),
      )
      .where(eq(organizationAuthorityEvidence.grantId, snapshot.grantId))
      .for('update')
    signal?.throwIfAborted()
    const blocked = current
      ? await hasActiveOrganizationMemberBlock(
          transaction,
          snapshot.organizationVersion,
          current.userId,
        )
      : false
    signal?.throwIfAborted()
    if (
      !current ||
      current.revokedAt ||
      current.invalidatedAt ||
      blocked ||
      current.authorizationGeneration !== snapshot.authorizationGeneration ||
      current.roleEvidenceRevision !== snapshot.roleEvidenceRevision
    )
      return 'superseded' as const

    const failureClass = `${failure.kind}:${failure.failureClass}`
    const directorRolePresent =
      failure.failureClass === 'not-director' ? false : current.directorRolePresent

    if (failure.kind === 'strict') {
      await invalidateCharacterAuthoritySourcesInTransaction(transaction, {
        characterId: snapshot.characterId,
        outcome: authorityInvalidationOutcome(failure),
        now: checkedAt,
        expected: {
          organizationVersion: snapshot.organizationVersion,
          sourceSubjectLifecycleId: snapshot.sourceSubjectLifecycleId,
          authorizationGeneration: snapshot.authorizationGeneration,
        },
      })
      signal?.throwIfAborted()
      return 'revoked' as const
    }

    const graceBoundary = new Date(current.freshUntil.getTime() + organization.staleSeconds * 1_000)
    const graceUntil = current.graceUntil
      ? new Date(Math.min(current.graceUntil.getTime(), graceBoundary.getTime()))
      : graceBoundary
    if (failure.kind === 'transient' && checkedAt < current.freshUntil) {
      await transaction
        .update(organizationAuthorityEvidence)
        .set({ lastCheckedAt: checkedAt, updatedAt: checkedAt })
        .where(eq(organizationAuthorityEvidence.grantId, snapshot.grantId))
      signal?.throwIfAborted()
      return 'fresh' as const
    }

    if (graceUntil <= checkedAt) {
      await invalidateCharacterAuthoritySourcesInTransaction(transaction, {
        characterId: snapshot.characterId,
        outcome: 'expired',
        now: checkedAt,
        expected: {
          organizationVersion: snapshot.organizationVersion,
          sourceSubjectLifecycleId: snapshot.sourceSubjectLifecycleId,
          authorizationGeneration: snapshot.authorizationGeneration,
        },
      })
      signal?.throwIfAborted()
      return 'revoked' as const
    }

    await transaction
      .update(organizationAuthorityEvidence)
      .set({
        status: 'degraded',
        directorRolePresent,
        lastCheckedAt: checkedAt,
        graceUntil,
        failureClass,
        updatedAt: checkedAt,
      })
      .where(eq(organizationAuthorityEvidence.grantId, snapshot.grantId))
    signal?.throwIfAborted()
    return 'degraded' as const
  })
}

function authorityInvalidationOutcome(
  failure: AuthorityFailure,
): OrganizationAuthorityInvalidationOutcome {
  if (failure.kind === 'transient') return 'expired'
  switch (failure.failureClass) {
    case 'affiliation-changed':
    case 'authorization-generation-changed':
    case 'authorization-missing':
    case 'authorization-rejected':
    case 'authorization-revoked':
    case 'lifecycle-replaced':
    case 'missing-scope':
    case 'not-director':
    case 'wrong-alliance':
    case 'wrong-corporation':
      return failure.failureClass
    default:
      return 'authorization-rejected'
  }
}

function earliestDate(first: Date, ...dates: readonly (Date | null)[]) {
  return new Date(
    Math.min(
      first.getTime(),
      ...dates.filter((date): date is Date => date !== null).map((date) => date.getTime()),
    ),
  )
}
