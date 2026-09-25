import { and, eq, inArray, isNull, ne, sql, type SQLWrapper } from 'drizzle-orm'
import {
  corporationRoleObservationRequiredScope,
  evaluateCorporationRoleEvidence,
  loadCurrentCorporationRoleBinding,
} from '../characters/corporation-role-evidence.js'
import type {
  CorporationRoleObservationHook,
  CorporationRoleObservationTransition,
} from '../characters/corporation-role-observation.js'
import { db, type DatabaseTransaction } from '../db/client.js'
import { characterLockKey, characterLockNamespace } from '../db/locks.js'
import {
  characters,
  deploymentSettings,
  eveTokens,
  organizationAuthorityEvidence,
  organizationCorporationSources,
  organizationDerivedAuthoritySources,
  type OrganizationAuthorityInvalidationOutcome,
} from '../db/schema.js'
import { appendOrganizationAuditEvents, type OrganizationAuditInput } from './audit.js'
import { invalidateCharacterAuthoritySourcesInTransaction } from './authority-convergence.js'
import { corporationMembershipScope } from './corporation-membership.js'
import { hasActiveOrganizationMemberBlock } from './member-block.js'

export interface AuthorityCorporationEvidence {
  readonly corporationId: number
  readonly freshUntil: Date | null
}

export interface CorporationRoleConvergenceContext {
  readonly authorityCorporation: AuthorityCorporationEvidence | null
}

type ConvergenceSettings = NonNullable<Awaited<ReturnType<typeof loadConvergenceSettings>>>

type AuthorityCorporationDecision =
  | { readonly kind: 'eligible'; readonly freshUntil: Date | null }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'ineligible'; readonly outcome: 'wrong-alliance' | 'wrong-corporation' }

interface ObservedProjection {
  readonly transition: CorporationRoleObservationTransition
  readonly settings: ConvergenceSettings
  readonly observedAllianceId: number | null
  readonly roleEvidenceRevision: string
  readonly freshUntil: Date
}

const degradedFailureClass = 'transient:role-evidence-unavailable'

const loadConvergenceSettings = async (transaction: DatabaseTransaction) => {
  const [settings] = await transaction
    .select({
      derivedDirectorAuthorityEnabled: deploymentSettings.derivedDirectorAuthorityEnabled,
      organizationId: deploymentSettings.organizationId,
      organizationType: deploymentSettings.organizationType,
      organizationVersion: deploymentSettings.organizationVersion,
      policyVersion: deploymentSettings.registrationPolicyVersion,
      staleGraceSeconds: deploymentSettings.staleEvidenceGraceDurationSeconds,
    })
    .from(deploymentSettings)
    .where(eq(deploymentSettings.id, 1))
  return settings ?? null
}

const earliest = (first: Date, second: Date | null) => (second && second < first ? second : first)

const resolveAuthorityCorporation = (
  settings: ConvergenceSettings,
  transition: CorporationRoleObservationTransition,
  observedAllianceId: number | null,
  context: CorporationRoleConvergenceContext,
): AuthorityCorporationDecision => {
  const corporationId = transition.evidence.binding.authorityCorporationId
  if (settings.organizationType === 'corporation') {
    return corporationId === settings.organizationId
      ? { freshUntil: null, kind: 'eligible' }
      : { kind: 'ineligible', outcome: 'wrong-corporation' }
  }
  if (observedAllianceId !== settings.organizationId) {
    return { kind: 'ineligible', outcome: 'wrong-alliance' }
  }
  if (!context.authorityCorporation) {
    return { kind: 'unavailable' }
  }
  return context.authorityCorporation.corporationId === corporationId
    ? { freshUntil: context.authorityCorporation.freshUntil, kind: 'eligible' }
    : { kind: 'ineligible', outcome: 'wrong-corporation' }
}

const systemAudit = (
  settings: ConvergenceSettings,
  occurredAt: Date,
  input: Pick<
    OrganizationAuditInput,
    'eventType' | 'outcome' | 'reason' | 'subjectId' | 'subjectType'
  >,
): OrganizationAuditInput => ({
  actorId: null,
  actorType: 'system',
  deploymentId: 1,
  occurredAt,
  organizationVersion: settings.organizationVersion,
  policyVersion: settings.policyVersion,
  ...input,
})

