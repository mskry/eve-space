import { and, eq, isNull, lte, ne, notExists, or, sql } from 'drizzle-orm'
import {
  characterCorporationRolesScope,
  getCharacterCorporationRolesEvidence,
} from '../characters/corporation-roles.js'
import { observeAndPersistCharacterAffiliation } from '../characters/affiliation-sync.js'
import { db, type DatabaseTransaction } from '../db/client.js'
import {
  characters,
  deploymentSettings,
  eveTokens,
  organizationDerivedAuthoritySources,
  organizationMemberBlocks,
  platformSubjectLifecycles,
  type OrganizationAuthorityInvalidationOutcome,
} from '../db/schema.js'
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
import { classifyOrganizationAuthorityFailure } from './owner-evidence.js'
import { hasActiveOrganizationMemberBlock } from './member-block.js'

const failedEvidenceRetryIntervalMilliseconds = 5 * 60 * 1000
const evidenceRefreshAheadMilliseconds = 20 * 60 * 1000

export interface DerivedAuthorityJobCandidate {
  readonly organizationVersion: number
  readonly userId: string
  readonly characterId: number
  readonly subjectLifecycleId: string
  readonly authorizationGeneration: number
  readonly sourceId: string | null
  readonly roleEvidenceRevision: string | null
}

interface DerivedAuthoritySnapshot extends DerivedAuthorityJobCandidate {
  organizationType: 'corporation' | 'alliance'
  organizationId: number
  scopes: string[]
}

type DerivedAuthorityProjectionValues = Pick<
  typeof organizationDerivedAuthoritySources.$inferInsert,
  | 'authorityCorporationId'
  | 'observedCorporationId'
  | 'observedAllianceId'
  | 'authorizationGeneration'
  | 'requiredScope'
  | 'roleEvidenceRevision'
  | 'directorRolePresent'
  | 'observedAt'
  | 'freshUntil'
  | 'graceUntil'
  | 'status'
  | 'failureClass'
  | 'invalidatedAt'
  | 'invalidationOutcome'
  | 'updatedAt'
>

export async function selectDueDerivedDirectorCharacters(
  now = new Date(),
  limit = env.QUEUE_RESOURCE_PLANNER_PAGE_SIZE,
) {
  const retryCutoff = new Date(now.getTime() - failedEvidenceRetryIntervalMilliseconds)
  const refreshBoundary = new Date(now.getTime() + evidenceRefreshAheadMilliseconds)
  return db
    .select({
      authorizationGeneration: eveTokens.tokenVersion,
      characterId: characters.characterId,
      organizationVersion: deploymentSettings.organizationVersion,
      roleEvidenceRevision: organizationDerivedAuthoritySources.roleEvidenceRevision,
      sourceId: organizationDerivedAuthoritySources.sourceId,
      subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
      userId: characters.userId,
    })
    .from(characters)
    .innerJoin(eveTokens, eq(eveTokens.characterId, characters.characterId))
    .innerJoin(
      platformSubjectLifecycles,
      eq(platformSubjectLifecycles.characterId, characters.characterId),
    )
    .innerJoin(deploymentSettings, eq(deploymentSettings.id, 1))
    .leftJoin(
      organizationDerivedAuthoritySources,
      and(
        eq(organizationDerivedAuthoritySources.deploymentId, deploymentSettings.id),
        eq(
          organizationDerivedAuthoritySources.organizationVersion,
          deploymentSettings.organizationVersion,
        ),
        eq(organizationDerivedAuthoritySources.userId, characters.userId),
        eq(organizationDerivedAuthoritySources.characterId, characters.characterId),
        eq(
          organizationDerivedAuthoritySources.sourceSubjectLifecycleId,
          platformSubjectLifecycles.subjectLifecycleId,
        ),
        isNull(organizationDerivedAuthoritySources.invalidatedAt),
      ),
    )
    .where(
      and(
        eq(deploymentSettings.derivedDirectorAuthorityEnabled, true),
        notExists(
          db
            .select({ one: sql`1` })
            .from(organizationMemberBlocks)
            .where(
              and(
                eq(organizationMemberBlocks.deploymentId, 1),
                eq(
                  organizationMemberBlocks.organizationVersion,
                  deploymentSettings.organizationVersion,
                ),
                eq(organizationMemberBlocks.userId, characters.userId),
                isNull(organizationMemberBlocks.unblockedAt),
              ),
            ),
        ),
        or(
          and(
            isNull(organizationDerivedAuthoritySources.sourceId),
            sql`${eveTokens.scopes} @> ${JSON.stringify([characterCorporationRolesScope])}::jsonb`,
          ),
          and(
            isNull(organizationDerivedAuthoritySources.invalidatedAt),
            or(
              and(
                eq(organizationDerivedAuthoritySources.status, 'fresh'),
                lte(organizationDerivedAuthoritySources.freshUntil, refreshBoundary),
              ),
              ne(
                organizationDerivedAuthoritySources.authorizationGeneration,
                eveTokens.tokenVersion,
              ),
              sql`not (${eveTokens.scopes} @> jsonb_build_array(${organizationDerivedAuthoritySources.requiredScope}))`,
              and(
                eq(organizationDerivedAuthoritySources.status, 'degraded'),
                lte(organizationDerivedAuthoritySources.updatedAt, retryCutoff),
              ),
            ),
          ),
        ),
      ),
    )
    .orderBy(characters.characterId)
    .limit(Math.max(1, limit))
}

