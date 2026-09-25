import { and, eq, isNull } from 'drizzle-orm'
import type { CorporationRoleSourceBinding } from '../characters/corporation-role-evidence.js'
import type { CorporationRoleBootstrapIntent } from '../characters/corporation-role-observation.js'
import { characterCorporationRolesScope } from '../characters/corporation-roles.js'
import { db, type DatabaseTransaction } from '../db/client.js'
import {
  characters,
  deploymentSettings,
  eveTokens,
  organizationCorporationSources,
  organizationManagedCorporations,
  platformSubjectLifecycles,
} from '../db/schema.js'
import { appendOrganizationAuditEvent } from './audit.js'
import {
  commitCorporationRoleBootstrapInTransaction,
  CorporationRoleBootstrapError,
  prepareCorporationRoleBootstrap,
  type CorporationRoleBootstrapObservation,
  type PreparedCorporationRoleBootstrap,
} from './corporation-role-bootstrap.js'
import { corporationMembershipScope } from './corporation-membership.js'
import { loadManagementAuthority } from './management-authority.js'

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

export interface RegisterCorporationSourceOptions {
  readonly observation?: CorporationRoleBootstrapObservation
  readonly signal?: AbortSignal
}

const toSourceMutationError = (error: CorporationRoleBootstrapError) =>
  new OrganizationCorporationSourceMutationError(
    error.code === 'affiliation-stale' || error.code === 'role-evidence-unavailable'
      ? 'source-character-affiliation-stale'
      : 'source-character-ineligible',
  )

const withSourceMutationErrors = async <T>(operation: () => Promise<T>) => {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof CorporationRoleBootstrapError) {
      throw toSourceMutationError(error)
    }
    throw error
  }
}

const loadActiveCorporationSource = async (
  database: DatabaseTransaction | typeof db,
  organizationVersion: number,
  corporationId: number,
) => {
  const [source] = await database
    .select({ sourceId: organizationCorporationSources.sourceId })
    .from(organizationCorporationSources)
    .where(
      and(
        eq(organizationCorporationSources.deploymentId, 1),
        eq(organizationCorporationSources.organizationVersion, organizationVersion),
        eq(organizationCorporationSources.corporationId, corporationId),
        isNull(organizationCorporationSources.revokedAt),
      ),
    )
  return source ?? null
}

const corporationSourceBootstrapIntent = (input: {
  readonly actorUserId: string
  readonly corporationId: number
  readonly replacedSourceId: string | null
}): CorporationRoleBootstrapIntent =>
  input.replacedSourceId
    ? {
        actorUserId: input.actorUserId,
        corporationId: input.corporationId,
        kind: 'corporation-source-replacement',
        replacedSourceId: input.replacedSourceId,
      }
    : {
        actorUserId: input.actorUserId,
        corporationId: input.corporationId,
        kind: 'corporation-source-registration',
      }

const commitCorporationSourceRoleEvidence = (
  transaction: DatabaseTransaction,
  input: {
    readonly actorUserId: string
    readonly corporationId: number
    readonly organizationVersion: number
    readonly subjectLifecycleId: string
    readonly replacedSourceId: string | null
    readonly prepared: PreparedCorporationRoleBootstrap
    readonly signal: AbortSignal | undefined
  },
) =>
  withSourceMutationErrors(() =>
    commitCorporationRoleBootstrapInTransaction(transaction, input.prepared, {
      authorityCorporation: null,
      authorize: async (lockedTransaction, binding) => {
        const selectedSource = await loadActiveCorporationSource(
          lockedTransaction,
          binding.organizationVersion,
          input.corporationId,
        )
        return (
          binding.organizationVersion === input.organizationVersion &&
          binding.subjectLifecycleId === input.subjectLifecycleId &&
          binding.authorityCorporationId === input.corporationId &&
          (selectedSource?.sourceId ?? null) === input.replacedSourceId
        )
      },
      intent: corporationSourceBootstrapIntent(input),
      ...(input.signal && { signal: input.signal }),
    }),
  )