const invalidateAuthoritySources = async (
  transaction: DatabaseTransaction,
  projection: ObservedProjection,
  outcome: OrganizationAuthorityInvalidationOutcome,
) => {
  const { binding } = projection.transition.evidence
  const now = projection.transition.checkedAt
  const invalidation = {
    failureClass: `strict:${outcome}`,
    graceUntil: null,
    invalidatedAt: now,
    invalidationOutcome: outcome,
    status: 'invalid' as const,
    updatedAt: now,
  }
  const owners = await transaction
    .update(organizationAuthorityEvidence)
    .set(invalidation)
    .where(
      and(
        eq(organizationAuthorityEvidence.characterId, binding.characterId),
        eq(organizationAuthorityEvidence.organizationVersion, binding.organizationVersion),
        isNull(organizationAuthorityEvidence.invalidatedAt),
      ),
    )
    .returning({ sourceId: organizationAuthorityEvidence.evidenceId })
  const derived = await transaction
    .update(organizationDerivedAuthoritySources)
    .set(invalidation)
    .where(
      and(
        eq(organizationDerivedAuthoritySources.characterId, binding.characterId),
        eq(organizationDerivedAuthoritySources.organizationVersion, binding.organizationVersion),
        isNull(organizationDerivedAuthoritySources.invalidatedAt),
      ),
    )
    .returning({ sourceId: organizationDerivedAuthoritySources.sourceId })
  await appendOrganizationAuditEvents(
    transaction,
    [...owners, ...derived].map(({ sourceId }) =>
      systemAudit(projection.settings, now, {
        eventType: 'authority-source.invalidated',
        outcome: 'revoked',
        reason: `Director authority source invalidated: ${outcome}.`,
        subjectId: sourceId,
        subjectType: 'authority_source',
      }),
    ),
  )
}

const refreshedSourceValues = (projection: ObservedProjection, freshUntil: Date) => {
  const { binding } = projection.transition.evidence
  const now = projection.transition.checkedAt
  return {
    affiliationPeriodRevision: binding.affiliationPeriodRevision,
    authorizationGeneration: binding.authorizationGeneration,
    directorRolePresent: true,
    failureClass: null,
    freshUntil,
    graceUntil: null,
    invalidatedAt: null,
    invalidationOutcome: null,
    observedAllianceId: projection.observedAllianceId,
    observedAt: now,
    observedCorporationId: binding.authorityCorporationId,
    roleEvidenceRevision: projection.roleEvidenceRevision,
    status: 'fresh' as const,
    updatedAt: now,
  }
}

const refreshOwnerSources = async (
  transaction: DatabaseTransaction,
  projection: ObservedProjection,
  freshUntil: Date,
) => {
  const { binding } = projection.transition.evidence
  const now = projection.transition.checkedAt
  const refreshed = await transaction
    .update(organizationAuthorityEvidence)
    .set({
      ...refreshedSourceValues(projection, freshUntil),
      authorityCorporationId: binding.authorityCorporationId,
      lastCheckedAt: now,
    })
    .where(
      and(
        eq(organizationAuthorityEvidence.characterId, binding.characterId),
        eq(organizationAuthorityEvidence.organizationVersion, binding.organizationVersion),
        eq(organizationAuthorityEvidence.userId, binding.userId),
        eq(organizationAuthorityEvidence.sourceSubjectLifecycleId, binding.subjectLifecycleId),
        isNull(organizationAuthorityEvidence.invalidatedAt),
      ),
    )
    .returning({ sourceId: organizationAuthorityEvidence.evidenceId })
  await appendOrganizationAuditEvents(
    transaction,
    refreshed.map(({ sourceId }) =>
      systemAudit(projection.settings, now, {
        eventType: 'authority-source.observed',
        outcome: 'unchanged',
        reason: 'Fresh organization-owner corporation-role evidence was observed.',
        subjectId: sourceId,
        subjectType: 'authority_source',
      }),
    ),
  )
}

const loadCurrentDerivedSource = async (
  transaction: DatabaseTransaction,
  projection: ObservedProjection,
) => {
  const { binding } = projection.transition.evidence
  const [current] = await transaction
    .select({
      roleEvidenceRevision: organizationDerivedAuthoritySources.roleEvidenceRevision,
      sourceId: organizationDerivedAuthoritySources.sourceId,
    })
    .from(organizationDerivedAuthoritySources)
    .where(
      and(
        eq(organizationDerivedAuthoritySources.deploymentId, 1),
        eq(organizationDerivedAuthoritySources.organizationVersion, binding.organizationVersion),
        eq(organizationDerivedAuthoritySources.userId, binding.userId),
        eq(organizationDerivedAuthoritySources.role, 'director'),
        eq(
          organizationDerivedAuthoritySources.sourceSubjectLifecycleId,
          binding.subjectLifecycleId,
        ),
        isNull(organizationDerivedAuthoritySources.invalidatedAt),
      ),
    )
    .for('update')
  return current ?? null
}