export async function refreshDerivedDirectorAuthority(
  candidate: DerivedAuthorityJobCandidate,
  options: { readonly signal?: AbortSignal } = {},
) {
  options.signal?.throwIfAborted()
  const snapshot = await loadSnapshot(candidate)
  if (!snapshot) {
    return 'superseded' as const
  }

  const checkedAt = new Date()
  if (!snapshot.scopes.includes(characterCorporationRolesScope)) {
    return persistProjectionFailure(
      snapshot,
      { failureClass: 'missing-scope', kind: 'strict' },
      checkedAt,
      options.signal,
    )
  }
  try {
    const affiliation = await observeAndPersistCharacterAffiliation(
      snapshot.characterId,
      options.signal,
      convergeObservedAffiliationInTransaction,
    )
    if (!affiliation || affiliation.stale) {
      throw new OrganizationAuthorityError('stale-affiliation')
    }
    const authorityCorporation = await resolveOrganizationAuthorityCorporationEvidence(
      snapshot,
      affiliation,
    )
    const roles = await getCharacterCorporationRolesEvidence(
      candidate.characterId,
      snapshot.subjectLifecycleId,
      options.signal,
    )
    if (roles.stale) {
      throw new OrganizationAuthorityError('stale-role-evidence')
    }
    assertOrganizationOwnerDirectorRole(roles)
    return persistSuccessfulProjection(snapshot, {
      affiliationObservedAt: affiliation.affiliationCheckedAt,
      authorityCorporationId: authorityCorporation.corporationId,
      checkedAt,
      evidenceAuthorizationGeneration: roles.authorizationGeneration,
      evidenceFreshUntil: earliestDate(
        affiliation.affiliationFreshUntil,
        roles.freshUntil,
        authorityCorporation.freshUntil,
      ),
      observedAllianceId: affiliation.allianceId,
      observedCorporationId: affiliation.corporationId,
      roleEvidenceRevision: roles.roleEvidenceRevision,
      signal: options.signal,
    })
  } catch (error) {
    options.signal?.throwIfAborted()
    const failure = classifyOrganizationAuthorityFailure(error)
    if (!failure) {
      throw error
    }
    return persistProjectionFailure(snapshot, failure, checkedAt, options.signal)
  }
}

