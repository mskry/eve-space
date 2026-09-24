import { and, eq, isNull, lte, ne, or } from 'drizzle-orm'
import {
  characterCorporationRolesScope,
  getCharacterCorporationRolesEvidence,
  type CharacterCorporationRolesEvidence,
} from '../characters/corporation-roles.js'
import { observeAndPersistCharacterAffiliation } from '../characters/affiliation-sync.js'
import { db, type DatabaseTransaction } from '../db/client.js'
import {
  characters,
  deploymentSettings,
  eveTokens,
  organizationCorporationSources,
  organizationManagedCorporations,
  organizationMemberBlocks,
  platformSubjectLifecycles,
} from '../db/schema.js'
import { env } from '../env.js'
import { appendOrganizationAuditEvent } from './audit.js'
import {
  convergeObservedAffiliationInTransaction,
  invalidateCharacterAuthoritySourcesInTransaction,
} from './authority-convergence.js'
import {
  assertOrganizationOwnerDirectorRole,
  OrganizationAuthorityError,
} from './authority-policy.js'
import { corporationMembershipScope } from './corporation-membership.js'
import { loadManagementAuthority } from './management-authority.js'
import { hasActiveOrganizationMemberBlock } from './member-block.js'
import { classifyOrganizationAuthorityFailure } from './owner-evidence.js'

const failedEvidenceRetryIntervalMilliseconds = 5 * 60 * 1000
const evidenceRefreshAheadMilliseconds = 20 * 60 * 1000

export class OrganizationCorporationSourceMutationError extends Error {
  constructor(
    readonly code:
      | 'manager-authority-required'
      | 'manager-authority-degraded'
      | 'corporation-not-managed'
      | 'source-character-affiliation-stale'
      | 'source-character-ineligible',
  ) {
    super(code)
  }
}

export interface CorporationSourceEvidenceJobCandidate {
  readonly sourceId: string
  readonly organizationVersion: number
  readonly sourceSubjectLifecycleId: string
  readonly authorizationGeneration: number
  readonly roleEvidenceRevision: string
}

type CorporationSourceAffiliationEvidence = NonNullable<
  Awaited<ReturnType<typeof observeAndPersistCharacterAffiliation>>
>

export interface CorporationSourceEvidence {
  readonly affiliation: CorporationSourceAffiliationEvidence
  readonly roles: CharacterCorporationRolesEvidence
}

export interface RegisterCorporationSourceOptions {
  readonly evidence?: CorporationSourceEvidence
}