const refreshDerivedSource = async (
  transaction: DatabaseTransaction,
  projection: ObservedProjection,
  freshUntil: Date,
) => {
  const { binding } = projection.transition.evidence
  const now = projection.transition.checkedAt
  if (
    !projection.settings.derivedDirectorAuthorityEnabled ||
    (await hasActiveOrganizationMemberBlock(
      transaction,
      binding.organizationVersion,
      binding.userId,
    ))
  ) {
    return
  }
  const current = await loadCurrentDerivedSource(transaction, projection)
  const values = {
    ...refreshedSourceValues(projection, freshUntil),
    authorityCorporationId: binding.authorityCorporationId,
    requiredScope: corporationRoleObservationRequiredScope,
  }
  if (current?.roleEvidenceRevision === projection.roleEvidenceRevision) {
    await transaction
      .update(organizationDerivedAuthoritySources)
      .set(values)
      .where(eq(organizationDerivedAuthoritySources.sourceId, current.sourceId))
    return
  }
  if (current) {
    await transaction
      .update(organizationDerivedAuthoritySources)
      .set({
        failureClass: 'strict:source-replaced',
        graceUntil: null,
        invalidatedAt: now,
        invalidationOutcome: 'source-replaced',
        status: 'invalid',
        updatedAt: now,
      })
      .where(eq(organizationDerivedAuthoritySources.sourceId, current.sourceId))
  }
  const [inserted] = await transaction
    .insert(organizationDerivedAuthoritySources)
    .values({
      ...values,
      characterId: binding.characterId,
      createdAt: now,
      deploymentId: 1,
      organizationVersion: binding.organizationVersion,
      role: 'director',
      sourceSubjectLifecycleId: binding.subjectLifecycleId,
      userId: binding.userId,
    })
    .onConflictDoUpdate({
      set: values,
      target: [
        organizationDerivedAuthoritySources.deploymentId,
        organizationDerivedAuthoritySources.organizationVersion,
        organizationDerivedAuthoritySources.userId,
        organizationDerivedAuthoritySources.role,
        organizationDerivedAuthoritySources.sourceSubjectLifecycleId,
        organizationDerivedAuthoritySources.roleEvidenceRevision,
      ],
    })
    .returning({ sourceId: organizationDerivedAuthoritySources.sourceId })
  if (!inserted) {
    throw new Error('Failed to project derived Director authority')
  }
  await appendOrganizationAuditEvents(transaction, [
    systemAudit(projection.settings, now, {
      eventType: 'authority-source.observed',
      outcome: current ? 'transitioned' : 'granted',
      reason: 'Fresh EVE Director corporation-role evidence was observed.',
      subjectId: inserted.sourceId,
      subjectType: 'authority_source',
    }),
  ])
}

const invalidateDesignatedCorporationSources = async (
  transaction: DatabaseTransaction,
  projection: ObservedProjection,
  sourceIds: readonly string[],
  outcome: 'missing-scope' | 'wrong-corporation',
) => {
  if (sourceIds.length === 0) {
    return
  }
  const now = projection.transition.checkedAt
  await transaction
    .update(organizationCorporationSources)
    .set({
      failureClass: `strict:${outcome}`,
      graceUntil: null,
      invalidatedAt: now,
      invalidationOutcome: outcome,
      status: 'invalid',
      updatedAt: now,
    })
    .where(inArray(organizationCorporationSources.sourceId, [...sourceIds]))
  await appendOrganizationAuditEvents(
    transaction,
    sourceIds.map((sourceId) =>
      systemAudit(projection.settings, now, {
        eventType: 'authority-source.invalidated',
        outcome: 'revoked',
        reason: `Designated corporation source invalidated: ${outcome}.`,
        subjectId: sourceId,
        subjectType: 'corporation_source',
      }),
    ),
  )
}