async function loadSnapshot(
  candidate: DerivedAuthorityJobCandidate,
): Promise<DerivedAuthoritySnapshot | null> {
  if ((candidate.sourceId === null) !== (candidate.roleEvidenceRevision === null)) {
    return null
  }
  const sourcePredicate =
    candidate.sourceId === null || candidate.roleEvidenceRevision === null
      ? isNull(organizationDerivedAuthoritySources.sourceId)
      : and(
          eq(organizationDerivedAuthoritySources.sourceId, candidate.sourceId),
          eq(
            organizationDerivedAuthoritySources.roleEvidenceRevision,
            candidate.roleEvidenceRevision,
          ),
        )
  const [snapshot] = await db
    .select({
      authorizationGeneration: eveTokens.tokenVersion,
      characterId: characters.characterId,
      organizationId: deploymentSettings.organizationId,
      organizationType: deploymentSettings.organizationType,
      organizationVersion: deploymentSettings.organizationVersion,
      roleEvidenceRevision: organizationDerivedAuthoritySources.roleEvidenceRevision,
      scopes: eveTokens.scopes,
      sourceId: organizationDerivedAuthoritySources.sourceId,
      subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
      userId: characters.userId,
    })
    .from(characters)
    .innerJoin(eveTokens, eq(eveTokens.characterId, characters.characterId))
    .innerJoin(
      platformSubjectLifecycles,
      eq(platformSubjectLifecycles.characterId, characters.characterId),
    )
    .innerJoin(deploymentSettings, eq(deploymentSettings.id, 1))
    .leftJoin(
      organizationDerivedAuthoritySources,
      and(
        eq(organizationDerivedAuthoritySources.deploymentId, 1),
        eq(
          organizationDerivedAuthoritySources.organizationVersion,
          deploymentSettings.organizationVersion,
        ),
        eq(organizationDerivedAuthoritySources.userId, characters.userId),
        eq(organizationDerivedAuthoritySources.characterId, characters.characterId),
        eq(
          organizationDerivedAuthoritySources.sourceSubjectLifecycleId,
          platformSubjectLifecycles.subjectLifecycleId,
        ),
        isNull(organizationDerivedAuthoritySources.invalidatedAt),
      ),
    )
    .where(
      and(
        eq(characters.characterId, candidate.characterId),
        eq(characters.userId, candidate.userId),
        eq(platformSubjectLifecycles.subjectLifecycleId, candidate.subjectLifecycleId),
        eq(eveTokens.tokenVersion, candidate.authorizationGeneration),
        eq(deploymentSettings.organizationVersion, candidate.organizationVersion),
        eq(deploymentSettings.derivedDirectorAuthorityEnabled, true),
        sourcePredicate,
      ),
    )
  return snapshot ?? null
}

async function persistSuccessfulProjection(
  snapshot: DerivedAuthoritySnapshot,
  evidence: {
    authorityCorporationId: number
    observedCorporationId: number
    observedAllianceId: number | null
    roleEvidenceRevision: string
    evidenceAuthorizationGeneration: number
    evidenceFreshUntil: Date
    affiliationObservedAt: Date
    checkedAt: Date
    signal?: AbortSignal
  },
) {
  evidence.signal?.throwIfAborted()
  return db.transaction(async (transaction) => {
    const current = await lockCurrentSnapshot(transaction, snapshot)
    evidence.signal?.throwIfAborted()
    if (!current || current.blocked) {
      return 'superseded' as const
    }
    if (!projectionMatchesEvidence(current, evidence)) {
      return 'superseded' as const
    }
    if (current.authorizationGeneration !== evidence.evidenceAuthorizationGeneration) {
      return 'superseded' as const
    }

    await invalidateReplacedLifecycles(transaction, snapshot, evidence.checkedAt)
    evidence.signal?.throwIfAborted()
    const freshUntil = earliestDate(
      evidence.evidenceFreshUntil,
      new Date(evidence.checkedAt.getTime() + current.freshDurationSeconds * 1000),
    )
    if (freshUntil <= evidence.checkedAt) {
      return 'superseded' as const
    }
    const [existing] = await transaction
      .select({
        invalidatedAt: organizationDerivedAuthoritySources.invalidatedAt,
        roleEvidenceRevision: organizationDerivedAuthoritySources.roleEvidenceRevision,
        sourceId: organizationDerivedAuthoritySources.sourceId,
      })
      .from(organizationDerivedAuthoritySources)
      .where(
        and(
          eq(organizationDerivedAuthoritySources.deploymentId, 1),
          eq(organizationDerivedAuthoritySources.organizationVersion, snapshot.organizationVersion),
          eq(organizationDerivedAuthoritySources.userId, snapshot.userId),
          eq(
            organizationDerivedAuthoritySources.sourceSubjectLifecycleId,
            snapshot.subjectLifecycleId,
          ),
          isNull(organizationDerivedAuthoritySources.invalidatedAt),
        ),
      )
      .for('update')
    evidence.signal?.throwIfAborted()
    if (derivedSourceChanged(existing, snapshot)) {
      return 'superseded' as const
    }

    const values = {
      authorityCorporationId: evidence.authorityCorporationId,
      authorizationGeneration: current.authorizationGeneration,
      directorRolePresent: true,
      failureClass: null,
      freshUntil,
      graceUntil: null,
      invalidatedAt: null,
      invalidationOutcome: null,
      observedAllianceId: evidence.observedAllianceId,
      observedAt: evidence.checkedAt,
      observedCorporationId: evidence.observedCorporationId,
      requiredScope: characterCorporationRolesScope,
      roleEvidenceRevision: evidence.roleEvidenceRevision,
      status: 'fresh' as const,
      updatedAt: evidence.checkedAt,
    }
    let source
    if (existing?.roleEvidenceRevision === evidence.roleEvidenceRevision) {
      source = await updateSource(transaction, existing.sourceId, values)
    } else {
      if (existing) {
        await invalidateSourceRevision(transaction, existing.sourceId, evidence.checkedAt)
      }
      source = await insertSource(transaction, snapshot, values, evidence.checkedAt)
    }
    evidence.signal?.throwIfAborted()
    if (!source) {
      return 'superseded' as const
    }
    await appendOrganizationAuditEvent(transaction, {
      actorId: null,
      actorType: 'system',
      deploymentId: 1,
      eventType: 'authority-source.observed',
      occurredAt: evidence.checkedAt,
      organizationVersion: snapshot.organizationVersion,
      outcome: existing ? 'unchanged' : 'granted',
      policyVersion: current.policyVersion,
      reason: 'Fresh EVE Director authority evidence was observed.',
      subjectId: source.sourceId,
      subjectType: 'authority_source',
    })
    evidence.signal?.throwIfAborted()
    return 'fresh' as const
  })
}

