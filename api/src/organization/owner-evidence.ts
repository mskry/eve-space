import { and, eq, isNull, lte, or } from 'drizzle-orm'
import { CharacterTokenNotFoundError } from '../auth/character-token-store.js'
import { EveSsoTokenRefreshError } from '../auth/sso.js'
import { ScopeRequiredError, TokenRefreshUnavailableError } from '../auth/token-errors.js'
import { getCharacterCorporationRoles } from '../characters/corporation-roles.js'
import { observeAndPersistCharacterAffiliation } from '../characters/affiliation-sync.js'
import { db } from '../db/client.js'
import {
  characters,
  deploymentSettings,
  organizationAuthorityEvidence,
  organizationRoleGrants,
  platformSubjectLifecycles,
} from '../db/schema.js'
import {
  classifyEsiRefreshFailure,
  EsiQuotaError,
  getEsiFailureStatus,
} from '../esi-gateway/failures.js'
import { env } from '../env.js'
import { resolveOrganizationAuthorityCorporation } from './authority.js'
import { appendOrganizationAuditEvent } from './audit.js'
import {
  assertOrganizationOwnerDirectorRole,
  OrganizationAuthorityError,
} from './authority-policy.js'

const evidenceRefreshIntervalMilliseconds = 60 * 60 * 1_000
const failedEvidenceRetryIntervalMilliseconds = 5 * 60 * 1_000

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
  observedAt: Date
  checkedAt: Date
  signal?: AbortSignal
}

export async function selectDueOrganizationOwnerEvidence(
  now = new Date(),
  limit = env.QUEUE_RESOURCE_PLANNER_PAGE_SIZE,
) {
  const freshCutoff = new Date(now.getTime() - evidenceRefreshIntervalMilliseconds)
  const retryCutoff = new Date(now.getTime() - failedEvidenceRetryIntervalMilliseconds)
  return db
    .select({ grantId: organizationAuthorityEvidence.grantId })
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
    .where(
      and(
        isNull(organizationRoleGrants.revokedAt),
        or(
          and(
            eq(organizationAuthorityEvidence.status, 'fresh'),
            lte(organizationAuthorityEvidence.lastCheckedAt, freshCutoff),
          ),
          and(
            eq(organizationAuthorityEvidence.status, 'review_required'),
            or(
              lte(organizationAuthorityEvidence.lastCheckedAt, retryCutoff),
              lte(organizationAuthorityEvidence.reviewDeadline, now),
            ),
          ),
        ),
      ),
    )
    .orderBy(organizationAuthorityEvidence.lastCheckedAt, organizationAuthorityEvidence.grantId)
    .limit(Math.max(1, limit))
}

export async function refreshOrganizationOwnerEvidence(
  grantId: string,
  options: { readonly signal?: AbortSignal } = {},
) {
  options.signal?.throwIfAborted()
  const snapshot = await loadRefreshSnapshot(grantId)
  options.signal?.throwIfAborted()
  if (!snapshot) return 'ineligible' as const

  const checkedAt = new Date()
  try {
    const affiliation = await observeAndPersistCharacterAffiliation(
      snapshot.characterId,
      options.signal,
    )
    if (!affiliation || affiliation.stale) throw new OrganizationAuthorityError('stale-affiliation')
    options.signal?.throwIfAborted()
    const authorityCorporationId = await resolveOrganizationAuthorityCorporation(
      {
        organizationType: snapshot.organizationType,
        organizationId: snapshot.organizationId,
      },
      affiliation,
    )
    options.signal?.throwIfAborted()
    const roles = await getCharacterCorporationRoles(
      snapshot.characterId,
      snapshot.subjectLifecycleId,
      options.signal,
    )
    options.signal?.throwIfAborted()
    assertOrganizationOwnerDirectorRole(roles)
    const outcome = await applySuccessfulEvidenceRefresh({
      grantId,
      organizationVersion: snapshot.organizationVersion,
      characterId: snapshot.characterId,
      subjectLifecycleId: snapshot.subjectLifecycleId,
      authorityCorporationId,
      observedAllianceId: affiliation.allianceId,
      observedAt: affiliation.affiliationCheckedAt,
      checkedAt,
      signal: options.signal,
    })
    options.signal?.throwIfAborted()
    if (outcome !== 'superseded') return outcome
    return applyEvidenceFailure(
      grantId,
      snapshot.organizationVersion,
      { kind: 'strict', failureClass: 'affiliation-changed' },
      checkedAt,
      options.signal,
    )
  } catch (error) {
    options.signal?.throwIfAborted()
    const failure = classifyOrganizationAuthorityFailure(error)
    if (!failure) throw error
    return applyEvidenceFailure(
      grantId,
      snapshot.organizationVersion,
      failure,
      checkedAt,
      options.signal,
    )
  }
}