const refreshCorporationSources = async (
  transaction: DatabaseTransaction,
  projection: ObservedProjection,
  scopes: readonly string[],
) => {
  const { binding } = projection.transition.evidence
  const now = projection.transition.checkedAt
  const sources = await transaction
    .select({
      corporationId: organizationCorporationSources.corporationId,
      sourceId: organizationCorporationSources.sourceId,
    })
    .from(organizationCorporationSources)
    .where(
      and(
        eq(organizationCorporationSources.evidenceCharacterId, binding.characterId),
        eq(organizationCorporationSources.organizationVersion, binding.organizationVersion),
        eq(organizationCorporationSources.sourceUserId, binding.userId),
        eq(organizationCorporationSources.sourceSubjectLifecycleId, binding.subjectLifecycleId),
        isNull(organizationCorporationSources.revokedAt),
        isNull(organizationCorporationSources.invalidatedAt),
        ne(organizationCorporationSources.status, 'invalid'),
      ),
    )
    .for('update')
  const wrongCorporation = sources
    .filter(({ corporationId }) => corporationId !== binding.authorityCorporationId)
    .map(({ sourceId }) => sourceId)
  const eligible = sources
    .filter(({ corporationId }) => corporationId === binding.authorityCorporationId)
    .map(({ sourceId }) => sourceId)
  await invalidateDesignatedCorporationSources(
    transaction,
    projection,
    wrongCorporation,
    'wrong-corporation',
  )
  if (!scopes.includes(corporationMembershipScope)) {
    await invalidateDesignatedCorporationSources(transaction, projection, eligible, 'missing-scope')
    return
  }
  if (eligible.length === 0) {
    return
  }
  await transaction
    .update(organizationCorporationSources)
    .set(refreshedSourceValues(projection, projection.freshUntil))
    .where(inArray(organizationCorporationSources.sourceId, eligible))
  await appendOrganizationAuditEvents(
    transaction,
    eligible.map((sourceId) =>
      systemAudit(projection.settings, now, {
        eventType: 'authority-source.observed',
        outcome: 'unchanged',
        reason: 'Fresh designated corporation-source role evidence was observed.',
        subjectId: sourceId,
        subjectType: 'corporation_source',
      }),
    ),
  )
}

const loadCharacterAuthorityState = async (
  transaction: DatabaseTransaction,
  characterId: number,
) => {
  const [character] = await transaction
    .select({ allianceId: characters.allianceId, scopes: eveTokens.scopes })
    .from(characters)
    .innerJoin(eveTokens, eq(eveTokens.characterId, characters.characterId))
    .where(eq(characters.characterId, characterId))
  return character ?? null
}

const convergeObservedRoles = async (
  transaction: DatabaseTransaction,
  transition: CorporationRoleObservationTransition,
  settings: ConvergenceSettings,
  context: CorporationRoleConvergenceContext,
) => {
  const { evidence, predicates } = transition
  if (evidence.state !== 'fresh' || !predicates || !evidence.roleRevision || !evidence.freshUntil) {
    return
  }
  if (!predicates.director) {
    await invalidateCharacterAuthoritySourcesInTransaction(transaction, {
      characterId: evidence.binding.characterId,
      now: transition.checkedAt,
      outcome: 'not-director',
    })
    return
  }
  const character = await loadCharacterAuthorityState(transaction, evidence.binding.characterId)
  if (!character) {
    return
  }
  const projection: ObservedProjection = {
    freshUntil: evidence.freshUntil,
    observedAllianceId: character.allianceId,
    roleEvidenceRevision: evidence.roleRevision,
    settings,
    transition,
  }
  const authorityCorporation = resolveAuthorityCorporation(
    settings,
    transition,
    character.allianceId,
    context,
  )
  if (authorityCorporation.kind === 'ineligible') {
    await invalidateAuthoritySources(transaction, projection, authorityCorporation.outcome)
  } else if (authorityCorporation.kind === 'eligible') {
    const freshUntil = earliest(evidence.freshUntil, authorityCorporation.freshUntil)
    if (freshUntil > transition.checkedAt) {
      await refreshOwnerSources(transaction, projection, freshUntil)
      await refreshDerivedSource(transaction, projection, freshUntil)
    }
  }
  await refreshCorporationSources(transaction, projection, character.scopes)
}

const boundedGraceUntil = (
  freshUntil: SQLWrapper,
  currentGraceUntil: SQLWrapper,
  degradedUntil: Date,
  staleGraceSeconds: number,
) =>
  sql<Date>`least(
    ${degradedUntil.toISOString()}::timestamptz,
    ${freshUntil} + ${staleGraceSeconds} * interval '1 second',
    coalesce(${currentGraceUntil}, 'infinity'::timestamptz)
  )`