function projectionMatchesEvidence(
  current: NonNullable<Awaited<ReturnType<typeof lockCurrentSnapshot>>>,
  evidence: Parameters<typeof persistSuccessfulProjection>[1],
) {
  return (
    current.corporationId === evidence.observedCorporationId &&
    current.allianceId === evidence.observedAllianceId &&
    current.affiliationCheckedAt !== null &&
    current.affiliationCheckedAt >= evidence.affiliationObservedAt
  )
}

function derivedSourceChanged(
  existing:
    | Pick<
        typeof organizationDerivedAuthoritySources.$inferSelect,
        'sourceId' | 'roleEvidenceRevision'
      >
    | undefined,
  snapshot: DerivedAuthoritySnapshot,
) {
  return (
    (snapshot.sourceId === null && existing !== undefined) ||
    (snapshot.sourceId !== null &&
      (existing?.sourceId !== snapshot.sourceId ||
        existing.roleEvidenceRevision !== snapshot.roleEvidenceRevision))
  )
}

async function lockCurrentSnapshot(
  transaction: DatabaseTransaction,
  snapshot: DerivedAuthoritySnapshot,
) {
  const [current] = await transaction
    .select({
      affiliationCheckedAt: characters.affiliationCheckedAt,
      allianceId: characters.allianceId,
      authorizationGeneration: eveTokens.tokenVersion,
      corporationId: characters.corporationId,
      derivedDirectorAuthorityEnabled: deploymentSettings.derivedDirectorAuthorityEnabled,
      freshDurationSeconds: deploymentSettings.authorityEvidenceFreshDurationSeconds,
      organizationVersion: deploymentSettings.organizationVersion,
      policyVersion: deploymentSettings.registrationPolicyVersion,
      scopes: eveTokens.scopes,
      subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
    })
    .from(characters)
    .innerJoin(eveTokens, eq(eveTokens.characterId, characters.characterId))
    .innerJoin(
      platformSubjectLifecycles,
      eq(platformSubjectLifecycles.characterId, characters.characterId),
    )
    .innerJoin(deploymentSettings, eq(deploymentSettings.id, 1))
    .where(
      and(eq(characters.characterId, snapshot.characterId), eq(characters.userId, snapshot.userId)),
    )
    .for('update')
  if (
    current?.organizationVersion !== snapshot.organizationVersion ||
    !current.derivedDirectorAuthorityEnabled ||
    current.subjectLifecycleId !== snapshot.subjectLifecycleId ||
    current.authorizationGeneration !== snapshot.authorizationGeneration ||
    !current.scopes.includes(characterCorporationRolesScope) ||
    !current.affiliationCheckedAt
  ) {
    return null
  }
  const blocked = await hasActiveOrganizationMemberBlock(
    transaction,
    snapshot.organizationVersion,
    snapshot.userId,
  )
  return { ...current, blocked }
}