const resolveRegisteredSourceFreshUntil = (
  character:
    | {
        readonly userId: string
        readonly sourceSubjectLifecycleId: string
        readonly corporationId: number
        readonly affiliationPeriodRevision: string
        readonly affiliationResolutionState: string
        readonly authorizationGeneration: number
        readonly nextAffiliationCheck: Date | null
        readonly scopes: readonly string[]
      }
    | undefined,
  context: {
    readonly actorUserId: string
    readonly subjectLifecycleId: string
    readonly corporationId: number
    readonly binding: CorporationRoleSourceBinding
    readonly roleFreshUntil: Date
    readonly freshDurationSeconds: number
    readonly now: Date
  },
) => {
  const eligible =
    character?.userId === context.actorUserId &&
    character.sourceSubjectLifecycleId === context.subjectLifecycleId &&
    character.corporationId === context.corporationId &&
    character.corporationId === context.binding.authorityCorporationId &&
    character.affiliationPeriodRevision === context.binding.affiliationPeriodRevision &&
    character.affiliationResolutionState === 'resolved' &&
    character.authorizationGeneration === context.binding.authorizationGeneration &&
    character.scopes.includes(corporationMembershipScope) &&
    character.scopes.includes(characterCorporationRolesScope)
  if (!eligible) {
    throw new OrganizationCorporationSourceMutationError('source-character-ineligible')
  }
  const freshUntil = new Date(
    Math.min(
      context.roleFreshUntil.getTime(),
      context.now.getTime() + context.freshDurationSeconds * 1000,
    ),
  )
  if (
    !character.nextAffiliationCheck ||
    character.nextAffiliationCheck <= context.now ||
    freshUntil <= context.now
  ) {
    throw new OrganizationCorporationSourceMutationError('source-character-affiliation-stale')
  }
  return freshUntil
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

  const prepared = await withSourceMutationErrors(() =>
    prepareCorporationRoleBootstrap({
      characterId: input.characterId,
      userId: input.actorUserId,
      ...(options.observation && { observation: options.observation }),
      ...(options.signal && { signal: options.signal }),
    }),
  )
  if (
    prepared.binding.subjectLifecycleId !== planned.subjectLifecycleId ||
    prepared.binding.authorityCorporationId !== input.corporationId
  ) {
    throw new OrganizationCorporationSourceMutationError('source-character-ineligible')
  }
  const replacedSource = await loadActiveCorporationSource(
    db,
    prepared.binding.organizationVersion,
    input.corporationId,
  )

  return db.transaction(async (transaction) => {
    const roleEvidence = await commitCorporationSourceRoleEvidence(transaction, {
      ...input,
      organizationVersion: planned.organizationVersion,
      prepared,
      replacedSourceId: replacedSource?.sourceId ?? null,
      signal: options.signal,
      subjectLifecycleId: planned.subjectLifecycleId,
    })
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
        affiliationPeriodRevision: characters.affiliationPeriodRevision,
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
    const freshUntil = resolveRegisteredSourceFreshUntil(character, {
      actorUserId: input.actorUserId,
      binding: roleEvidence.binding,
      corporationId: input.corporationId,
      freshDurationSeconds: organization.authorityEvidenceFreshDurationSeconds,
      now,
      roleFreshUntil: roleEvidence.freshUntil,
      subjectLifecycleId: planned.subjectLifecycleId,
    })

    const sourceUnchanged = () =>
      existing?.characterId === input.characterId &&
      existing.sourceSubjectLifecycleId === planned.subjectLifecycleId &&
      existing.authorizationGeneration === roleEvidence.binding.authorizationGeneration &&
      existing.affiliationPeriodRevision === roleEvidence.binding.affiliationPeriodRevision &&
      existing.roleEvidenceRevision === roleEvidence.roleEvidenceRevision &&
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
        affiliationPeriodRevision: roleEvidence.binding.affiliationPeriodRevision,
        authorizationGeneration: roleEvidence.binding.authorizationGeneration,
        characterId: input.characterId,
        corporationId: input.corporationId,
        deploymentId: 1,
        directorRolePresent: true,
        evidenceCharacterId: input.characterId,
        freshUntil,
        observedAllianceId: character?.allianceId ?? null,
        observedAt: now,
        observedCorporationId: input.corporationId,
        organizationVersion: organization.organizationVersion,
        registeredAt: now,
        registeredByUserId: input.actorUserId,
        requiredScope: corporationMembershipScope,
        roleEvidenceRevision: roleEvidence.roleEvidenceRevision,
        sourceSubjectLifecycleId: planned.subjectLifecycleId,
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
