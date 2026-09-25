import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { CharacterTokenNotFoundError } from '../auth/character-token-store.js'
import { EveSsoTokenRefreshError } from '../auth/sso.js'
import { ScopeRequiredError, TokenRefreshUnavailableError } from '../auth/token-errors.js'
import type { DatabaseTransaction } from '../db/client.js'
import { characterLockKey, characterLockNamespace } from '../db/locks.js'
import {
  characterCorporationRoleContents,
  characterCorporationRoleObservations,
  characters,
  deploymentSettings,
  eveTokens,
  platformSubjectLifecycles,
  type CorporationRoleObservationInvalidationOutcome,
} from '../db/schema.js'
import { appendDomainEvent } from '../domain-events/store.js'
import {
  classifyEsiRefreshFailure,
  EsiQuotaError,
  getEsiFailureStatus,
  isEsiOperationQuotaLimited,
} from '../esi-gateway/failures.js'
import {
  classifyCorporationRoleTransition,
  evaluateReviewedCorporationRolePredicates,
  resolveCorporationRoleRevision,
  type CorporationRoleSets,
  type CorporationRoleTransition,
  type ReviewedCorporationRolePredicate,
} from './corporation-role-canonical.js'
import {
  corporationRoleObservationRequiredScope,
  toCorporationRoleEvidence,
  type CorporationRoleEvidence,
  type CorporationRoleSourceBinding,
} from './corporation-role-evidence.js'
import { tombstoneCorporationRoleObservation } from './corporation-role-invalidation.js'
import {
  readCharacterCorporationRoles,
  type CharacterCorporationRolesRead,
} from './corporation-roles.js'

const minimumTransientRetryMilliseconds = 5 * 60 * 1000

type StrictCorporationRoleFailureClass = Extract<
  CorporationRoleObservationInvalidationOutcome,
  'authorization-missing' | 'authorization-rejected' | 'authorization-revoked' | 'missing-scope'
>

export type CorporationRoleFailure =
  | { readonly kind: 'strict'; readonly failureClass: StrictCorporationRoleFailureClass }
  | { readonly kind: 'transient'; readonly failureClass: string; readonly retryAt: Date | null }

export type CorporationRoleBootstrapIntent =
  | { readonly kind: 'organization-owner-claim'; readonly actorUserId: string }
  | { readonly kind: 'organization-owner-source-replacement'; readonly actorUserId: string }
  | {
      readonly kind: 'corporation-source-registration'
      readonly actorUserId: string
      readonly corporationId: number
    }
  | {
      readonly kind: 'corporation-source-replacement'
      readonly actorUserId: string
      readonly corporationId: number
      readonly replacedSourceId: string
    }

export type CorporationRoleAuthorityCheck = (
  transaction: DatabaseTransaction,
  binding: CorporationRoleSourceBinding,
) => Promise<boolean>

export type CorporationRoleObservationAuthority =
  | {
      readonly kind: 'demand'
      readonly expectedRoleRevision: string | null
      readonly isDemanded: CorporationRoleAuthorityCheck
    }
  | {
      readonly kind: 'bootstrap'
      readonly intent: CorporationRoleBootstrapIntent
      readonly authorize: CorporationRoleAuthorityCheck
    }

export interface CorporationRoleAttempt {
  readonly binding: CorporationRoleSourceBinding
  readonly sequence: bigint
  readonly affiliationFreshUntil: Date
  readonly outcome:
    | { readonly kind: 'observed'; readonly read: CharacterCorporationRolesRead }
    | { readonly kind: 'failed'; readonly failure: CorporationRoleFailure }
}

export interface CorporationRoleObservationTransition {
  readonly kind: 'observed' | 'retry-scheduled' | 'degraded' | 'invalidated'
  readonly authority: CorporationRoleObservationAuthority['kind']
  readonly checkedAt: Date
  readonly evidence: CorporationRoleEvidence
  readonly roleTransition: CorporationRoleTransition | null
  readonly previousRoleRevision: string | null
  readonly predicates: Readonly<Record<ReviewedCorporationRolePredicate, boolean>> | null
  readonly invalidationOutcome: CorporationRoleObservationInvalidationOutcome | null
}