async function invalidateReplacedLifecycles(
  transaction: DatabaseTransaction,
  snapshot: DerivedAuthoritySnapshot,
  invalidatedAt: Date,
) {
  await transaction
    .update(organizationDerivedAuthoritySources)
    .set({
      failureClass: 'strict:lifecycle-replaced',
      graceUntil: null,
      invalidatedAt,
      invalidationOutcome: 'lifecycle-replaced',
      status: 'invalid',
      updatedAt: invalidatedAt,
    })
    .where(
      and(
        eq(organizationDerivedAuthoritySources.deploymentId, 1),
        eq(organizationDerivedAuthoritySources.organizationVersion, snapshot.organizationVersion),
        eq(organizationDerivedAuthoritySources.characterId, snapshot.characterId),
        ne(
          organizationDerivedAuthoritySources.sourceSubjectLifecycleId,
          snapshot.subjectLifecycleId,
        ),
        isNull(organizationDerivedAuthoritySources.invalidatedAt),
      ),
    )
}

async function updateSource(
  transaction: DatabaseTransaction,
  sourceId: string,
  values: DerivedAuthorityProjectionValues,
) {
  const [source] = await transaction
    .update(organizationDerivedAuthoritySources)
    .set(values)
    .where(eq(organizationDerivedAuthoritySources.sourceId, sourceId))
    .returning({ sourceId: organizationDerivedAuthoritySources.sourceId })
  if (!source) {
    throw new Error('Failed to update derived authority source')
  }
  return source
}

async function invalidateSourceRevision(
  transaction: DatabaseTransaction,
  sourceId: string,
  invalidatedAt: Date,
) {
  await transaction
    .update(organizationDerivedAuthoritySources)
    .set({
      failureClass: 'strict:source-replaced',
      graceUntil: null,
      invalidatedAt,
      invalidationOutcome: 'source-replaced',
      status: 'invalid',
      updatedAt: invalidatedAt,
    })
    .where(
      and(
        eq(organizationDerivedAuthoritySources.sourceId, sourceId),
        isNull(organizationDerivedAuthoritySources.invalidatedAt),
      ),
    )
}

async function insertSource(
  transaction: DatabaseTransaction,
  snapshot: DerivedAuthoritySnapshot,
  values: DerivedAuthorityProjectionValues,
  createdAt: Date,
) {
  const [source] = await transaction
    .insert(organizationDerivedAuthoritySources)
    .values({
      ...values,
      characterId: snapshot.characterId,
      createdAt,
      deploymentId: 1,
      organizationVersion: snapshot.organizationVersion,
      role: 'director',
      sourceSubjectLifecycleId: snapshot.subjectLifecycleId,
      userId: snapshot.userId,
    })
    .onConflictDoNothing()
    .returning({ sourceId: organizationDerivedAuthoritySources.sourceId })
  if (source) {
    return source
  }
  const [current] = await transaction
    .select({ sourceId: organizationDerivedAuthoritySources.sourceId })
    .from(organizationDerivedAuthoritySources)
    .where(
      and(
        eq(organizationDerivedAuthoritySources.deploymentId, 1),
        eq(organizationDerivedAuthoritySources.organizationVersion, snapshot.organizationVersion),
        eq(organizationDerivedAuthoritySources.userId, snapshot.userId),
        eq(organizationDerivedAuthoritySources.role, 'director'),
        eq(
          organizationDerivedAuthoritySources.sourceSubjectLifecycleId,
          snapshot.subjectLifecycleId,
        ),
        isNull(organizationDerivedAuthoritySources.invalidatedAt),
      ),
    )
  return current ?? null
}