export async function registerOrganizationCorporationSource(
  input: {
    actorUserId: string
    corporationId: number
    characterId: number
  },
  options: RegisterCorporationSourceOptions = {},
) {
  const [planned] = await db
    .select({
      organizationVersion: deploymentSettings.organizationVersion,
      scopes: eveTokens.scopes,
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
    .where(eq(characters.characterId, input.characterId))
  if (
    planned?.userId !== input.actorUserId ||
    !planned.scopes.includes(corporationMembershipScope) ||
    !planned.scopes.includes(characterCorporationRolesScope)
  ) {
    throw new OrganizationCorporationSourceMutationError('source-character-ineligible')
  }
  await requireSourceManagementAuthority(db, planned.organizationVersion, input.actorUserId)

  const affiliation =
    options.evidence?.affiliation ??
    (await observeAndPersistCharacterAffiliation(
      input.characterId,
      undefined,
      convergeObservedAffiliationInTransaction,
    ))
  if (!affiliation || affiliation.stale) {
    throw new OrganizationCorporationSourceMutationError('source-character-affiliation-stale')
  }
  if (affiliation.characterId !== input.characterId) {
    throw new OrganizationCorporationSourceMutationError('source-character-ineligible')
  }
  const roles =
    options.evidence?.roles ??
    (await getCharacterCorporationRolesEvidence(input.characterId, planned.subjectLifecycleId))
  if (roles.stale) {
    throw new OrganizationCorporationSourceMutationError('source-character-affiliation-stale')
  }
  try {
    assertOrganizationOwnerDirectorRole(roles)
  } catch {
    throw new OrganizationCorporationSourceMutationError('source-character-ineligible')
  }

  return db.transaction(async (transaction) => {
    const [organization] = await transaction
      .select({
        authorityEvidenceFreshDurationSeconds:
          deploymentSettings.authorityEvidenceFreshDurationSeconds,
        organizationVersion: deploymentSettings.organizationVersion,
        policyVersion: deploymentSettings.registrationPolicyVersion,
      })
      .from(deploymentSettings)
      .where(eq(deploymentSettings.id, 1))
      .for('update')
    if (!organization) {
      throw new Error('Deployment organization is not configured')
    }
    const [managed] = await transaction
      .select({ corporationId: organizationManagedCorporations.corporationId })
      .from(organizationManagedCorporations)
      .where(
        and(
          eq(organizationManagedCorporations.deploymentId, 1),
          eq(organizationManagedCorporations.organizationVersion, organization.organizationVersion),
          eq(organizationManagedCorporations.corporationId, input.corporationId),
          eq(organizationManagedCorporations.isCurrent, true),
        ),
      )
    if (!managed) {
      throw new OrganizationCorporationSourceMutationError('corporation-not-managed')
    }

    const [existing] = await transaction
      .select()
      .from(organizationCorporationSources)
      .where(
        and(
          eq(organizationCorporationSources.deploymentId, 1),
          eq(organizationCorporationSources.organizationVersion, organization.organizationVersion),
          eq(organizationCorporationSources.corporationId, input.corporationId),
          isNull(organizationCorporationSources.revokedAt),
        ),
      )
      .for('update')
    await requireSourceManagementAuthority(
      transaction,
      organization.organizationVersion,
      input.actorUserId,
    )

    const [character] = await transaction
      .select({
        affiliationCheckedAt: characters.affiliationCheckedAt,
        affiliationResolutionState: characters.affiliationResolutionState,
        allianceId: characters.allianceId,
        authorizationGeneration: eveTokens.tokenVersion,
        corporationId: characters.corporationId,
        nextAffiliationCheck: characters.nextAffiliationCheck,
        scopes: eveTokens.scopes,
        sourceSubjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
        userId: characters.userId,
      })
      .from(characters)
      .innerJoin(eveTokens, eq(eveTokens.characterId, characters.characterId))
      .innerJoin(
        platformSubjectLifecycles,
        eq(platformSubjectLifecycles.characterId, characters.characterId),
      )
      .where(eq(characters.characterId, input.characterId))
      .for('update')
    const now = new Date()
    if (!character) {
      throw new OrganizationCorporationSourceMutationError('source-character-ineligible')
    }
    const characterIsEligible = () =>
      character.userId === input.actorUserId &&
      character.sourceSubjectLifecycleId === planned.subjectLifecycleId &&
      character.corporationId === input.corporationId &&
      character.corporationId === affiliation.corporationId &&
      character.allianceId === affiliation.allianceId &&
      character.affiliationResolutionState === 'resolved' &&
      character.affiliationCheckedAt !== null &&
      character.affiliationCheckedAt >= affiliation.affiliationCheckedAt &&
      character.authorizationGeneration === roles.authorizationGeneration &&
      character.scopes.includes(corporationMembershipScope) &&
      character.scopes.includes(characterCorporationRolesScope)
    if (!characterIsEligible()) {
      throw new OrganizationCorporationSourceMutationError('source-character-ineligible')
    }
    if (!character.nextAffiliationCheck || character.nextAffiliationCheck <= now) {
      throw new OrganizationCorporationSourceMutationError('source-character-affiliation-stale')
    }
    const freshUntil = new Date(
      Math.min(
        affiliation.affiliationFreshUntil.getTime(),
        roles.freshUntil.getTime(),
        now.getTime() + organization.authorityEvidenceFreshDurationSeconds * 1000,
      ),
    )
    if (freshUntil <= now) {
      throw new OrganizationCorporationSourceMutationError('source-character-affiliation-stale')
    }

    const sourceUnchanged = () =>
      existing?.characterId === input.characterId &&
      existing.sourceSubjectLifecycleId === character.sourceSubjectLifecycleId &&
      existing.authorizationGeneration === character.authorizationGeneration &&
      existing.status === 'fresh' &&
      existing.freshUntil > now
    if (existing && sourceUnchanged()) {
      return { replaced: false, source: toCorporationSource(existing) }
    }

    if (existing) {
      await transaction
        .update(organizationCorporationSources)
        .set({
          failureClass: 'strict:source-replaced',
          graceUntil: null,
          invalidatedAt: now,
          invalidationOutcome: 'source-replaced',
          revocationReason: 'Replaced by a newly selected corporation data source.',
          revokedAt: now,
          revokedByUserId: input.actorUserId,
          status: 'invalid',
          updatedAt: now,
        })
        .where(eq(organizationCorporationSources.sourceId, existing.sourceId))
    }
    const [source] = await transaction
      .insert(organizationCorporationSources)
      .values({
        authorizationGeneration: character.authorizationGeneration,
        characterId: input.characterId,
        corporationId: input.corporationId,
        deploymentId: 1,
        directorRolePresent: true,
        evidenceCharacterId: input.characterId,
        freshUntil,
        observedAllianceId: character.allianceId,
        observedAt: now,
        observedCorporationId: character.corporationId,
        organizationVersion: organization.organizationVersion,
        registeredAt: now,
        registeredByUserId: input.actorUserId,
        requiredScope: corporationMembershipScope,
        roleEvidenceRevision: roles.roleEvidenceRevision,
        sourceSubjectLifecycleId: character.sourceSubjectLifecycleId,
        sourceUserId: input.actorUserId,
        status: 'fresh',
      })
      .returning()
    if (!source) {
      throw new Error('Failed to register corporation data source')
    }
    await transaction.insert(platformSubjectLifecycles).values({
      corporationSourceId: source.sourceId,
      createdAt: now,
      subjectId: String(input.corporationId),
      subjectKind: 'corporation',
    })
    await appendOrganizationAuditEvent(transaction, {
      actorId: input.actorUserId,
      actorType: 'user',
      deploymentId: 1,
      eventType: existing ? 'corporation-source.replaced' : 'corporation-source.registered',
      occurredAt: now,
      organizationVersion: organization.organizationVersion,
      outcome: existing ? 'transitioned' : 'granted',
      policyVersion: organization.policyVersion,
      reason: existing
        ? 'The corporation data-source character was replaced.'
        : 'A corporation data-source character was registered.',
      subjectId: source.sourceId,
      subjectType: 'corporation_source',
    })
    return { replaced: Boolean(existing), source: toCorporationSource(source) }
  })
}

export async function selectDueOrganizationCorporationSources(
  now = new Date(),
  limit = env.QUEUE_RESOURCE_PLANNER_PAGE_SIZE,
) {
  const retryCutoff = new Date(now.getTime() - failedEvidenceRetryIntervalMilliseconds)
  const refreshBoundary = new Date(now.getTime() + evidenceRefreshAheadMilliseconds)
  return db
    .select({
      authorizationGeneration: organizationCorporationSources.authorizationGeneration,
      organizationVersion: organizationCorporationSources.organizationVersion,
      roleEvidenceRevision: organizationCorporationSources.roleEvidenceRevision,
      sourceId: organizationCorporationSources.sourceId,
      sourceSubjectLifecycleId: organizationCorporationSources.sourceSubjectLifecycleId,
    })
    .from(organizationCorporationSources)
    .innerJoin(
      deploymentSettings,
      and(
        eq(deploymentSettings.id, organizationCorporationSources.deploymentId),
        eq(
          deploymentSettings.organizationVersion,
          organizationCorporationSources.organizationVersion,
        ),
      ),
    )
    .innerJoin(
      eveTokens,
      eq(eveTokens.characterId, organizationCorporationSources.evidenceCharacterId),
    )
    .where(
      and(
        isNull(organizationCorporationSources.revokedAt),
        isNull(organizationCorporationSources.invalidatedAt),
        ne(organizationCorporationSources.status, 'invalid'),
        or(
          ne(organizationCorporationSources.authorizationGeneration, eveTokens.tokenVersion),
          and(
            eq(organizationCorporationSources.status, 'fresh'),
            lte(organizationCorporationSources.freshUntil, refreshBoundary),
          ),
          and(
            eq(organizationCorporationSources.status, 'degraded'),
            or(
              lte(organizationCorporationSources.updatedAt, retryCutoff),
              lte(organizationCorporationSources.graceUntil, now),
            ),
          ),
        ),
      ),
    )
    .orderBy(organizationCorporationSources.updatedAt, organizationCorporationSources.sourceId)
    .limit(Math.max(1, limit))
}

export async function refreshOrganizationCorporationSource(
  candidate: CorporationSourceEvidenceJobCandidate,
  options: { readonly signal?: AbortSignal } = {},
) {
  options.signal?.throwIfAborted()
  const snapshot = await loadCorporationSourceSnapshot(candidate)
  if (!snapshot) {
    return 'superseded' as const
  }
  const checkedAt = new Date()
  if (
    snapshot.sourceUserId !== snapshot.currentUserId ||
    snapshot.sourceSubjectLifecycleId !== snapshot.currentSubjectLifecycleId
  ) {
    return applyCorporationSourceFailure(
      snapshot,
      { failureClass: 'lifecycle-replaced', kind: 'strict' },
      checkedAt,
      options.signal,
    )
  }
  if (!snapshot.scopes.includes(corporationMembershipScope)) {
    return applyCorporationSourceFailure(
      snapshot,
      { failureClass: 'missing-corporation-scope', kind: 'strict' },
      checkedAt,
      options.signal,
    )
  }
  if (!snapshot.scopes.includes(characterCorporationRolesScope)) {
    return applyCorporationSourceFailure(
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
    if (affiliation.corporationId !== snapshot.corporationId) {
      throw new OrganizationAuthorityError('wrong-corporation')
    }
    const roles = await getCharacterCorporationRolesEvidence(
      snapshot.characterId,
      snapshot.sourceSubjectLifecycleId,
      options.signal,
    )
    if (roles.stale) {
      throw new OrganizationAuthorityError('stale-role-evidence')
    }
    assertOrganizationOwnerDirectorRole(roles)
    return persistCorporationSourceRefresh(snapshot, {
      affiliationObservedAt: affiliation.affiliationCheckedAt,
      checkedAt,
      evidenceAuthorizationGeneration: roles.authorizationGeneration,
      evidenceFreshUntil: new Date(
        Math.min(affiliation.affiliationFreshUntil.getTime(), roles.freshUntil.getTime()),
      ),
      observedAllianceId: affiliation.allianceId,
      roleEvidenceRevision: roles.roleEvidenceRevision,
      signal: options.signal,
    })
  } catch (error) {
    options.signal?.throwIfAborted()
    const failure = classifyOrganizationAuthorityFailure(error)
    if (!failure) {
      throw error
    }
    return applyCorporationSourceFailure(snapshot, failure, checkedAt, options.signal)
  }
}

function toCorporationSource(source: typeof organizationCorporationSources.$inferSelect) {
  return {
    authorizationGeneration: source.authorizationGeneration,
    characterId: source.characterId,
    corporationId: source.corporationId,
    evidenceCharacterId: source.evidenceCharacterId,
    failureClass: source.failureClass,
    freshUntil: source.freshUntil.toISOString(),
    graceUntil: source.graceUntil?.toISOString() ?? null,
    organizationVersion: source.organizationVersion,
    registeredAt: source.registeredAt.toISOString(),
    registeredByUserId: source.registeredByUserId,
    roleEvidenceRevision: source.roleEvidenceRevision,
    sourceId: source.sourceId,
    sourceSubjectLifecycleId: source.sourceSubjectLifecycleId,
    sourceUserId: source.sourceUserId,
    status: source.status,
  }
}

async function loadCorporationSourceSnapshot(candidate: CorporationSourceEvidenceJobCandidate) {
  const [snapshot] = await db
    .select({
      blockId: organizationMemberBlocks.blockId,
      characterId: organizationCorporationSources.evidenceCharacterId,
      corporationId: organizationCorporationSources.corporationId,
      currentAuthorizationGeneration: eveTokens.tokenVersion,
      currentSubjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
      currentUserId: characters.userId,
      invalidatedAt: organizationCorporationSources.invalidatedAt,
      organizationVersion: organizationCorporationSources.organizationVersion,
      roleEvidenceRevision: organizationCorporationSources.roleEvidenceRevision,
      scopes: eveTokens.scopes,
      sourceAuthorizationGeneration: organizationCorporationSources.authorizationGeneration,
      sourceId: organizationCorporationSources.sourceId,
      sourceSubjectLifecycleId: organizationCorporationSources.sourceSubjectLifecycleId,
      sourceUserId: organizationCorporationSources.sourceUserId,
    })
    .from(organizationCorporationSources)
    .innerJoin(
      deploymentSettings,
      and(
        eq(deploymentSettings.id, organizationCorporationSources.deploymentId),
        eq(
          deploymentSettings.organizationVersion,
          organizationCorporationSources.organizationVersion,
        ),
      ),
    )
    .innerJoin(
      characters,
      eq(characters.characterId, organizationCorporationSources.evidenceCharacterId),
    )
    .innerJoin(
      platformSubjectLifecycles,
      eq(platformSubjectLifecycles.characterId, characters.characterId),
    )
    .innerJoin(eveTokens, eq(eveTokens.characterId, characters.characterId))
    .leftJoin(
      organizationMemberBlocks,
      and(
        eq(organizationMemberBlocks.deploymentId, organizationCorporationSources.deploymentId),
        eq(
          organizationMemberBlocks.organizationVersion,
          organizationCorporationSources.organizationVersion,
        ),
        eq(organizationMemberBlocks.userId, organizationCorporationSources.sourceUserId),
        isNull(organizationMemberBlocks.unblockedAt),
      ),
    )
    .where(
      and(
        eq(organizationCorporationSources.sourceId, candidate.sourceId),
        eq(organizationCorporationSources.organizationVersion, candidate.organizationVersion),
        eq(
          organizationCorporationSources.sourceSubjectLifecycleId,
          candidate.sourceSubjectLifecycleId,
        ),
        eq(
          organizationCorporationSources.authorizationGeneration,
          candidate.authorizationGeneration,
        ),
        eq(organizationCorporationSources.roleEvidenceRevision, candidate.roleEvidenceRevision),
        eq(eveTokens.tokenVersion, candidate.authorizationGeneration),
        isNull(organizationCorporationSources.invalidatedAt),
        ne(organizationCorporationSources.status, 'invalid'),
        isNull(organizationMemberBlocks.blockId),
        isNull(organizationCorporationSources.revokedAt),
      ),
    )
  return snapshot ?? null
}

async function persistCorporationSourceRefresh(
  snapshot: NonNullable<Awaited<ReturnType<typeof loadCorporationSourceSnapshot>>>,
  evidence: {
    observedAllianceId: number | null
    affiliationObservedAt: Date
    evidenceFreshUntil: Date
    roleEvidenceRevision: string
    evidenceAuthorizationGeneration: number
    checkedAt: Date
    signal?: AbortSignal
  },
) {
  evidence.signal?.throwIfAborted()
  return db.transaction(async (transaction) => {
    const [current] = await transaction
      .select({
        affiliationCheckedAt: characters.affiliationCheckedAt,
        allianceId: characters.allianceId,
        authorizationGeneration: eveTokens.tokenVersion,
        corporationId: characters.corporationId,
        freshDurationSeconds: deploymentSettings.authorityEvidenceFreshDurationSeconds,
        invalidatedAt: organizationCorporationSources.invalidatedAt,
        organizationVersion: deploymentSettings.organizationVersion,
        policyVersion: deploymentSettings.registrationPolicyVersion,
        roleEvidenceRevision: organizationCorporationSources.roleEvidenceRevision,
        scopes: eveTokens.scopes,
        sourceAuthorizationGeneration: organizationCorporationSources.authorizationGeneration,
        subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
        userId: characters.userId,
      })
      .from(organizationCorporationSources)
      .innerJoin(deploymentSettings, eq(deploymentSettings.id, 1))
      .innerJoin(
        characters,
        eq(characters.characterId, organizationCorporationSources.evidenceCharacterId),
      )
      .innerJoin(
        platformSubjectLifecycles,
        eq(platformSubjectLifecycles.characterId, characters.characterId),
      )
      .innerJoin(eveTokens, eq(eveTokens.characterId, characters.characterId))
      .where(
        and(
          eq(organizationCorporationSources.sourceId, snapshot.sourceId),
          isNull(organizationCorporationSources.revokedAt),
        ),
      )
      .for('update')
    evidence.signal?.throwIfAborted()
    if (!current) {
      return 'superseded' as const
    }
    const blocked = await hasActiveOrganizationMemberBlock(
      transaction,
      snapshot.organizationVersion,
      current.userId,
    )
    evidence.signal?.throwIfAborted()
    const sourceMatchesRefresh = () =>
      current.organizationVersion === snapshot.organizationVersion &&
      current.invalidatedAt === null &&
      !blocked &&
      current.userId === snapshot.sourceUserId &&
      current.subjectLifecycleId === snapshot.sourceSubjectLifecycleId &&
      current.corporationId === snapshot.corporationId &&
      current.allianceId === evidence.observedAllianceId &&
      current.affiliationCheckedAt !== null &&
      current.affiliationCheckedAt >= evidence.affiliationObservedAt &&
      current.authorizationGeneration === evidence.evidenceAuthorizationGeneration &&
      current.authorizationGeneration === snapshot.currentAuthorizationGeneration &&
      current.sourceAuthorizationGeneration === snapshot.sourceAuthorizationGeneration &&
      current.roleEvidenceRevision === snapshot.roleEvidenceRevision &&
      current.scopes.includes(corporationMembershipScope) &&
      current.scopes.includes(characterCorporationRolesScope)
    if (!sourceMatchesRefresh()) {
      return 'superseded' as const
    }

    const freshUntil = new Date(
      Math.min(
        evidence.evidenceFreshUntil.getTime(),
        evidence.checkedAt.getTime() + current.freshDurationSeconds * 1000,
      ),
    )
    if (freshUntil <= evidence.checkedAt) {
      return 'superseded' as const
    }
    const [updated] = await transaction
      .update(organizationCorporationSources)
      .set({
        authorizationGeneration: current.authorizationGeneration,
        directorRolePresent: true,
        failureClass: null,
        freshUntil,
        graceUntil: null,
        invalidatedAt: null,
        invalidationOutcome: null,
        observedAllianceId: current.allianceId,
        observedAt: evidence.checkedAt,
        observedCorporationId: current.corporationId,
        roleEvidenceRevision: evidence.roleEvidenceRevision,
        sourceSubjectLifecycleId: current.subjectLifecycleId,
        sourceUserId: current.userId,
        status: 'fresh',
        updatedAt: evidence.checkedAt,
      })
      .where(
        and(
          eq(organizationCorporationSources.sourceId, snapshot.sourceId),
          eq(
            organizationCorporationSources.authorizationGeneration,
            snapshot.sourceAuthorizationGeneration,
          ),
          eq(organizationCorporationSources.roleEvidenceRevision, snapshot.roleEvidenceRevision),
          isNull(organizationCorporationSources.invalidatedAt),
          ne(organizationCorporationSources.status, 'invalid'),
        ),
      )
      .returning({ sourceId: organizationCorporationSources.sourceId })
    evidence.signal?.throwIfAborted()
    if (!updated) {
      return 'superseded' as const
    }
    await appendOrganizationAuditEvent(transaction, {
      actorId: null,
      actorType: 'system',
      deploymentId: 1,
      eventType: 'authority-source.observed',
      occurredAt: evidence.checkedAt,
      organizationVersion: snapshot.organizationVersion,
      outcome: 'unchanged',
      policyVersion: current.policyVersion,
      reason: 'Fresh designated corporation-source evidence was observed.',
      subjectId: snapshot.sourceId,
      subjectType: 'corporation_source',
    })
    evidence.signal?.throwIfAborted()
    return 'fresh' as const
  })
}

async function applyCorporationSourceFailure(
  snapshot: NonNullable<Awaited<ReturnType<typeof loadCorporationSourceSnapshot>>>,
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
    const [source] = await transaction
      .select({
        authorizationGeneration: organizationCorporationSources.authorizationGeneration,
        currentAuthorizationGeneration: eveTokens.tokenVersion,
        currentSubjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
        currentUserId: characters.userId,
        freshUntil: organizationCorporationSources.freshUntil,
        graceUntil: organizationCorporationSources.graceUntil,
        invalidatedAt: organizationCorporationSources.invalidatedAt,
        roleEvidenceRevision: organizationCorporationSources.roleEvidenceRevision,
        sourceId: organizationCorporationSources.sourceId,
        sourceSubjectLifecycleId: organizationCorporationSources.sourceSubjectLifecycleId,
        sourceUserId: organizationCorporationSources.sourceUserId,
        status: organizationCorporationSources.status,
      })
      .from(organizationCorporationSources)
      .innerJoin(
        characters,
        eq(characters.characterId, organizationCorporationSources.evidenceCharacterId),
      )
      .innerJoin(
        platformSubjectLifecycles,
        eq(platformSubjectLifecycles.characterId, characters.characterId),
      )
      .innerJoin(eveTokens, eq(eveTokens.characterId, characters.characterId))
      .where(
        and(
          eq(organizationCorporationSources.sourceId, snapshot.sourceId),
          isNull(organizationCorporationSources.revokedAt),
        ),
      )
      .for('update')
    signal?.throwIfAborted()
    const blocked = source
      ? await hasActiveOrganizationMemberBlock(
          transaction,
          snapshot.organizationVersion,
          source.sourceUserId,
        )
      : false
    signal?.throwIfAborted()
    if (!source) {
      return 'superseded' as const
    }
    const sourceMatchesFailure = () =>
      source.status !== 'invalid' &&
      !source.invalidatedAt &&
      !blocked &&
      source.currentUserId === snapshot.currentUserId &&
      source.currentSubjectLifecycleId === snapshot.currentSubjectLifecycleId &&
      source.currentAuthorizationGeneration === snapshot.currentAuthorizationGeneration &&
      source.sourceUserId === snapshot.sourceUserId &&
      source.sourceSubjectLifecycleId === snapshot.sourceSubjectLifecycleId &&
      source.authorizationGeneration === snapshot.sourceAuthorizationGeneration &&
      source.roleEvidenceRevision === snapshot.roleEvidenceRevision
    if (!sourceMatchesFailure()) {
      return 'superseded' as const
    }
    if (failure.kind === 'strict') {
      const outcome = corporationSourceInvalidationOutcome(failure)
      if (isCharacterWideAuthorityFailure(failure.failureClass)) {
        await invalidateCharacterAuthoritySourcesInTransaction(transaction, {
          characterId: snapshot.characterId,
          expected: {
            authorizationGeneration: snapshot.sourceAuthorizationGeneration,
            organizationVersion: snapshot.organizationVersion,
            sourceSubjectLifecycleId: snapshot.sourceSubjectLifecycleId,
          },
          now: checkedAt,
          outcome,
        })
      } else if (
        !(await invalidateDesignatedCorporationSource(transaction, {
          checkedAt,
          failureClass: failure.failureClass,
          outcome,
          policyVersion: organization.policyVersion,
          snapshot,
        }))
      ) {
        return 'superseded' as const
      }
      signal?.throwIfAborted()
      return 'invalid' as const
    }
    if (checkedAt < source.freshUntil) {
      await transaction
        .update(organizationCorporationSources)
        .set({ updatedAt: checkedAt })
        .where(eq(organizationCorporationSources.sourceId, snapshot.sourceId))
      signal?.throwIfAborted()
      return 'fresh' as const
    }
    const fixedGraceBoundary = new Date(
      source.freshUntil.getTime() + organization.staleSeconds * 1000,
    )
    const graceUntil = source.graceUntil
      ? new Date(Math.min(source.graceUntil.getTime(), fixedGraceBoundary.getTime()))
      : fixedGraceBoundary
    if (checkedAt < graceUntil) {
      await transaction
        .update(organizationCorporationSources)
        .set({
          failureClass: `transient:${failure.failureClass}`,
          graceUntil,
          status: 'degraded',
          updatedAt: checkedAt,
        })
        .where(eq(organizationCorporationSources.sourceId, snapshot.sourceId))
      signal?.throwIfAborted()
      return 'degraded' as const
    }
    await invalidateCharacterAuthoritySourcesInTransaction(transaction, {
      characterId: snapshot.characterId,
      expected: {
        authorizationGeneration: snapshot.sourceAuthorizationGeneration,
        organizationVersion: snapshot.organizationVersion,
        sourceSubjectLifecycleId: snapshot.sourceSubjectLifecycleId,
      },
      now: checkedAt,
      outcome: 'expired',
    })
    signal?.throwIfAborted()
    return 'invalid' as const
  })
}

async function invalidateDesignatedCorporationSource(
  transaction: DatabaseTransaction,
  input: {
    snapshot: NonNullable<Awaited<ReturnType<typeof loadCorporationSourceSnapshot>>>
    failureClass: string
    outcome: ReturnType<typeof corporationSourceInvalidationOutcome>
    policyVersion: number
    checkedAt: Date
  },
) {
  const [invalidated] = await transaction
    .update(organizationCorporationSources)
    .set({
      failureClass: `strict:${input.failureClass}`,
      graceUntil: null,
      invalidatedAt: input.checkedAt,
      invalidationOutcome: input.outcome,
      status: 'invalid',
      updatedAt: input.checkedAt,
    })
    .where(
      and(
        eq(organizationCorporationSources.sourceId, input.snapshot.sourceId),
        eq(
          organizationCorporationSources.authorizationGeneration,
          input.snapshot.sourceAuthorizationGeneration,
        ),
        eq(
          organizationCorporationSources.roleEvidenceRevision,
          input.snapshot.roleEvidenceRevision,
        ),
        isNull(organizationCorporationSources.invalidatedAt),
      ),
    )
    .returning({ sourceId: organizationCorporationSources.sourceId })
  if (!invalidated) {
    return false
  }
  await appendOrganizationAuditEvent(transaction, {
    actorId: null,
    actorType: 'system',
    deploymentId: 1,
    eventType: 'authority-source.invalidated',
    occurredAt: input.checkedAt,
    organizationVersion: input.snapshot.organizationVersion,
    outcome: 'revoked',
    policyVersion: input.policyVersion,
    reason: `Designated corporation source invalidated: ${input.outcome}.`,
    subjectId: invalidated.sourceId,
    subjectType: 'corporation_source',
  })
  return true
}

function isCharacterWideAuthorityFailure(failureClass: string) {
  return (
    failureClass === 'authorization-generation-changed' ||
    failureClass === 'authorization-missing' ||
    failureClass === 'authorization-rejected' ||
    failureClass === 'authorization-revoked' ||
    failureClass === 'lifecycle-replaced' ||
    failureClass === 'missing-scope' ||
    failureClass === 'not-director'
  )
}

function corporationSourceInvalidationOutcome(failure: {
  kind: 'strict' | 'transient'
  failureClass: string
}) {
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
    case 'missing-corporation-scope':
      return 'missing-scope' as const
    default:
      return 'authorization-rejected' as const
  }
}

async function requireSourceManagementAuthority(
  database: DatabaseTransaction | typeof db,
  organizationVersion: number,
  userId: string,
) {
  const now = new Date()
  if (await loadManagementAuthority(database, organizationVersion, userId, now, 'mutate')) {
    return
  }
  if (
    await loadManagementAuthority(database, organizationVersion, userId, now, 'read-continuity')
  ) {
    throw new OrganizationCorporationSourceMutationError('manager-authority-degraded')
  }
  throw new OrganizationCorporationSourceMutationError('manager-authority-required')
}