export type CorporationRoleObservationHook = (
  transaction: DatabaseTransaction,
  transition: CorporationRoleObservationTransition,
) => Promise<void>

export type CorporationRolePersistenceResult =
  | { readonly status: 'accepted'; readonly transition: CorporationRoleObservationTransition }
  | { readonly status: 'superseded' | 'rejected' }

interface PersistenceContext {
  readonly transaction: DatabaseTransaction
  readonly attempt: CorporationRoleAttempt
  readonly binding: CorporationRoleSourceBinding
  readonly authority: CorporationRoleObservationAuthority
  readonly now: Date
  readonly observedAllianceId: number | null
  readonly freshDurationSeconds: number
  readonly staleGraceSeconds: number
}

type ObservationRow = typeof characterCorporationRoleObservations.$inferSelect
type ContentRow = typeof characterCorporationRoleContents.$inferSelect

interface CurrentObservation {
  readonly row: ObservationRow
  readonly content: CorporationRoleSets | null
}

export const classifyCorporationRoleFailure = (error: unknown): CorporationRoleFailure | null => {
  if (error instanceof ScopeRequiredError) {
    return { failureClass: 'missing-scope', kind: 'strict' }
  }
  if (error instanceof CharacterTokenNotFoundError) {
    return { failureClass: 'authorization-missing', kind: 'strict' }
  }
  if (error instanceof EveSsoTokenRefreshError) {
    return error.authorizationRevoked
      ? { failureClass: 'authorization-revoked', kind: 'strict' }
      : { failureClass: 'sso-unavailable', kind: 'transient', retryAt: null }
  }
  if (error instanceof EsiQuotaError) {
    return { failureClass: 'esi-cooldown', kind: 'transient', retryAt: error.retryAt }
  }
  if (error instanceof TokenRefreshUnavailableError) {
    return { failureClass: 'sso-unavailable', kind: 'transient', retryAt: null }
  }
  const status = getEsiFailureStatus(error)
  if (status === 401 || status === 403) {
    return { failureClass: 'authorization-rejected', kind: 'strict' }
  }
  const refreshFailure = classifyEsiRefreshFailure(error)
  if (refreshFailure === 'unknown') {
    return null
  }
  return { failureClass: refreshFailure, kind: 'transient', retryAt: null }
}

export const attemptCorporationRoleRead = async (input: {
  readonly binding: CorporationRoleSourceBinding
  readonly sequence: bigint
  readonly affiliationFreshUntil: Date
  readonly signal?: AbortSignal
}): Promise<CorporationRoleAttempt> => {
  input.signal?.throwIfAborted()
  const base = {
    affiliationFreshUntil: input.affiliationFreshUntil,
    binding: input.binding,
    sequence: input.sequence,
  }
  try {
    const read = await readCharacterCorporationRoles({
      affiliationPeriodRevision: input.binding.affiliationPeriodRevision,
      characterId: input.binding.characterId,
      subjectLifecycleId: input.binding.subjectLifecycleId,
      ...(input.signal && { signal: input.signal }),
    })
    input.signal?.throwIfAborted()
    if (read.stale) {
      return {
        ...base,
        outcome: {
          failure: {
            failureClass: 'stale-role-evidence',
            kind: 'transient',
            retryAt: read.retryAt,
          },
          kind: 'failed',
        },
      }
    }
    return { ...base, outcome: { kind: 'observed', read } }
  } catch (error) {
    input.signal?.throwIfAborted()
    const failure = classifyCorporationRoleFailure(error)
    if (!failure) {
      throw error
    }
    return { ...base, outcome: { failure, kind: 'failed' } }
  }
}