async function persistProjectionFailure(
  snapshot: DerivedAuthoritySnapshot,
  failure: { kind: 'strict' | 'transient'; failureClass: string },
  checkedAt: Date,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  return db.transaction(async (transaction) => {
    const [organization] = await transaction
      .select({
        organizationVersion: deploymentSettings.organizationVersion,
        policyVersion: deploymentSettings.registrationPolicyVersion,
        staleSeconds: deploymentSettings.staleEvidenceGraceDurationSeconds,
      })
      .from(deploymentSettings)
      .where(eq(deploymentSettings.id, 1))
      .for('update')
    if (organization?.organizationVersion !== snapshot.organizationVersion) {
      return 'superseded' as const
    }

    const current = await lockCurrentSnapshot(transaction, snapshot)
    signal?.throwIfAborted()
    if (!current || current.blocked) {
      return 'superseded' as const
    }

    const [source] = await transaction
      .select()
      .from(organizationDerivedAuthoritySources)
      .where(
        and(
          eq(organizationDerivedAuthoritySources.deploymentId, 1),
          eq(organizationDerivedAuthoritySources.organizationVersion, snapshot.organizationVersion),
          eq(organizationDerivedAuthoritySources.userId, snapshot.userId),
          eq(
            organizationDerivedAuthoritySources.sourceSubjectLifecycleId,
            snapshot.subjectLifecycleId,
          ),
          isNull(organizationDerivedAuthoritySources.invalidatedAt),
        ),
      )
      .for('update')
    signal?.throwIfAborted()
    if (!source) {
      return 'ineligible' as const
    }
    if (
      source.sourceId !== snapshot.sourceId ||
      source.roleEvidenceRevision !== snapshot.roleEvidenceRevision
    ) {
      return 'superseded' as const
    }

    if (failure.kind === 'strict') {
      await invalidateCharacterAuthoritySourcesInTransaction(transaction, {
        characterId: snapshot.characterId,
        expected: {
          authorizationGeneration: snapshot.authorizationGeneration,
          organizationVersion: snapshot.organizationVersion,
          sourceSubjectLifecycleId: snapshot.subjectLifecycleId,
        },
        now: checkedAt,
        outcome: invalidationOutcome(failure),
      })
      signal?.throwIfAborted()
      return 'invalid' as const
    }

    if (failure.kind === 'transient' && checkedAt < source.freshUntil) {
      await transaction
        .update(organizationDerivedAuthoritySources)
        .set({ updatedAt: checkedAt })
        .where(eq(organizationDerivedAuthoritySources.sourceId, source.sourceId))
      signal?.throwIfAborted()
      return 'fresh' as const
    }
    const graceBoundary = new Date(source.freshUntil.getTime() + organization.staleSeconds * 1000)
    const graceUntil = source.graceUntil
      ? new Date(Math.min(source.graceUntil.getTime(), graceBoundary.getTime()))
      : graceBoundary
    if (failure.kind === 'transient' && checkedAt < graceUntil) {
      await transaction
        .update(organizationDerivedAuthoritySources)
        .set({
          failureClass: `transient:${failure.failureClass}`,
          graceUntil,
          status: 'degraded',
          updatedAt: checkedAt,
        })
        .where(eq(organizationDerivedAuthoritySources.sourceId, source.sourceId))
      signal?.throwIfAborted()
      return 'degraded' as const
    }

    await invalidateCharacterAuthoritySourcesInTransaction(transaction, {
      characterId: snapshot.characterId,
      expected: {
        authorizationGeneration: snapshot.authorizationGeneration,
        organizationVersion: snapshot.organizationVersion,
        sourceSubjectLifecycleId: snapshot.subjectLifecycleId,
      },
      now: checkedAt,
      outcome: 'expired',
    })
    signal?.throwIfAborted()
    return 'invalid' as const
  })
}

function invalidationOutcome(failure: {
  kind: 'strict' | 'transient'
  failureClass: string
}): OrganizationAuthorityInvalidationOutcome {
  if (failure.kind === 'transient') {
    return 'expired'
  }
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