const degradeRoleDependentSources = async (
  transaction: DatabaseTransaction,
  transition: CorporationRoleObservationTransition,
  settings: ConvergenceSettings,
) => {
  const { binding, degradedUntil, roleRevision } = transition.evidence
  if (!degradedUntil || !roleRevision) {
    return
  }
  const degraded = {
    failureClass: degradedFailureClass,
    status: 'degraded' as const,
    updatedAt: transition.checkedAt,
  }
  const ownerGraceUntil = boundedGraceUntil(
    organizationAuthorityEvidence.freshUntil,
    organizationAuthorityEvidence.graceUntil,
    degradedUntil,
    settings.staleGraceSeconds,
  )
  await transaction
    .update(organizationAuthorityEvidence)
    .set({ ...degraded, graceUntil: ownerGraceUntil })
    .where(
      and(
        eq(organizationAuthorityEvidence.characterId, binding.characterId),
        eq(organizationAuthorityEvidence.organizationVersion, binding.organizationVersion),
        eq(organizationAuthorityEvidence.roleEvidenceRevision, roleRevision),
        isNull(organizationAuthorityEvidence.invalidatedAt),
        sql`${ownerGraceUntil} > ${transition.checkedAt.toISOString()}::timestamptz`,
      ),
    )
  const derivedGraceUntil = boundedGraceUntil(
    organizationDerivedAuthoritySources.freshUntil,
    organizationDerivedAuthoritySources.graceUntil,
    degradedUntil,
    settings.staleGraceSeconds,
  )
  await transaction
    .update(organizationDerivedAuthoritySources)
    .set({ ...degraded, graceUntil: derivedGraceUntil })
    .where(
      and(
        eq(organizationDerivedAuthoritySources.characterId, binding.characterId),
        eq(organizationDerivedAuthoritySources.organizationVersion, binding.organizationVersion),
        eq(organizationDerivedAuthoritySources.roleEvidenceRevision, roleRevision),
        isNull(organizationDerivedAuthoritySources.invalidatedAt),
        sql`${derivedGraceUntil} > ${transition.checkedAt.toISOString()}::timestamptz`,
      ),
    )
  const corporationGraceUntil = boundedGraceUntil(
    organizationCorporationSources.freshUntil,
    organizationCorporationSources.graceUntil,
    degradedUntil,
    settings.staleGraceSeconds,
  )
  await transaction
    .update(organizationCorporationSources)
    .set({ ...degraded, graceUntil: corporationGraceUntil })
    .where(
      and(
        eq(organizationCorporationSources.evidenceCharacterId, binding.characterId),
        eq(organizationCorporationSources.organizationVersion, binding.organizationVersion),
        eq(organizationCorporationSources.roleEvidenceRevision, roleRevision),
        isNull(organizationCorporationSources.revokedAt),
        isNull(organizationCorporationSources.invalidatedAt),
        sql`${corporationGraceUntil} > ${transition.checkedAt.toISOString()}::timestamptz`,
      ),
    )
}

export const convergeCorporationRoleTransitionInTransaction = async (
  transaction: DatabaseTransaction,
  transition: CorporationRoleObservationTransition,
  context: CorporationRoleConvergenceContext,
) => {
  const settings = await loadConvergenceSettings(transaction)
  if (settings?.organizationVersion !== transition.evidence.binding.organizationVersion) {
    return
  }
  if (transition.kind === 'observed') {
    await convergeObservedRoles(transaction, transition, settings, context)
    return
  }
  if (transition.kind === 'degraded') {
    await degradeRoleDependentSources(transaction, transition, settings)
    return
  }
  if (transition.kind === 'invalidated' && transition.invalidationOutcome) {
    await invalidateCharacterAuthoritySourcesInTransaction(transaction, {
      characterId: transition.evidence.binding.characterId,
      now: transition.checkedAt,
      outcome: transition.invalidationOutcome,
    })
  }
}

export const createCorporationRoleConvergenceHook =
  (context: CorporationRoleConvergenceContext): CorporationRoleObservationHook =>
  (transaction, transition) =>
    convergeCorporationRoleTransitionInTransaction(transaction, transition, context)

export const repairCorporationRoleDependentAuthority = async (input: {
  readonly characterId: number
  readonly userId: string
  readonly organizationVersion: number
  readonly now?: Date
  readonly signal?: AbortSignal
}) => {
  input.signal?.throwIfAborted()
  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(${characterLockNamespace}, ${characterLockKey(input.characterId)})`,
    )
    const binding = await loadCurrentCorporationRoleBinding(transaction, input)
    if (binding?.organizationVersion !== input.organizationVersion) {
      return
    }
    const evaluation = await evaluateCorporationRoleEvidence(transaction, {
      binding,
      now: input.now,
      predicate: 'director',
      requiredScope: corporationRoleObservationRequiredScope,
    })
    if (evaluation.outcome === 'unsatisfied' && evaluation.evidence?.state === 'fresh') {
      await invalidateCharacterAuthoritySourcesInTransaction(transaction, {
        characterId: input.characterId,
        now: input.now,
        outcome: 'not-director',
      })
    }
  })
}
