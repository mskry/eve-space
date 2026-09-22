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

const failedEvidenceRetryIntervalMilliseconds = 5 * 60 * 1_000
const evidenceRefreshAheadMilliseconds = 20 * 60 * 1_000

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
      userId: characters.userId,
      subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
      scopes: eveTokens.scopes,
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
  )
    throw new OrganizationCorporationSourceMutationError('source-character-ineligible')
  await requireSourceManagementAuthority(db, planned.organizationVersion, input.actorUserId)

  const affiliation =
    options.evidence?.affiliation ??
    (await observeAndPersistCharacterAffiliation(
      input.characterId,
      undefined,
      convergeObservedAffiliationInTransaction,
    ))
  if (!affiliation || affiliation.stale)
    throw new OrganizationCorporationSourceMutationError('source-character-affiliation-stale')
  if (affiliation.characterId !== input.characterId)
    throw new OrganizationCorporationSourceMutationError('source-character-ineligible')
  const roles =
    options.evidence?.roles ??
    (await getCharacterCorporationRolesEvidence(input.characterId, planned.subjectLifecycleId))
  if (roles.stale)
    throw new OrganizationCorporationSourceMutationError('source-character-affiliation-stale')
  try {
    assertOrganizationOwnerDirectorRole(roles)
  } catch {
    throw new OrganizationCorporationSourceMutationError('source-character-ineligible')
  }

  return db.transaction(async (transaction) => {
    const [organization] = await transaction
      .select({
        organizationVersion: deploymentSettings.organizationVersion,
        policyVersion: deploymentSettings.registrationPolicyVersion,
        authorityEvidenceFreshDurationSeconds:
          deploymentSettings.authorityEvidenceFreshDurationSeconds,
      })
      .from(deploymentSettings)
      .where(eq(deploymentSettings.id, 1))
      .for('update')
    if (!organization) throw new Error('Deployment organization is not configured')
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
    if (!managed) throw new OrganizationCorporationSourceMutationError('corporation-not-managed')

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
        userId: characters.userId,
        corporationId: characters.corporationId,
        allianceId: characters.allianceId,
        affiliationCheckedAt: characters.affiliationCheckedAt,
        nextAffiliationCheck: characters.nextAffiliationCheck,
        affiliationResolutionState: characters.affiliationResolutionState,
        scopes: eveTokens.scopes,
        authorizationGeneration: eveTokens.tokenVersion,
        sourceSubjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
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
    if (
      character?.userId !== input.actorUserId ||
      character.sourceSubjectLifecycleId !== planned.subjectLifecycleId ||
      character.corporationId !== input.corporationId ||
      character.corporationId !== affiliation.corporationId ||
      character.allianceId !== affiliation.allianceId ||
      character.affiliationResolutionState !== 'resolved' ||
      !character.affiliationCheckedAt ||
      character.affiliationCheckedAt < affiliation.affiliationCheckedAt ||
      character.authorizationGeneration !== roles.authorizationGeneration ||
      !character.scopes.includes(corporationMembershipScope) ||
      !character.scopes.includes(characterCorporationRolesScope)
    )
      throw new OrganizationCorporationSourceMutationError('source-character-ineligible')
    if (!character.nextAffiliationCheck || character.nextAffiliationCheck <= now)
      throw new OrganizationCorporationSourceMutationError('source-character-affiliation-stale')
    const freshUntil = new Date(
      Math.min(
        affiliation.affiliationFreshUntil.getTime(),
        roles.freshUntil.getTime(),
        now.getTime() + organization.authorityEvidenceFreshDurationSeconds * 1_000,
      ),
    )
    if (freshUntil <= now)
      throw new OrganizationCorporationSourceMutationError('source-character-affiliation-stale')

    if (
      existing?.characterId === input.characterId &&
      existing.sourceSubjectLifecycleId === character.sourceSubjectLifecycleId &&
      existing.authorizationGeneration === character.authorizationGeneration &&
      existing.status === 'fresh' &&
      existing.freshUntil > now
    )
      return { source: toCorporationSource(existing), replaced: false }

    if (existing)
      await transaction
        .update(organizationCorporationSources)
        .set({
          revokedAt: now,
          revokedByUserId: input.actorUserId,
          revocationReason: 'Replaced by a newly selected corporation data source.',
          status: 'invalid',
          graceUntil: null,
          failureClass: 'strict:source-replaced',
          invalidatedAt: now,
          invalidationOutcome: 'source-replaced',
          updatedAt: now,
        })
        .where(eq(organizationCorporationSources.sourceId, existing.sourceId))
    const [source] = await transaction
      .insert(organizationCorporationSources)
      .values({
        deploymentId: 1,
        organizationVersion: organization.organizationVersion,
        corporationId: input.corporationId,
        characterId: input.characterId,
        evidenceCharacterId: input.characterId,
        sourceUserId: input.actorUserId,
        sourceSubjectLifecycleId: character.sourceSubjectLifecycleId,
        authorizationGeneration: character.authorizationGeneration,
        roleEvidenceRevision: roles.roleEvidenceRevision,
        observedCorporationId: character.corporationId,
        observedAllianceId: character.allianceId,
        requiredScope: corporationMembershipScope,
        directorRolePresent: true,
        observedAt: now,
        freshUntil,
        status: 'fresh',
        registeredByUserId: input.actorUserId,
        registeredAt: now,
      })
      .returning()
    if (!source) throw new Error('Failed to register corporation data source')
    await transaction.insert(platformSubjectLifecycles).values({
      subjectKind: 'corporation',
      subjectId: String(input.corporationId),
      corporationSourceId: source.sourceId,
      createdAt: now,
    })
    await appendOrganizationAuditEvent(transaction, {
      deploymentId: 1,
      organizationVersion: organization.organizationVersion,
      policyVersion: organization.policyVersion,
      eventType: existing ? 'corporation-source.replaced' : 'corporation-source.registered',
      actorType: 'user',
      actorId: input.actorUserId,
      subjectType: 'corporation_source',
      subjectId: source.sourceId,
      reason: existing
        ? 'The corporation data-source character was replaced.'
        : 'A corporation data-source character was registered.',
      outcome: existing ? 'transitioned' : 'granted',
      occurredAt: now,
    })
    return { source: toCorporationSource(source), replaced: Boolean(existing) }
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
      sourceId: organizationCorporationSources.sourceId,
      organizationVersion: organizationCorporationSources.organizationVersion,
      sourceSubjectLifecycleId: organizationCorporationSources.sourceSubjectLifecycleId,
      authorizationGeneration: organizationCorporationSources.authorizationGeneration,
      roleEvidenceRevision: organizationCorporationSources.roleEvidenceRevision,
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
  if (!snapshot) return 'superseded' as const
  const checkedAt = new Date()
  if (
    snapshot.sourceUserId !== snapshot.currentUserId ||
    snapshot.sourceSubjectLifecycleId !== snapshot.currentSubjectLifecycleId
  )
    return applyCorporationSourceFailure(
      snapshot,
      { kind: 'strict', failureClass: 'lifecycle-replaced' },
      checkedAt,
      options.signal,
    )
  if (!snapshot.scopes.includes(corporationMembershipScope))
    return applyCorporationSourceFailure(
      snapshot,
      { kind: 'strict', failureClass: 'missing-corporation-scope' },
      checkedAt,
      options.signal,
    )
  if (!snapshot.scopes.includes(characterCorporationRolesScope))
    return applyCorporationSourceFailure(
      snapshot,
      { kind: 'strict', failureClass: 'missing-scope' },
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
    if (affiliation.corporationId !== snapshot.corporationId)
      throw new OrganizationAuthorityError('wrong-corporation')
    const roles = await getCharacterCorporationRolesEvidence(
      snapshot.characterId,
      snapshot.sourceSubjectLifecycleId,
      options.signal,
    )
    if (roles.stale) throw new OrganizationAuthorityError('stale-role-evidence')
    assertOrganizationOwnerDirectorRole(roles)
    return persistCorporationSourceRefresh(snapshot, {
      observedAllianceId: affiliation.allianceId,
      affiliationObservedAt: affiliation.affiliationCheckedAt,
      evidenceFreshUntil: new Date(
        Math.min(affiliation.affiliationFreshUntil.getTime(), roles.freshUntil.getTime()),
      ),
      roleEvidenceRevision: roles.roleEvidenceRevision,
      evidenceAuthorizationGeneration: roles.authorizationGeneration,
      checkedAt,
      signal: options.signal,
    })
  } catch (error) {
    options.signal?.throwIfAborted()
    const failure = classifyOrganizationAuthorityFailure(error)
    if (!failure) throw error
    return applyCorporationSourceFailure(snapshot, failure, checkedAt, options.signal)
  }
}

function toCorporationSource(source: typeof organizationCorporationSources.$inferSelect) {
  return {
    sourceId: source.sourceId,
    organizationVersion: source.organizationVersion,
    corporationId: source.corporationId,
    characterId: source.characterId,
    evidenceCharacterId: source.evidenceCharacterId,
    sourceUserId: source.sourceUserId,
    sourceSubjectLifecycleId: source.sourceSubjectLifecycleId,
    authorizationGeneration: source.authorizationGeneration,
    roleEvidenceRevision: source.roleEvidenceRevision,
    status: source.status,
    freshUntil: source.freshUntil.toISOString(),
    graceUntil: source.graceUntil?.toISOString() ?? null,
    failureClass: source.failureClass,
    registeredByUserId: source.registeredByUserId,
    registeredAt: source.registeredAt.toISOString(),
  }
}

async function loadCorporationSourceSnapshot(candidate: CorporationSourceEvidenceJobCandidate) {
  const [snapshot] = await db
    .select({
      sourceId: organizationCorporationSources.sourceId,
      organizationVersion: organizationCorporationSources.organizationVersion,
      corporationId: organizationCorporationSources.corporationId,
      characterId: organizationCorporationSources.evidenceCharacterId,
      sourceUserId: organizationCorporationSources.sourceUserId,
      sourceSubjectLifecycleId: organizationCorporationSources.sourceSubjectLifecycleId,
      currentUserId: characters.userId,
      currentSubjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
      currentAuthorizationGeneration: eveTokens.tokenVersion,
      sourceAuthorizationGeneration: organizationCorporationSources.authorizationGeneration,
      roleEvidenceRevision: organizationCorporationSources.roleEvidenceRevision,
      invalidatedAt: organizationCorporationSources.invalidatedAt,
      blockId: organizationMemberBlocks.blockId,
      scopes: eveTokens.scopes,
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
        organizationVersion: deploymentSettings.organizationVersion,
        policyVersion: deploymentSettings.registrationPolicyVersion,
        freshDurationSeconds: deploymentSettings.authorityEvidenceFreshDurationSeconds,
        userId: characters.userId,
        corporationId: characters.corporationId,
        allianceId: characters.allianceId,
        affiliationCheckedAt: characters.affiliationCheckedAt,
        subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
        authorizationGeneration: eveTokens.tokenVersion,
        scopes: eveTokens.scopes,
        sourceAuthorizationGeneration: organizationCorporationSources.authorizationGeneration,
        roleEvidenceRevision: organizationCorporationSources.roleEvidenceRevision,
        invalidatedAt: organizationCorporationSources.invalidatedAt,
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
    if (!current) return 'superseded' as const
    const blocked = await hasActiveOrganizationMemberBlock(
      transaction,
      snapshot.organizationVersion,
      current.userId,
    )
    evidence.signal?.throwIfAborted()
    if (
      current.organizationVersion !== snapshot.organizationVersion ||
      current.invalidatedAt !== null ||
      blocked ||
      current.userId !== snapshot.sourceUserId ||
      current.subjectLifecycleId !== snapshot.sourceSubjectLifecycleId ||
      current.corporationId !== snapshot.corporationId ||
      current.allianceId !== evidence.observedAllianceId ||
      !current.affiliationCheckedAt ||
      current.affiliationCheckedAt < evidence.affiliationObservedAt ||
      current.authorizationGeneration !== evidence.evidenceAuthorizationGeneration ||
      current.authorizationGeneration !== snapshot.currentAuthorizationGeneration ||
      current.sourceAuthorizationGeneration !== snapshot.sourceAuthorizationGeneration ||
      current.roleEvidenceRevision !== snapshot.roleEvidenceRevision ||
      !current.scopes.includes(corporationMembershipScope) ||
      !current.scopes.includes(characterCorporationRolesScope)
    )
      return 'superseded' as const

    const freshUntil = new Date(
      Math.min(
        evidence.evidenceFreshUntil.getTime(),
        evidence.checkedAt.getTime() + current.freshDurationSeconds * 1_000,
      ),
    )
    if (freshUntil <= evidence.checkedAt) return 'superseded' as const
    const [updated] = await transaction
      .update(organizationCorporationSources)
      .set({
        sourceUserId: current.userId,
        sourceSubjectLifecycleId: current.subjectLifecycleId,
        authorizationGeneration: current.authorizationGeneration,
        roleEvidenceRevision: evidence.roleEvidenceRevision,
        observedCorporationId: current.corporationId,
        observedAllianceId: current.allianceId,
        directorRolePresent: true,
        observedAt: evidence.checkedAt,
        freshUntil,
        graceUntil: null,
        status: 'fresh',
        failureClass: null,
        invalidatedAt: null,
        invalidationOutcome: null,
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
    if (!updated) return 'superseded' as const
    await appendOrganizationAuditEvent(transaction, {
      deploymentId: 1,
      organizationVersion: snapshot.organizationVersion,
      policyVersion: current.policyVersion,
      eventType: 'authority-source.observed',
      actorType: 'system',
      actorId: null,
      subjectType: 'corporation_source',
      subjectId: snapshot.sourceId,
      reason: 'Fresh designated corporation-source evidence was observed.',
      outcome: 'unchanged',
      occurredAt: evidence.checkedAt,
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
    if (organization?.organizationVersion !== snapshot.organizationVersion)
      return 'superseded' as const
    const [source] = await transaction
      .select({
        sourceId: organizationCorporationSources.sourceId,
        status: organizationCorporationSources.status,
        freshUntil: organizationCorporationSources.freshUntil,
        graceUntil: organizationCorporationSources.graceUntil,
        authorizationGeneration: organizationCorporationSources.authorizationGeneration,
        roleEvidenceRevision: organizationCorporationSources.roleEvidenceRevision,
        sourceUserId: organizationCorporationSources.sourceUserId,
        sourceSubjectLifecycleId: organizationCorporationSources.sourceSubjectLifecycleId,
        invalidatedAt: organizationCorporationSources.invalidatedAt,
        currentUserId: characters.userId,
        currentSubjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
        currentAuthorizationGeneration: eveTokens.tokenVersion,
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
    if (
      !source ||
      source.status === 'invalid' ||
      source.invalidatedAt ||
      blocked ||
      source.currentUserId !== snapshot.currentUserId ||
      source.currentSubjectLifecycleId !== snapshot.currentSubjectLifecycleId ||
      source.currentAuthorizationGeneration !== snapshot.currentAuthorizationGeneration ||
      source.sourceUserId !== snapshot.sourceUserId ||
      source.sourceSubjectLifecycleId !== snapshot.sourceSubjectLifecycleId ||
      source.authorizationGeneration !== snapshot.sourceAuthorizationGeneration ||
      source.roleEvidenceRevision !== snapshot.roleEvidenceRevision
    )
      return 'superseded' as const
    if (failure.kind === 'strict') {
      const outcome = corporationSourceInvalidationOutcome(failure)
      if (isCharacterWideAuthorityFailure(failure.failureClass))
        await invalidateCharacterAuthoritySourcesInTransaction(transaction, {
          characterId: snapshot.characterId,
          outcome,
          now: checkedAt,
          expected: {
            organizationVersion: snapshot.organizationVersion,
            sourceSubjectLifecycleId: snapshot.sourceSubjectLifecycleId,
            authorizationGeneration: snapshot.sourceAuthorizationGeneration,
          },
        })
      else if (
        !(await invalidateDesignatedCorporationSource(transaction, {
          snapshot,
          failureClass: failure.failureClass,
          outcome,
          policyVersion: organization.policyVersion,
          checkedAt,
        }))
      )
        return 'superseded' as const
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
      source.freshUntil.getTime() + organization.staleSeconds * 1_000,
    )
    const graceUntil = source.graceUntil
      ? new Date(Math.min(source.graceUntil.getTime(), fixedGraceBoundary.getTime()))
      : fixedGraceBoundary
    if (checkedAt < graceUntil) {
      await transaction
        .update(organizationCorporationSources)
        .set({
          status: 'degraded',
          graceUntil,
          failureClass: `transient:${failure.failureClass}`,
          updatedAt: checkedAt,
        })
        .where(eq(organizationCorporationSources.sourceId, snapshot.sourceId))
      signal?.throwIfAborted()
      return 'degraded' as const
    }
    await invalidateCharacterAuthoritySourcesInTransaction(transaction, {
      characterId: snapshot.characterId,
      outcome: 'expired',
      now: checkedAt,
      expected: {
        organizationVersion: snapshot.organizationVersion,
        sourceSubjectLifecycleId: snapshot.sourceSubjectLifecycleId,
        authorizationGeneration: snapshot.sourceAuthorizationGeneration,
      },
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
      status: 'invalid',
      graceUntil: null,
      failureClass: `strict:${input.failureClass}`,
      invalidatedAt: input.checkedAt,
      invalidationOutcome: input.outcome,
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
  if (!invalidated) return false
  await appendOrganizationAuditEvent(transaction, {
    deploymentId: 1,
    organizationVersion: input.snapshot.organizationVersion,
    policyVersion: input.policyVersion,
    eventType: 'authority-source.invalidated',
    actorType: 'system',
    actorId: null,
    subjectType: 'corporation_source',
    subjectId: invalidated.sourceId,
    reason: `Designated corporation source invalidated: ${input.outcome}.`,
    outcome: 'revoked',
    occurredAt: input.checkedAt,
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
  if (await loadManagementAuthority(database, organizationVersion, userId, now, 'mutate')) return
  if (await loadManagementAuthority(database, organizationVersion, userId, now, 'read-continuity'))
    throw new OrganizationCorporationSourceMutationError('manager-authority-degraded')
  throw new OrganizationCorporationSourceMutationError('manager-authority-required')
}