export function classifyOrganizationAuthorityFailure(error: unknown): AuthorityFailure | null {
  if (error instanceof OrganizationAuthorityError) {
    return error.code === 'stale-affiliation' || error.code === 'executor-unavailable'
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

async function loadRefreshSnapshot(grantId: string) {
  const [snapshot] = await db
    .select({
      organizationType: deploymentSettings.organizationType,
      organizationId: deploymentSettings.organizationId,
      organizationVersion: deploymentSettings.organizationVersion,
      characterId: organizationAuthorityEvidence.characterId,
      subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
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
    .where(
      and(
        eq(organizationAuthorityEvidence.grantId, grantId),
        isNull(organizationRoleGrants.revokedAt),
      ),
    )
  return snapshot ?? null
}

async function applySuccessfulEvidenceRefresh(input: SuccessfulEvidenceRefresh) {
  input.signal?.throwIfAborted()
  return db.transaction(async (transaction) => {
    const [organization] = await transaction
      .select({ organizationVersion: deploymentSettings.organizationVersion })
      .from(deploymentSettings)
      .where(eq(deploymentSettings.id, 1))
      .for('update')
    input.signal?.throwIfAborted()
    if (organization?.organizationVersion !== input.organizationVersion)
      return 'superseded' as const

    const [current] = await transaction
      .select({
        corporationId: characters.corporationId,
        allianceId: characters.allianceId,
        affiliationCheckedAt: characters.affiliationCheckedAt,
        subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
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
    if (
      current?.corporationId !== input.authorityCorporationId ||
      current.allianceId !== input.observedAllianceId ||
      !current.affiliationCheckedAt ||
      current.affiliationCheckedAt < input.observedAt
    )
      return 'superseded' as const

    await transaction
      .update(organizationAuthorityEvidence)
      .set({
        authorityCorporationId: input.authorityCorporationId,
        observedCorporationId: input.authorityCorporationId,
        observedAllianceId: input.observedAllianceId,
        directorRolePresent: true,
        status: 'fresh',
        verifiedAt: input.checkedAt,
        lastCheckedAt: input.checkedAt,
        reviewDeadline: null,
        failureClass: null,
        updatedAt: input.checkedAt,
      })
      .where(eq(organizationAuthorityEvidence.grantId, input.grantId))
    input.signal?.throwIfAborted()
    return 'fresh' as const
  })
}

async function applyEvidenceFailure(
  grantId: string,
  organizationVersion: number,
  failure: AuthorityFailure,
  checkedAt: Date,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  return db.transaction(async (transaction) => {
    const [organization] = await transaction
      .select({
        organizationVersion: deploymentSettings.organizationVersion,
        policyVersion: deploymentSettings.registrationPolicyVersion,
        strictSeconds: deploymentSettings.strictRemediationDurationSeconds,
        staleSeconds: deploymentSettings.staleEvidenceGraceDurationSeconds,
      })
      .from(deploymentSettings)
      .where(eq(deploymentSettings.id, 1))
      .for('update')
    signal?.throwIfAborted()
    if (organization?.organizationVersion !== organizationVersion) return 'superseded' as const

    const [current] = await transaction
      .select({
        revokedAt: organizationRoleGrants.revokedAt,
        status: organizationAuthorityEvidence.status,
        verifiedAt: organizationAuthorityEvidence.verifiedAt,
        reviewDeadline: organizationAuthorityEvidence.reviewDeadline,
        failureClass: organizationAuthorityEvidence.failureClass,
        directorRolePresent: organizationAuthorityEvidence.directorRolePresent,
      })
      .from(organizationAuthorityEvidence)
      .innerJoin(
        organizationRoleGrants,
        eq(organizationRoleGrants.grantId, organizationAuthorityEvidence.grantId),
      )
      .where(eq(organizationAuthorityEvidence.grantId, grantId))
      .for('update')
    signal?.throwIfAborted()
    if (!current || current.revokedAt) return 'superseded' as const

    const newDeadline = new Date(
      checkedAt.getTime() +
        (failure.kind === 'strict' ? organization.strictSeconds : organization.staleSeconds) *
          1_000,
    )
    const deadline =
      current.status === 'review_required' && current.reviewDeadline?.getTime()
        ? new Date(Math.min(current.reviewDeadline.getTime(), newDeadline.getTime()))
        : newDeadline
    const failureClass = `${failure.kind}:${failure.failureClass}`
    const directorRolePresent =
      failure.failureClass === 'not-director' ? false : current.directorRolePresent

    if (deadline <= checkedAt) {
      await transaction
        .update(organizationRoleGrants)
        .set({
          revokedAt: checkedAt,
          revokedByUserId: null,
          revocationReason: 'Organization-owner authority could not be verified.',
          updatedAt: checkedAt,
        })
        .where(eq(organizationRoleGrants.grantId, grantId))
      signal?.throwIfAborted()
      await transaction
        .update(organizationAuthorityEvidence)
        .set({
          status: 'invalid',
          directorRolePresent,
          lastCheckedAt: checkedAt,
          reviewDeadline: null,
          failureClass,
          updatedAt: checkedAt,
        })
        .where(eq(organizationAuthorityEvidence.grantId, grantId))
      signal?.throwIfAborted()
      await appendOrganizationAuditEvent(transaction, {
        deploymentId: 1,
        organizationVersion,
        policyVersion: organization.policyVersion,
        eventType: 'role.revoked',
        actorType: 'system',
        actorId: null,
        subjectType: 'role_grant',
        subjectId: grantId,
        reason: 'Organization-owner authority could not be verified before its deadline.',
        outcome: 'revoked',
        occurredAt: checkedAt,
      })
      signal?.throwIfAborted()
      return 'revoked' as const
    }

    await transaction
      .update(organizationAuthorityEvidence)
      .set({
        status: 'review_required',
        directorRolePresent,
        lastCheckedAt: checkedAt,
        reviewDeadline: deadline,
        failureClass,
        updatedAt: checkedAt,
      })
      .where(eq(organizationAuthorityEvidence.grantId, grantId))
    signal?.throwIfAborted()
    return 'review-required' as const
  })
}