const lockCharacterObservation = async (transaction: DatabaseTransaction, characterId: number) => {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(${characterLockNamespace}, ${characterLockKey(characterId)})`,
  )
}

const loadCurrentBindingState = async (
  transaction: DatabaseTransaction,
  characterId: number,
  organizationLock: 'key share' | 'update',
) => {
  const [current] = await transaction
    .select({
      affiliationPeriodRevision: characters.affiliationPeriodRevision,
      affiliationResolutionState: characters.affiliationResolutionState,
      allianceId: characters.allianceId,
      corporationId: characters.corporationId,
      freshDurationSeconds: deploymentSettings.authorityEvidenceFreshDurationSeconds,
      organizationVersion: deploymentSettings.organizationVersion,
      scopes: eveTokens.scopes,
      staleGraceSeconds: deploymentSettings.staleEvidenceGraceDurationSeconds,
      subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
      tokenVersion: eveTokens.tokenVersion,
      userId: characters.userId,
    })
    .from(characters)
    .innerJoin(
      platformSubjectLifecycles,
      eq(platformSubjectLifecycles.characterId, characters.characterId),
    )
    .innerJoin(eveTokens, eq(eveTokens.characterId, characters.characterId))
    .innerJoin(deploymentSettings, eq(deploymentSettings.id, 1))
    .where(eq(characters.characterId, characterId))
    .for(organizationLock, { of: deploymentSettings })
  return current ?? null
}

const effectiveGeneration = (attempt: CorporationRoleAttempt, currentTokenVersion: number) =>
  attempt.outcome.kind === 'observed'
    ? attempt.outcome.read.authorizationGeneration
    : currentTokenVersion

const resolveEffectiveBinding = (
  attempt: CorporationRoleAttempt,
  current: NonNullable<Awaited<ReturnType<typeof loadCurrentBindingState>>>,
): CorporationRoleSourceBinding | null => {
  const planned = attempt.binding
  const generation = effectiveGeneration(attempt, current.tokenVersion)
  const matches =
    current.organizationVersion === planned.organizationVersion &&
    current.userId === planned.userId &&
    current.subjectLifecycleId === planned.subjectLifecycleId &&
    current.affiliationPeriodRevision === planned.affiliationPeriodRevision &&
    current.corporationId === planned.authorityCorporationId &&
    current.affiliationResolutionState === 'resolved' &&
    current.scopes.includes(corporationRoleObservationRequiredScope) &&
    current.tokenVersion === generation &&
    generation >= planned.authorizationGeneration
  return matches ? { ...planned, authorizationGeneration: generation } : null
}

const loadObservationFence = async (transaction: DatabaseTransaction, characterId: number) => {
  const [fence] = await transaction
    .select({
      sequence: sql<
        string | null
      >`max(${characterCorporationRoleObservations.lastAppliedObservationSequence})::text`,
    })
    .from(characterCorporationRoleObservations)
    .where(eq(characterCorporationRoleObservations.characterId, characterId))
  return fence?.sequence ? BigInt(fence.sequence) : 0n
}

const authorizeAttempt = async (
  transaction: DatabaseTransaction,
  authority: CorporationRoleObservationAuthority,
  binding: CorporationRoleSourceBinding,
) => {
  if (authority.kind === 'demand') {
    return authority.isDemanded(transaction, binding)
  }
  if (authority.intent.actorUserId !== binding.userId) {
    return false
  }
  return authority.authorize(transaction, binding)
}

const toRoleSets = (content: ContentRow | null): CorporationRoleSets | null =>
  content
    ? {
        roles: content.roles,
        rolesAtBase: content.rolesAtBase,
        rolesAtHeadquarters: content.rolesAtHeadquarters,
        rolesAtOther: content.rolesAtOther,
      }
    : null

const isSameBinding = (row: ObservationRow, binding: CorporationRoleSourceBinding) =>
  row.organizationVersion === binding.organizationVersion &&
  row.userId === binding.userId &&
  row.sourceSubjectLifecycleId === binding.subjectLifecycleId &&
  row.affiliationPeriodRevision === binding.affiliationPeriodRevision &&
  row.authorityCorporationId === binding.authorityCorporationId &&
  row.authorizationGeneration === binding.authorizationGeneration

const loadObservationRows = async (
  transaction: DatabaseTransaction,
  binding: CorporationRoleSourceBinding,
) => {
  const rows = await transaction
    .select()
    .from(characterCorporationRoleObservations)
    .where(
      and(
        eq(characterCorporationRoleObservations.deploymentId, 1),
        eq(characterCorporationRoleObservations.organizationVersion, binding.organizationVersion),
        eq(characterCorporationRoleObservations.characterId, binding.characterId),
      ),
    )
    .for('update')
  const current = rows.find(({ status }) => status !== 'invalid') ?? null
  const exact = rows.find((row) => isSameBinding(row, binding)) ?? null
  const [content] = current
    ? await transaction
        .select()
        .from(characterCorporationRoleContents)
        .where(eq(characterCorporationRoleContents.observationId, current.observationId))
        .for('update')
    : []
  return {
    current: current ? { content: toRoleSets(content ?? null), row: current } : null,
    exact,
  }
}

const replacedBindingOutcome = (
  row: ObservationRow,
  binding: CorporationRoleSourceBinding,
): CorporationRoleObservationInvalidationOutcome => {
  if (row.userId !== binding.userId) {
    return 'transferred'
  }
  if (row.sourceSubjectLifecycleId !== binding.subjectLifecycleId) {
    return 'lifecycle-replaced'
  }
  if (row.authorizationGeneration !== binding.authorizationGeneration) {
    return 'authorization-generation-changed'
  }
  return 'affiliation-changed'
}

const bindingColumns = (binding: CorporationRoleSourceBinding) => ({
  affiliationPeriodRevision: binding.affiliationPeriodRevision,
  authorityCorporationId: binding.authorityCorporationId,
  authorizationGeneration: binding.authorizationGeneration,
  characterId: binding.characterId,
  deploymentId: 1,
  organizationVersion: binding.organizationVersion,
  requiredScope: corporationRoleObservationRequiredScope,
  sourceSubjectLifecycleId: binding.subjectLifecycleId,
  userId: binding.userId,
})

const writeObservationRow = async (
  transaction: DatabaseTransaction,
  target: ObservationRow | null,
  binding: CorporationRoleSourceBinding,
  values: Partial<typeof characterCorporationRoleObservations.$inferInsert> & {
    readonly status: ObservationRow['status']
    readonly lastCheckedAt: Date
    readonly lastAppliedObservationSequence: bigint
  },
) => {
  if (target) {
    const [row] = await transaction
      .update(characterCorporationRoleObservations)
      .set(values)
      .where(eq(characterCorporationRoleObservations.observationId, target.observationId))
      .returning()
    return row!
  }
  const [row] = await transaction
    .insert(characterCorporationRoleObservations)
    .values({ ...bindingColumns(binding), ...values })
    .returning()
  return row!
}

const earliest = (first: Date, ...others: readonly Date[]) =>
  new Date(Math.min(first.getTime(), ...others.map((date) => date.getTime())))

const transientRetryAt = (failure: { readonly retryAt: Date | null }, now: Date) => {
  const minimum = now.getTime() + minimumTransientRetryMilliseconds
  return new Date(Math.max(minimum, failure.retryAt?.getTime() ?? 0))
}

const appendRoleChangeEvent = async (
  transaction: DatabaseTransaction,
  input: {
    readonly transition: CorporationRoleTransition
    readonly binding: CorporationRoleSourceBinding
    readonly previousRoleRevision: string
    readonly roleRevision: string
    readonly occurredAt: Date
  },
) => {
  if (input.transition !== 'lost' && input.transition !== 'gained') {
    return
  }
  await appendDomainEvent(transaction, {
    aggregateId: String(input.binding.characterId),
    occurredAt: input.occurredAt,
    payload: {
      affiliationPeriodRevision: input.binding.affiliationPeriodRevision,
      authorityCorporationId: input.binding.authorityCorporationId,
      authorizationGeneration: input.binding.authorizationGeneration,
      characterId: input.binding.characterId,
      currentRoleRevision: input.roleRevision,
      organizationVersion: input.binding.organizationVersion,
      previousRoleRevision: input.previousRoleRevision,
      subjectLifecycleId: input.binding.subjectLifecycleId,
      userId: input.binding.userId,
    },
    payloadVersion: 1,
    type:
      input.transition === 'lost'
        ? 'character.corporation-role-loss-confirmed'
        : 'character.corporation-roles-changed',
  })
}

const writeRoleContent = async (
  transaction: DatabaseTransaction,
  observationId: string,
  sets: CorporationRoleSets,
  now: Date,
) => {
  const values = {
    roles: [...sets.roles],
    rolesAtBase: [...sets.rolesAtBase],
    rolesAtHeadquarters: [...sets.rolesAtHeadquarters],
    rolesAtOther: [...sets.rolesAtOther],
    updatedAt: now,
  }
  await transaction
    .insert(characterCorporationRoleContents)
    .values({ observationId, ...values })
    .onConflictDoUpdate({ set: values, target: characterCorporationRoleContents.observationId })
}

const toEvidenceDto = (row: ObservationRow, now: Date) =>
  toCorporationRoleEvidence(
    {
      affiliationPeriodRevision: row.affiliationPeriodRevision,
      authorityCorporationId: row.authorityCorporationId,
      authorizationGeneration: row.authorizationGeneration,
      characterId: row.characterId,
      degradedUntil: row.degradedUntil,
      freshUntil: row.freshUntil,
      nextRefreshAt: row.nextRefreshAt,
      organizationVersion: row.organizationVersion,
      roleRevision: row.roleRevision,
      status: row.status,
      subjectLifecycleId: row.sourceSubjectLifecycleId,
      userId: row.userId,
      validatedAt: row.validatedAt,
    },
    now,
  )

const failureTransition = (
  context: PersistenceContext,
  row: ObservationRow,
  kind: CorporationRoleObservationTransition['kind'],
  current: CurrentObservation | null,
): CorporationRoleObservationTransition => ({
  authority: context.authority.kind,
  checkedAt: context.now,
  evidence: toEvidenceDto(row, context.now),
  invalidationOutcome: row.invalidationOutcome,
  kind,
  predicates:
    kind !== 'invalidated' && current?.content
      ? evaluateReviewedCorporationRolePredicates(current.content)
      : null,
  previousRoleRevision: current?.row.roleRevision ?? null,
  roleTransition: null,
})

const applyStrictFailure = async (
  context: PersistenceContext,
  failure: Extract<CorporationRoleFailure, { kind: 'strict' }>,
  state: { readonly current: CurrentObservation | null; readonly exact: ObservationRow | null },
) => {
  const target =
    state.current?.row ??
    state.exact ??
    (await writeObservationRow(context.transaction, null, context.binding, {
      failureClass: `strict:${failure.failureClass}`,
      invalidatedAt: context.now,
      invalidationOutcome: failure.failureClass,
      lastAppliedObservationSequence: context.attempt.sequence,
      lastCheckedAt: context.now,
      roleRevision: randomUUID(),
      status: 'invalid',
      updatedAt: context.now,
    }))
  const row = await tombstoneCorporationRoleObservation(context.transaction, {
    now: context.now,
    observationId: target.observationId,
    outcome: failure.failureClass,
    sequence: context.attempt.sequence,
  })
  return row ? failureTransition(context, row, 'invalidated', state.current) : null
}

const applyTransientFailure = async (
  context: PersistenceContext,
  failure: Extract<CorporationRoleFailure, { kind: 'transient' }>,
  state: { readonly current: CurrentObservation | null; readonly exact: ObservationRow | null },
) => {
  const { now, transaction } = context
  const failureClass = `transient:${failure.failureClass}`
  const retryAt = transientRetryAt(failure, now)
  const target = state.current?.row ?? null
  const sequence = context.attempt.sequence
  if (!target?.freshUntil) {
    if (state.exact?.invalidationOutcome === 'expired') {
      const row = await writeObservationRow(transaction, state.exact, context.binding, {
        lastAppliedObservationSequence: sequence,
        lastCheckedAt: now,
        status: 'invalid',
        updatedAt: now,
      })
      return failureTransition(context, row, 'invalidated', state.current)
    }
    if (context.authority.kind === 'bootstrap' || state.exact?.status === 'invalid') {
      return null
    }
    const row = await writeObservationRow(transaction, target ?? state.exact, context.binding, {
      observedAllianceId: context.observedAllianceId,
      degradedUntil: null,
      esiFreshUntil: null,
      failureClass,
      freshUntil: null,
      invalidatedAt: null,
      invalidationOutcome: null,
      lastAppliedObservationSequence: sequence,
      lastCheckedAt: now,
      nextRefreshAt: retryAt,
      roleRevision: null,
      status: 'pending',
      updatedAt: now,
      validatedAt: null,
    })
    return failureTransition(context, row, 'retry-scheduled', state.current)
  }
  if (now < target.freshUntil) {
    const row = await writeObservationRow(transaction, target, context.binding, {
      failureClass,
      lastAppliedObservationSequence: sequence,
      lastCheckedAt: now,
      nextRefreshAt: retryAt,
      status: 'fresh',
      updatedAt: now,
    })
    return failureTransition(context, row, 'retry-scheduled', state.current)
  }
  const degradedUntil =
    target.degradedUntil ?? new Date(target.freshUntil.getTime() + context.staleGraceSeconds * 1000)
  if (now >= degradedUntil) {
    const row = await tombstoneCorporationRoleObservation(transaction, {
      now,
      observationId: target.observationId,
      outcome: 'expired',
      sequence,
    })
    return row ? failureTransition(context, row, 'invalidated', state.current) : null
  }
  const row = await writeObservationRow(transaction, target, context.binding, {
    degradedUntil,
    failureClass,
    lastAppliedObservationSequence: sequence,
    lastCheckedAt: now,
    nextRefreshAt: retryAt,
    status: 'degraded',
    updatedAt: now,
  })
  return failureTransition(context, row, 'degraded', state.current)
}

const applyFailure = (
  context: PersistenceContext,
  failure: CorporationRoleFailure,
  state: { readonly current: CurrentObservation | null; readonly exact: ObservationRow | null },
) =>
  failure.kind === 'strict'
    ? applyStrictFailure(context, failure, state)
    : applyTransientFailure(context, failure, state)

const applyObservedRoles = async (
  context: PersistenceContext,
  read: CharacterCorporationRolesRead,
  state: { readonly current: CurrentObservation | null; readonly exact: ObservationRow | null },
): Promise<CorporationRoleObservationTransition | null> => {
  const { binding, now, transaction } = context
  const freshUntil = earliest(
    read.cachedUntil,
    context.attempt.affiliationFreshUntil,
    new Date(read.validatedAt.getTime() + context.freshDurationSeconds * 1000),
  )
  if (freshUntil <= now || freshUntil <= read.validatedAt) {
    return applyFailure(
      context,
      { failureClass: 'stale-role-evidence', kind: 'transient', retryAt: read.cachedUntil },
      state,
    )
  }
  const previous = state.current?.content ?? null
  const previousRoleRevision = previous ? (state.current?.row.roleRevision ?? null) : null
  const roleTransition = classifyCorporationRoleTransition(previous, read.roles)
  const roleRevision = resolveCorporationRoleRevision({
    currentRevision: previousRoleRevision,
    generateRevision: randomUUID,
    transition: roleTransition,
  })
  const row = await writeObservationRow(transaction, state.current?.row ?? state.exact, binding, {
    degradedUntil: null,
    esiFreshUntil: read.cachedUntil,
    failureClass: null,
    freshUntil,
    invalidatedAt: null,
    invalidationOutcome: null,
    lastAppliedObservationSequence: context.attempt.sequence,
    lastCheckedAt: now,
    nextRefreshAt: new Date(Math.max(read.cachedUntil.getTime(), now.getTime())),
    observedAllianceId: context.observedAllianceId,
    roleRevision,
    status: 'fresh',
    updatedAt: now,
    validatedAt: read.validatedAt,
  })
  await writeRoleContent(transaction, row.observationId, read.roles, now)
  if (previousRoleRevision) {
    await appendRoleChangeEvent(transaction, {
      binding,
      occurredAt: now,
      previousRoleRevision,
      roleRevision,
      transition: roleTransition,
    })
  }
  return {
    authority: context.authority.kind,
    checkedAt: now,
    evidence: toEvidenceDto(row, now),
    invalidationOutcome: null,
    kind: 'observed',
    predicates: evaluateReviewedCorporationRolePredicates(read.roles),
    previousRoleRevision,
    roleTransition,
  }
}

const retireReplacedBinding = async (
  context: PersistenceContext,
  state: { readonly current: CurrentObservation | null; readonly exact: ObservationRow | null },
) => {
  const current = state.current
  if (!current || isSameBinding(current.row, context.binding)) {
    return state
  }
  await tombstoneCorporationRoleObservation(context.transaction, {
    now: context.now,
    observationId: current.row.observationId,
    outcome: replacedBindingOutcome(current.row, context.binding),
    sequence: context.attempt.sequence,
  })
  return { current: null, exact: state.exact }
}

const expectedRevisionMatches = (
  authority: CorporationRoleObservationAuthority,
  current: CurrentObservation | null,
  exact: ObservationRow | null,
) =>
  authority.kind !== 'demand' ||
  authority.expectedRoleRevision ===
    (current?.row.roleRevision ??
      (exact?.invalidationOutcome === 'expired' ? exact.roleRevision : null))

export const persistCorporationRoleAttemptInTransaction = async (
  transaction: DatabaseTransaction,
  attempt: CorporationRoleAttempt,
  options: {
    readonly authority: CorporationRoleObservationAuthority
    readonly afterPersist?: CorporationRoleObservationHook
    readonly now?: Date
    readonly signal?: AbortSignal
  },
): Promise<CorporationRolePersistenceResult> => {
  if (options.authority.kind === 'bootstrap' && attempt.outcome.kind !== 'observed') {
    return { status: 'rejected' }
  }
  await lockCharacterObservation(transaction, attempt.binding.characterId)
  options.signal?.throwIfAborted()
  const currentState = await loadCurrentBindingState(
    transaction,
    attempt.binding.characterId,
    options.authority.kind === 'bootstrap' ? 'update' : 'key share',
  )
  const binding = currentState ? resolveEffectiveBinding(attempt, currentState) : null
  if (!currentState || !binding) {
    return { status: 'superseded' }
  }
  if ((await loadObservationFence(transaction, binding.characterId)) >= attempt.sequence) {
    return { status: 'superseded' }
  }
  if (!(await authorizeAttempt(transaction, options.authority, binding))) {
    return { status: 'rejected' }
  }
  options.signal?.throwIfAborted()
  const context: PersistenceContext = {
    attempt,
    authority: options.authority,
    binding,
    freshDurationSeconds: currentState.freshDurationSeconds,
    now: options.now ?? new Date(),
    observedAllianceId: currentState.allianceId,
    staleGraceSeconds: currentState.staleGraceSeconds,
    transaction,
  }
  const state = await retireReplacedBinding(
    context,
    await loadObservationRows(transaction, binding),
  )
  if (!expectedRevisionMatches(options.authority, state.current, state.exact)) {
    return { status: 'superseded' }
  }
  const transition =
    attempt.outcome.kind === 'observed'
      ? await applyObservedRoles(context, attempt.outcome.read, state)
      : await applyFailure(context, attempt.outcome.failure, state)
  if (!transition) {
    return { status: 'rejected' }
  }
  options.signal?.throwIfAborted()
  await options.afterPersist?.(transaction, transition)
  options.signal?.throwIfAborted()
  return { status: 'accepted', transition }
}

export const corporationRoleCooldownActive = () =>
  isEsiOperationQuotaLimited('character-corporation-roles')
