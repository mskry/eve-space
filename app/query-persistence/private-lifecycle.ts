import type { AuthSession, CacheAdmissionContext, CacheAdmissionBootstrap } from '../queries/auth'
import {
  combineInvalidationScopes,
  emptyEnvelope,
  isExpired,
  parseCacheAdmissionContext,
  serializePersistedEnvelope,
  type EsiQueryCacheEnvelope,
  type PersistedQueryCache,
  type PrivateEsiQuery,
  type PrivateQueryInvalidationScope,
  type SerializedEnvelopeResult,
} from './envelope'
import type { QueryPersistenceNotifications } from './notifications'
import type { QueryPersistenceStorage, QueryPersistenceStorageWrite } from './storage'
import {
  initialScopeWatermarks,
  scopesSinceGeneration,
  type ScopeWatermarks,
} from './scope-watermarks'

const PRIVATE_ADMISSION_MAX_AGE_MS = 30_000
const PRIVATE_ADMISSION_RENEWAL_LEAD_MS = 5000
const MAX_TIMEOUT_MS = 2_147_483_647

export interface QueryPersistenceTimers {
  clearTimeout(timer: ReturnType<typeof setTimeout>): void
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>
}

interface PrivateQueryLifecycleHost {
  applyVerifiedSession(session: AuthSession, ownerMatches: boolean): void
  clearCorruptCache(envelope: EsiQueryCacheEnvelope): void
  closeAndPurge(
    scope: PrivateQueryInvalidationScope,
    preserveErrors: boolean,
    preserveFreshSuccesses: boolean,
    preserveSession: boolean,
    requireOrganizationReadiness: boolean,
  ): void
  collectAdmittedCache(admission: CacheAdmissionContext, now: number): PersistedQueryCache
  commitAdmittedCache(cache: PersistedQueryCache, now: number): void
  commitSerializedEnvelope(result: SerializedEnvelopeResult): void
  hasCharacterData(): boolean
  hasFailedData(keyHash: string): boolean
  hasQuarantinedData(keyHash: string): boolean
  hasRetainedPrivateData(activeOnly: boolean): boolean
  isAuthenticationDenial(error: unknown): boolean
  isRemovalTombstoned(keyHash: string): boolean
  isRestorationSettled(): boolean
  readCachedUserId(): string | null
  readEnvelope(): EsiQueryCacheEnvelope
  readOriginalSuccessTime(keyHash: string): number | undefined
  readPersistedPrivateOwner(): string | null
  refetchParkedPrivateQueries(): void
  quarantineRetainedData(): void
  quarantineCharacter(characterId: number): void
  quarantineUnscopedData(): void
  restoreUnscopedData(admission: CacheAdmissionContext): void
  reconcileRetainedData(): void
  resolveAdmissionInvalidationScopes(
    admission: CacheAdmissionContext,
    previousAdmission: CacheAdmissionContext | null,
    now: number,
    alreadyInvalidatedScope?: PrivateQueryInvalidationScope,
  ): readonly PrivateQueryInvalidationScope[]
  serializerMerged(successfulTimes: ReadonlyMap<string, number>): void
  setEnvelope(envelope: EsiQueryCacheEnvelope): void
  touch(): void
  waitForHydration(): Promise<void>
  waitForRestoration(): Promise<void>
}

export interface PrivateQueryLifecycleOptions {
  readonly document?: Document
  readonly host: PrivateQueryLifecycleHost
  readonly notifications: QueryPersistenceNotifications
  readonly now: () => number
  readonly storage: QueryPersistenceStorage
  readonly timers: QueryPersistenceTimers
  readonly window?: Window
}

type AdmissionLoader = (signal?: AbortSignal) => Promise<CacheAdmissionContext>
type PersistedColadaCache = Parameters<typeof serializePersistedEnvelope>[0]
type DurableInvalidation = Awaited<ReturnType<QueryPersistenceStorage['invalidate']>>

const scopesForInvalidation = (invalidation: DurableInvalidation, previousGeneration: number) => {
  if (!invalidation) {
    return [{ kind: 'all' } as const]
  }
  return invalidation.generation === previousGeneration + 1
    ? [invalidation.scope]
    : scopesSinceGeneration(invalidation.scopeHistory, previousGeneration)
}

const scopesToReconcile = (
  invalidation: NonNullable<DurableInvalidation>,
  previousGeneration: number,
  requested: PrivateQueryInvalidationScope,
  changedScopes: readonly PrivateQueryInvalidationScope[],
) => {
  if (invalidation.generation !== previousGeneration + 1) {
    return changedScopes
  }
  return invalidation.scope.kind === 'all' && requested.kind !== 'all'
    ? [{ kind: 'all' } as const]
    : []
}

const scopesForAdmission = (
  admission: CacheAdmissionContext,
  candidates: readonly PrivateQueryInvalidationScope[],
): readonly PrivateQueryInvalidationScope[] => {
  const unique = [...new Map(candidates.map((scope) => [JSON.stringify(scope), scope])).values()]
  if (
    admission.characters.some(
      (character) => 'status' in character && character.status === 'temporarily-unavailable',
    )
  ) {
    const organizationWide = unique.some(
      (scope) => scope.kind === 'organization' && scope.admissionScope === undefined,
    )
    return organizationWide
      ? unique.filter(
          (scope) => scope.kind !== 'organization' || scope.admissionScope === undefined,
        )
      : unique
  }
  const combined = combineInvalidationScopes(unique)
  return combined ? [combined] : []
}

const quarantinePendingCharacters = (
  admission: CacheAdmissionContext,
  quarantine: (characterId: number) => void,
) => {
  for (const character of admission.characters) {
    if ('status' in character && character.status === 'temporarily-unavailable') {
      quarantine(character.characterId)
    }
  }
}

interface AdmissionAttempt {
  readonly alreadyInvalidatedScope?: PrivateQueryInvalidationScope
  epoch: number
  readonly id: symbol
  readonly ownerUserId: string
  readonly previousAdmission: CacheAdmissionContext | null
  readonly previousDeadline: number
  readonly requestedRefreshScope?: PrivateQueryInvalidationScope
  readonly signal?: AbortSignal
  readonly startedAt: number
}

interface PendingAdmissionRequest {
  readonly attempt: AdmissionAttempt
  readonly promise: Promise<boolean>
}

type DurableGenerationProbe =
  | { readonly kind: 'verified'; readonly generation: number }
  | { readonly kind: 'unusable' }
  | { readonly kind: 'superseded' }

interface LifecycleGuard {
  readonly epoch: number
  readonly generation: number
}

export function createPrivateQueryLifecycle(options: PrivateQueryLifecycleOptions) {
  const { host, notifications, now, storage, timers } = options
  let activeAdmission: CacheAdmissionContext | null = null
  let activeAdmissionDeadline = 0
  let activeAdmissionMayRenew = true
  let admissionExpiryTimer: ReturnType<typeof setTimeout> | undefined
  let admissionLoader: (() => Promise<CacheAdmissionContext>) | undefined
  let admissionRenewalTimer: ReturnType<typeof setTimeout> | undefined
  let pendingRetryTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let durableInvalidationEpoch: number | null = null
  let durableGenerationVerified = false
  // Live admission may recover after a failed organization invalidation, but old disk partitions
  // remain ineligible until a later organization-wide or full durable fence commits.
  let durableOrganizationFencePending = false
  let identityAttempt = 0
  let identityCommitDepth = 0
  let invalidationGeneration = 0
  // The comparison baseline for admission changes. It outlives suspension and purges, which clear
  // activeAdmission, and is dropped only on logout, owner change, or an authoritative denial.
  let lastAcceptedAdmission: CacheAdmissionContext | null = null
  let lifecycleCheck: Promise<boolean> | undefined
  let lifecycleRecheckRequested = false
  let listenersInstalled = false
  let parkedRefetchPending = false
  let organizationTransitionAttempt = 0
  let pendingAdmissionRequest: PendingAdmissionRequest | undefined
  let pendingCharacters = new Set<number>()
  let privateLifecycleEpoch = 0
  let privatePersistenceEnabled = true
  let retainedPrivateAccessOpen = false
  let verifiedUserId: string | null = null
  const cleanup = new Set<() => void>()

  const lifecycle = {
    applyRestoredEnvelope(envelope: EsiQueryCacheEnvelope) {
      if (disposed) {
        return
      }
      const privateRestoreAllowed =
        durableGenerationVerified &&
        privatePersistenceEnabled &&
        envelope.invalidationGeneration === invalidationGeneration
      host.setEnvelope(
        privateRestoreAllowed
          ? envelope
          : {
              ...envelope,
              invalidationGeneration,
              characters: {},
              organizations: {},
            },
      )
    },
    applyVerifiedIdentity(
      session: AuthSession,
      loadAdmission?: AdmissionLoader,
      signal?: AbortSignal,
      admission?: CacheAdmissionBootstrap,
    ): Promise<boolean> {
      if (identityCommitDepth > 0) {
        return Promise.resolve(hasRetainedPrivateAccess(undefined, now()))
      }
      const attempt = ++identityAttempt
      if (host.isRestorationSettled()) {
        return applyRestoredVerifiedIdentity(session, loadAdmission, signal, attempt, admission)
      }
      return host.waitForRestoration().then(() => {
        if (!identityAttemptIsCurrent(attempt)) {
          return false
        }
        return applyRestoredVerifiedIdentity(session, loadAdmission, signal, attempt, admission)
      })
    },
    async clearCorruptCache() {
      if (disposed) {
        return false
      }
      const epoch = closeAndPurgePrivateCache({ kind: 'all' }, false)
      host.clearCorruptCache(emptyEnvelope(invalidationGeneration))
      try {
        await storage.removeEnvelope()
      } catch {
        if (!disposed && epoch === privateLifecycleEpoch) {
          disablePrivatePersistence()
        }
        return false
      }
      return !disposed && epoch === privateLifecycleEpoch
    },
    disablePersistence() {
      disablePrivatePersistence()
    },
    dispose() {
      if (disposed) {
        return
      }
      disposed = true
      identityAttempt += 1
      privateLifecycleEpoch += 1
      durableInvalidationEpoch = null
      lastAcceptedAdmission = null
      pendingCharacters.clear()
      parkedRefetchPending = false
      retainedPrivateAccessOpen = false
      clearAdmissionTimers()
      host.touch()
      for (const dispose of cleanup) {
        dispose()
      }
      cleanup.clear()
      notifications.dispose()
    },
    guardPrivateRequest() {
      const epoch = privateLifecycleEpoch
      return () => !disposed && epoch === privateLifecycleEpoch
    },
    hasCurrentAdmission(persistence?: PrivateEsiQuery) {
      const currentTime = now()
      host.reconcileRetainedData()
      return hasRetainedPrivateAccess(persistence, currentTime)
    },
    hasPendingVerification(characterId: number | undefined) {
      return characterId !== undefined && pendingCharacters.has(characterId)
    },
    installListeners() {
      if (listenersInstalled || disposed) {
        return
      }
      listenersInstalled = true
      initializeLifecycleListeners()
    },
    invalidate(
      scope: PrivateQueryInvalidationScope,
      preserveErrors = false,
      preserveFreshSuccesses = false,
    ) {
      return invalidatePrivateCache(scope, preserveErrors, false, undefined, preserveFreshSuccesses)
    },
    async transitionOrganization(afterClose: () => void) {
      const attempt = ++organizationTransitionAttempt
      const invalidated = await invalidatePrivateCache(
        { kind: 'organization' },
        false,
        false,
        afterClose,
      )
      if (!disposed && attempt === organizationTransitionAttempt) {
        durableOrganizationFencePending = !invalidated
        if (!invalidated) {
          durableGenerationVerified = false
          privatePersistenceEnabled = false
        }
        host.touch()
      }
      return invalidated
    },
    ownsCharacter(characterId: number | undefined) {
      return (
        !disposed &&
        admissionIsCurrent(now()) &&
        activeAdmission?.userId === verifiedUserId &&
        activeAdmission.characters.some((character) => character.characterId === characterId)
      )
    },
    async readStoredEnvelope() {
      const guard = lifecycleGuard()
      try {
        const result = await storage.read()
        if (disposed) {
          return null
        }
        if (!guardIsCurrent(guard)) {
          return result.value
        }
        applyStorageGeneration(result.generation, result.scopeHistory)
        return result.value
      } catch (error) {
        if (!guardIsCurrent(guard)) {
          return null
        }
        disablePrivatePersistence()
        throw error
      }
    },
    async refreshAdmission(scope: PrivateQueryInvalidationScope) {
      if (scope.kind === 'organization') {
        const expectedIdentityAttempt = identityAttempt
        const invalidated = await invalidatePrivateCache(scope, false)
        if (
          !invalidated ||
          !identityAttemptIsCurrent(expectedIdentityAttempt) ||
          !admissionLoader
        ) {
          return false
        }
        return requestAdmission(admissionLoader, scope)
      }
      if (!admissionLoader || verifiedUserId === null) {
        return false
      }
      return requestAdmission(
        admissionLoader,
        undefined,
        lastAcceptedAdmission,
        undefined,
        undefined,
        scope,
      )
    },
    async reacquireOrganizationAdmission() {
      if (!admissionLoader || verifiedUserId === null) {
        return null
      }
      await requestAdmission(admissionLoader, { kind: 'organization' })
      return activeAdmission?.userId === verifiedUserId && admissionIsCurrent(now())
        ? activeAdmission
        : null
    },
    refreshAdmissionTimers() {
      scheduleAdmissionExpiry()
    },
    removeStoredEnvelope() {
      if (disposed) {
        return Promise.resolve()
      }
      return storage.removeEnvelope()
    },
    runIfActive(effect: () => void) {
      if (!disposed) {
        effect()
      }
    },
    serialize(cache: PersistedColadaCache) {
      const currentTime = now()
      const result = serializePersistedEnvelope(cache, {
        admission: activeAdmission,
        durableGenerationVerified,
        generation: invalidationGeneration,
        hasFailedData: host.hasFailedData,
        hasQuarantinedData: host.hasQuarantinedData,
        isRemovalTombstoned: host.isRemovalTombstoned,
        now: currentTime,
        priorEnvelope: host.readEnvelope(),
        privatePersistenceEnabled: privatePersistenceEnabled && !disposed,
        readOriginalSuccessTime: host.readOriginalSuccessTime,
        retainedPrivateAccessOpen: hasRetainedPrivateAccess(undefined, currentTime),
        verifiedUserId,
      })
      if (!disposed) {
        host.serializerMerged(result.acceptedSuccessfulTimes)
        host.commitSerializedEnvelope(result)
        host.touch()
      }
      return result.serialized
    },
    suspendAdmission() {
      if (!disposed) {
        suspendPrivateAdmission()
      }
    },
    async writeStoredEnvelope(value: string) {
      if (!storage.available || disposed) {
        return
      }
      const guard = lifecycleGuard()
      const privateWriteRequested = durableGenerationVerified && privatePersistenceEnabled
      let result: QueryPersistenceStorageWrite
      try {
        result = await storage.write(value, privateWriteRequested)
      } catch (error) {
        if (guardIsCurrent(guard) && privateWriteRequested) {
          disablePrivatePersistence()
        }
        throw error
      }
      if (!guardIsCurrent(guard)) {
        return
      }
      applyStorageWrite(result, privateWriteRequested)
    },
  }

  async function applyRestoredVerifiedIdentity(
    session: AuthSession,
    loadAdmission: AdmissionLoader | undefined,
    signal: AbortSignal | undefined,
    attempt: number,
    admission?: CacheAdmissionBootstrap,
  ): Promise<boolean> {
    const nextUserId = authenticatedUserId(session)
    const ownerChanged = commitVerifiedIdentity(session, nextUserId)
    admissionLoader = nextUserId !== null && loadAdmission ? () => loadAdmission() : undefined

    if (ownerChanged) {
      const epoch = privateLifecycleEpoch
      await advanceInvalidationGeneration({ kind: 'all' }, epoch)
      if (!identityAttemptIsCurrent(attempt) || epoch !== privateLifecycleEpoch) {
        return false
      }
    }
    if (!identityAttemptIsCurrent(attempt) || nextUserId === null) {
      return false
    }
    if (!loadAdmission) {
      await rejectAdmission()
      return false
    }
    return requestAdmission(
      () => loadAdmission(signal),
      undefined,
      lastAcceptedAdmission,
      signal,
      admission,
    )
  }

  function commitVerifiedIdentity(session: AuthSession, nextOwner: string | null) {
    const cachedOwner = host.readCachedUserId()
    const persistedOwner = verifiedUserId ?? host.readPersistedPrivateOwner()
    const ownerMatches =
      nextOwner !== null &&
      (persistedOwner ?? cachedOwner ?? (host.hasCharacterData() ? null : nextOwner)) === nextOwner

    verifiedUserId = nextOwner
    if (!ownerMatches) {
      lastAcceptedAdmission = null
      pendingCharacters.clear()
    }
    identityCommitDepth += 1
    try {
      if (!ownerMatches) {
        closeAndPurgePrivateCache({ kind: 'all' }, false)
      }
      host.applyVerifiedSession(session, ownerMatches)
    } finally {
      identityCommitDepth -= 1
    }
    if (nextOwner === null) {
      admissionLoader = undefined
    }
    host.touch()
    return !ownerMatches
  }

  function requestAdmission(
    loadAdmission: () => Promise<CacheAdmissionContext>,
    alreadyInvalidatedScope?: PrivateQueryInvalidationScope,
    previousAdmission = lastAcceptedAdmission,
    signal?: AbortSignal,
    bootstrap?: CacheAdmissionBootstrap,
    requestedRefreshScope?: PrivateQueryInvalidationScope,
  ): Promise<boolean> {
    const epoch = privateLifecycleEpoch
    if (
      pendingAdmissionRequest?.attempt.epoch === epoch &&
      pendingAdmissionRequest.attempt.ownerUserId === verifiedUserId &&
      !pendingAdmissionRequest.attempt.signal?.aborted
    ) {
      return pendingAdmissionRequest.promise
    }
    if (disposed || verifiedUserId === null) {
      return Promise.resolve(false)
    }

    const attempt: AdmissionAttempt = {
      alreadyInvalidatedScope,
      epoch,
      id: Symbol('private-admission-attempt'),
      ownerUserId: verifiedUserId,
      previousAdmission,
      previousDeadline: activeAdmissionDeadline,
      requestedRefreshScope,
      signal,
      startedAt: bootstrap?.requestedAt ?? now(),
    }
    let promise!: Promise<boolean>
    promise = (async () => {
      try {
        const value = await Promise.resolve().then(() =>
          bootstrap ? bootstrap.context : loadAdmission(),
        )
        if (!admissionAttemptIsCurrent(attempt)) {
          return false
        }
        if (value === null) {
          suspendPrivateAdmission()
          return false
        }
        return await admitPrivateCache(value, attempt)
      } catch (error) {
        if (!admissionAttemptIsCurrent(attempt)) {
          return false
        }
        if (host.isAuthenticationDenial(error)) {
          await rejectAdmission()
        } else {
          suspendPrivateAdmission()
        }
        return false
      } finally {
        if (!disposed && pendingAdmissionRequest?.attempt.id === attempt.id) {
          pendingAdmissionRequest = undefined
        }
      }
    })()
    pendingAdmissionRequest = { attempt, promise }
    return promise
  }

  async function admitPrivateCache(
    value: CacheAdmissionContext,
    attempt: AdmissionAttempt,
  ): Promise<boolean> {
    const validated = await validateAdmission(value, attempt)
    if (!validated) {
      return false
    }
    const { admission, deadline } = validated

    retainedPrivateAccessOpen = false
    host.touch()
    if (!storage.available || durableOrganizationFencePending) {
      applyAdmissionWithoutPersistence(admission, deadline)
      return false
    }
    const durableGeneration = await verifyDurableGeneration(() =>
      admissionAttemptIsCurrent(attempt),
    )
    if (durableGeneration.kind === 'superseded' || now() >= deadline) {
      return false
    }
    if (durableGeneration.kind === 'unusable') {
      // Durable persistence is unusable rather than the admission invalid: it still authorizes live
      // requests, while retained data stays closed and no cache is committed until a later probe
      // verifies the generation. Disabling persistence advanced the epoch itself, so the attempt is
      // deliberately not re-checked here.
      applyAdmissionWithoutPersistence(admission, deadline)
      return false
    }
    if (!admissionAttemptIsCurrent(attempt)) {
      return false
    }

    const currentTime = now()
    host.reconcileRetainedData()
    if (!admissionAttemptIsCurrent(attempt) || currentTime >= deadline) {
      return false
    }
    if (!(await applyAdmissionInvalidation(attempt, admission, currentTime, deadline))) {
      return false
    }

    activeAdmission = admission
    updatePendingCharacters(admission)
    lastAcceptedAdmission = preservePendingBaselines(attempt.previousAdmission, admission)
    activeAdmissionDeadline = deadline
    activeAdmissionMayRenew = admissionMayRenew(attempt.previousDeadline, deadline, admission)
    const admittedCache = host.collectAdmittedCache(admission, now())

    return finishPrivateAdmission(attempt, admission, deadline, admittedCache)
  }

  async function validateAdmission(value: CacheAdmissionContext, attempt: AdmissionAttempt) {
    if (!admissionAttemptIsCurrent(attempt)) {
      return null
    }
    const admission = parseCacheAdmissionContext(value)
    if (!admission) {
      suspendPrivateAdmission()
      return null
    }
    if (!admissionOwnerMatches(admission, attempt.ownerUserId)) {
      await rejectAdmission()
      return null
    }
    const deadline = cacheAdmissionDeadline(admission, attempt.startedAt)
    if (!admissionAttemptIsCurrent(attempt) || now() >= deadline) {
      if (admissionAttemptIsCurrent(attempt)) {
        suspendPrivateAdmission()
      }
      return null
    }
    return { admission, deadline }
  }

  async function applyAdmissionInvalidation(
    attempt: AdmissionAttempt,
    admission: CacheAdmissionContext,
    currentTime: number,
    deadline: number,
  ) {
    const changedScopes = host.resolveAdmissionInvalidationScopes(
      admission,
      attempt.previousAdmission,
      currentTime,
      attempt.alreadyInvalidatedScope,
    )
    const refreshScope = safeRefreshScope(attempt.requestedRefreshScope, admission)
    const scopes = scopesForAdmission(
      admission,
      refreshScope ? [...changedScopes, refreshScope] : changedScopes,
    )
    for (const scope of scopes) {
      attempt.epoch = closeAndPurgePrivateCache(scope, false, false, true, true)
      // Each fence must commit before the next scope advances the durable generation.
      // oxlint-disable-next-line no-await-in-loop
      const invalidated = await advanceInvalidationGeneration(scope, attempt.epoch)
      if (!admissionAttemptIsCurrent(attempt) || !invalidated || now() >= deadline) {
        return false
      }
    }
    return true
  }

  async function finishPrivateAdmission(
    attempt: AdmissionAttempt,
    admission: CacheAdmissionContext,
    deadline: number,
    admittedCache: PersistedQueryCache,
  ) {
    await host.waitForHydration()
    if (!canCommitPrivateAdmission(attempt, admission, deadline)) {
      return false
    }
    host.commitAdmittedCache(admittedCache, now())
    quarantinePendingCharacters(admission, host.quarantineCharacter)
    host.restoreUnscopedData(admission)
    retainedPrivateAccessOpen = true
    scheduleAdmissionExpiry()
    host.touch()
    scheduleParkedQueryRefetch()
    return true
  }

  function admissionOwnerMatches(
    admission: ReturnType<typeof parseCacheAdmissionContext>,
    expectedOwner: string,
  ): admission is CacheAdmissionContext {
    return admission?.userId === expectedOwner && admission.userId === verifiedUserId
  }

  function canCommitPrivateAdmission(
    attempt: AdmissionAttempt,
    admission: CacheAdmissionContext,
    deadline: number,
  ) {
    return (
      admissionAttemptIsCurrent(attempt) &&
      activeAdmission === admission &&
      now() < deadline &&
      durableGenerationVerified &&
      privatePersistenceEnabled
    )
  }

  function applyAdmissionWithoutPersistence(admission: CacheAdmissionContext, deadline: number) {
    const scopes = scopesForAdmission(
      admission,
      host.resolveAdmissionInvalidationScopes(admission, lastAcceptedAdmission, now()),
    )
    for (const scope of scopes) {
      closeAndPurgePrivateCache(scope, false, false, true, true)
    }
    quarantinePendingCharacters(admission, host.quarantineCharacter)
    verifiedUserId = admission.userId
    activeAdmission = admission
    updatePendingCharacters(admission)
    lastAcceptedAdmission = preservePendingBaselines(lastAcceptedAdmission, admission)
    activeAdmissionDeadline = deadline
    retainedPrivateAccessOpen = false
    host.restoreUnscopedData(admission)
    scheduleAdmissionExpiry()
    host.touch()
    scheduleParkedQueryRefetch()
  }

  function scheduleParkedQueryRefetch() {
    // Parked entries are re-driven only once admission is open and the lifecycle epoch has settled: a
    // refetch issued while the gate is closed would commit data the invalidation just rejected, and one
    // issued before a queued recheck would have its success or denial discarded by the epoch guard.
    if (lifecycleCheck) {
      parkedRefetchPending = true
      return
    }
    host.refetchParkedPrivateQueries()
  }

  function rejectAdmission() {
    lastAcceptedAdmission = null
    pendingCharacters.clear()
    return invalidatePrivateCache({ kind: 'all' }, false)
  }

  function updatePendingCharacters(admission: CacheAdmissionContext) {
    pendingCharacters = new Set(
      admission.characters
        .filter(
          (character) => 'status' in character && character.status === 'temporarily-unavailable',
        )
        .map(({ characterId }) => characterId),
    )
    host.touch()
  }

  function suspendPrivateAdmission() {
    activeAdmission = null
    activeAdmissionDeadline = 0
    activeAdmissionMayRenew = true
    clearAdmissionTimers()
    suspendRetainedPrivateAccess()
    if (pendingCharacters.size > 0) {
      schedulePendingRetry()
    }
  }

  function invalidatePrivateCache(
    scope: PrivateQueryInvalidationScope,
    preserveErrors: boolean,
    deleteEnvelope = false,
    afterClose?: () => void,
    preserveFreshSuccesses = false,
  ) {
    const epoch = closeAndPurgePrivateCache(scope, preserveErrors, preserveFreshSuccesses)
    afterClose?.()
    return advanceInvalidationGeneration(scope, epoch, deleteEnvelope)
  }

  async function advanceInvalidationGeneration(
    scope: PrivateQueryInvalidationScope,
    expectedEpoch: number,
    deleteEnvelope = false,
  ) {
    privatePersistenceEnabled = false
    durableGenerationVerified = false
    durableInvalidationEpoch = expectedEpoch
    host.touch()
    if (!storage.available || disposed) {
      durableInvalidationEpoch = null
      return false
    }

    const generationAtStart = invalidationGeneration
    let invalidation: Awaited<ReturnType<QueryPersistenceStorage['invalidate']>>
    try {
      invalidation = await storage.invalidate(scope, deleteEnvelope)
    } catch {
      if (invalidationStillCurrent(expectedEpoch, generationAtStart)) {
        durableInvalidationEpoch = null
        notifications.publish({ generation: null, scope: { kind: 'all' } })
      }
      return false
    }
    const effectiveScopes = scopesForInvalidation(invalidation, generationAtStart)
    const effectiveScope =
      effectiveScopes.length === 1 ? effectiveScopes[0]! : ({ kind: 'all' } as const)
    const nextGeneration = invalidation?.generation
    if (nextGeneration !== undefined && nextGeneration > invalidationGeneration) {
      notifications.publish({
        generation: nextGeneration,
        scope: effectiveScope,
        ...(effectiveScopes.length > 1 && { requiresScopeProbe: true }),
      })
    }
    if (!invalidationStillCurrent(expectedEpoch, generationAtStart)) {
      return false
    }
    durableInvalidationEpoch = null
    if (!invalidation) {
      notifications.publish({ generation: null, scope: { kind: 'all' } })
      return false
    }
    if (invalidation.generation <= generationAtStart) {
      return false
    }

    for (const changed of scopesToReconcile(
      invalidation,
      generationAtStart,
      scope,
      effectiveScopes,
    )) {
      closeAndPurgePrivateCache(changed, false, false, true, true)
    }
    invalidationGeneration = invalidation.generation
    host.setEnvelope({
      ...host.readEnvelope(),
      invalidationGeneration: invalidation.generation,
    })
    if (
      effectiveScopes.some(
        (changed) =>
          changed.kind === 'all' ||
          (changed.kind === 'organization' && changed.admissionScope === undefined),
      )
    ) {
      durableOrganizationFencePending = false
    }
    durableGenerationVerified = !durableOrganizationFencePending
    privatePersistenceEnabled = !durableOrganizationFencePending
    host.touch()
    return true
  }

  function invalidationStillCurrent(expectedEpoch: number, generationAtStart: number) {
    return (
      !disposed &&
      expectedEpoch === privateLifecycleEpoch &&
      generationAtStart === invalidationGeneration &&
      durableInvalidationEpoch === expectedEpoch
    )
  }

  async function verifyDurableGeneration(
    stillCurrent: () => boolean,
  ): Promise<DurableGenerationProbe> {
    if (durableOrganizationFencePending) {
      return { kind: 'unusable' }
    }
    if (durableInvalidationEpoch !== null) {
      return { kind: 'superseded' }
    }
    const guard = lifecycleGuard()
    try {
      const snapshot = await storage.readGeneration()
      if (!stillCurrent() || !guardIsCurrent(guard)) {
        return { kind: 'superseded' }
      }
      if (snapshot === null) {
        disablePrivatePersistence()
        return { kind: 'unusable' }
      }
      applyVerifiedGeneration(snapshot)
      return { generation: snapshot.invalidationGeneration, kind: 'verified' }
    } catch {
      if (!stillCurrent() || !guardIsCurrent(guard)) {
        return { kind: 'superseded' }
      }
      disablePrivatePersistence()
      return { kind: 'unusable' }
    }
  }

  function applyStorageGeneration(generation: number | null, scopeHistory?: ScopeWatermarks) {
    if (generation === null) {
      disablePrivatePersistence()
      return
    }
    applyVerifiedGeneration(scopeHistory ?? initialScopeWatermarks(generation))
  }

  function applyStorageWrite(result: QueryPersistenceStorageWrite, privateWriteRequested: boolean) {
    if (result.generation === null) {
      disablePrivatePersistence()
      return
    }
    if (result.generation !== invalidationGeneration) {
      applyObservedInvalidation(
        result.generation,
        scopesSinceGeneration(result.scopeHistory, invalidationGeneration),
      )
      return
    }
    if (!result.privateAccepted) {
      if (privateWriteRequested) {
        disablePrivatePersistence()
      }
      return
    }
    applyVerifiedGeneration(result.scopeHistory ?? initialScopeWatermarks(result.generation))
  }

  function applyVerifiedGeneration(snapshot: ScopeWatermarks) {
    const generation = snapshot.invalidationGeneration
    if (generation !== invalidationGeneration) {
      applyObservedInvalidation(generation, scopesSinceGeneration(snapshot, invalidationGeneration))
    }
    invalidationGeneration = generation
    durableGenerationVerified = !durableOrganizationFencePending
    privatePersistenceEnabled = !durableOrganizationFencePending
    host.touch()
  }

  function applyObservedInvalidation(
    generation: number,
    scopes: readonly PrivateQueryInvalidationScope[],
  ) {
    for (const scope of scopes.length ? scopes : [{ kind: 'all' } as const]) {
      closeAndPurgePrivateCache(scope, false, false, false, true)
    }
    invalidationGeneration = generation
    host.setEnvelope({ ...host.readEnvelope(), invalidationGeneration: generation })
    durableGenerationVerified = false
    privatePersistenceEnabled = false
    host.touch()
  }

  function disablePrivatePersistence() {
    closeAndPurgePrivateCache({ kind: 'all' }, false)
    durableGenerationVerified = false
    privatePersistenceEnabled = false
    host.touch()
  }

  function closeAndPurgePrivateCache(
    scope: PrivateQueryInvalidationScope,
    preserveErrors: boolean,
    preserveFreshSuccesses = false,
    preserveSession = true,
    requireOrganizationReadiness = false,
  ) {
    retainedPrivateAccessOpen = false
    privateLifecycleEpoch += 1
    durableInvalidationEpoch = null
    clearAdmissionTimers()
    activeAdmission = null
    activeAdmissionDeadline = 0
    activeAdmissionMayRenew = true
    host.closeAndPurge(
      scope,
      preserveErrors,
      preserveFreshSuccesses,
      preserveSession,
      requireOrganizationReadiness,
    )
    host.touch()
    return privateLifecycleEpoch
  }

  function initializeLifecycleListeners() {
    const check = () => {
      if (disposed) {
        return
      }
      void requestLifecycleCheck()
    }
    const stopNotifications = notifications.subscribe((notification) => {
      if (disposed) {
        return
      }
      if (notification.generation === null) {
        disablePrivatePersistence()
        return
      }
      if (
        notification.generation < invalidationGeneration ||
        (notification.generation === invalidationGeneration && durableGenerationVerified)
      ) {
        return
      }
      if (notification.generation > invalidationGeneration) {
        if (
          notification.generation === invalidationGeneration + 1 &&
          !notification.requiresScopeProbe
        ) {
          applyObservedInvalidation(notification.generation, [notification.scope])
        } else {
          suspendRetainedPrivateAccess()
          host.quarantineUnscopedData()
        }
      }
      void requestLifecycleCheck()
    })
    cleanup.add(stopNotifications)

    const browserWindow = options.window
    const browserDocument = options.document
    if (!browserWindow || !browserDocument) {
      return
    }
    const checkVisible = () => {
      if (browserDocument.visibilityState === 'visible') {
        check()
      }
    }
    browserWindow.addEventListener('focus', check)
    browserWindow.addEventListener('pageshow', check)
    browserDocument.addEventListener('visibilitychange', checkVisible)
    cleanup.add(() => {
      browserWindow.removeEventListener('focus', check)
      browserWindow.removeEventListener('pageshow', check)
      browserDocument.removeEventListener('visibilitychange', checkVisible)
    })
  }

  // Resume events are coalesced: a second event must not advance the lifecycle epoch while an
  // admission attempt is in flight, because that obsoletes the attempt and its comparison baseline.
  function requestLifecycleCheck() {
    if (lifecycleCheck) {
      lifecycleRecheckRequested = true
      return lifecycleCheck
    }
    lifecycleCheck = runLifecycleCheck()
    return lifecycleCheck
  }

  async function runLifecycleCheck() {
    try {
      return await recheckWhileRequested(await checkLifecycle())
    } finally {
      lifecycleCheck = undefined
      lifecycleRecheckRequested = false
      flushParkedQueryRefetch()
    }
  }

  async function recheckWhileRequested(checked: boolean): Promise<boolean> {
    if (disposed || !lifecycleRecheckRequested) {
      return checked
    }
    lifecycleRecheckRequested = false
    return recheckWhileRequested(await checkLifecycle())
  }

  function flushParkedQueryRefetch() {
    if (!parkedRefetchPending) {
      return
    }
    parkedRefetchPending = false
    if (!disposed) {
      host.refetchParkedPrivateQueries()
    }
  }

  async function checkLifecycle() {
    if (disposed) {
      return false
    }
    suspendRetainedPrivateAccess()
    host.reconcileRetainedData()
    let persistenceUsable = true
    if (storage.available) {
      const epoch = privateLifecycleEpoch
      const previousGeneration = invalidationGeneration
      const durableGeneration = await verifyDurableGeneration(
        () => !disposed && epoch === privateLifecycleEpoch,
      )
      if (disposed || durableGeneration.kind === 'superseded') {
        return false
      }
      // An unreadable generation degrades to live-only access instead of ending the resume, so
      // server-authorized queries recover while the persisted cache stays closed. Disabling
      // persistence advances the epoch itself, so that bump must not abort the resume.
      if (durableGeneration.kind === 'unusable') {
        persistenceUsable = false
      } else if (
        durableGeneration.generation !== previousGeneration ||
        !durableGenerationVerified
      ) {
        return false
      }
    }
    if (persistenceUsable && admissionIsCurrent(now())) {
      const admission = activeAdmission
      if (!admission) {
        return false
      }
      retainedPrivateAccessOpen = true
      host.commitAdmittedCache(host.collectAdmittedCache(admission, now()), now())
      host.restoreUnscopedData(admission)
      scheduleAdmissionExpiry()
      host.touch()
      scheduleParkedQueryRefetch()
      return true
    }
    if (activeAdmission) {
      suspendPrivateAdmission()
    }
    if (!admissionLoader) {
      return false
    }
    return requestAdmission(admissionLoader)
  }

  function suspendRetainedPrivateAccess() {
    retainedPrivateAccessOpen = false
    if (durableInvalidationEpoch === null) {
      privateLifecycleEpoch += 1
      clearAdmissionTimers()
    }
    host.quarantineRetainedData()
    host.touch()
  }

  function scheduleAdmissionExpiry() {
    clearAdmissionTimers()
    if (disposed || !activeAdmission) {
      return
    }
    const deadline = activeAdmissionDeadline
    const hasPendingCharacter = activeAdmission.characters.some(
      (character) => 'status' in character && character.status === 'temporarily-unavailable',
    )
    const epoch = privateLifecycleEpoch
    const expiryDelay = Math.min(Math.max(0, deadline - now()), MAX_TIMEOUT_MS)
    admissionExpiryTimer = timers.setTimeout(() => {
      admissionExpiryTimer = undefined
      if (disposed || epoch !== privateLifecycleEpoch || activeAdmissionDeadline !== deadline) {
        return
      }
      if (deadline > now()) {
        scheduleAdmissionExpiry()
        return
      }
      host.touch()
      if (
        admissionLoader &&
        (hasPendingCharacter || (activeAdmissionMayRenew && host.hasRetainedPrivateData(true)))
      ) {
        void requestAdmission(admissionLoader)
        return
      }
      suspendPrivateAdmission()
    }, expiryDelay)

    if (hasPendingCharacter && admissionLoader) {
      schedulePendingRetry(epoch)
    }
    if (!activeAdmissionMayRenew || !admissionLoader || !host.hasRetainedPrivateData(true)) {
      return
    }
    const renewalDelay = Math.min(
      Math.max(0, deadline - now() - PRIVATE_ADMISSION_RENEWAL_LEAD_MS),
      MAX_TIMEOUT_MS,
    )
    admissionRenewalTimer = timers.setTimeout(() => {
      admissionRenewalTimer = undefined
      if (
        disposed ||
        epoch !== privateLifecycleEpoch ||
        activeAdmissionDeadline !== deadline ||
        !admissionLoader
      ) {
        return
      }
      void requestAdmission(admissionLoader)
    }, renewalDelay)
  }

  function schedulePendingRetry(epoch = privateLifecycleEpoch) {
    if (!admissionLoader || disposed) {
      return
    }
    pendingRetryTimer = timers.setTimeout(() => {
      pendingRetryTimer = undefined
      if (!disposed && epoch === privateLifecycleEpoch && admissionLoader) {
        void requestAdmission(admissionLoader)
      }
    }, PRIVATE_ADMISSION_RENEWAL_LEAD_MS)
  }

  function clearAdmissionTimers() {
    if (admissionExpiryTimer !== undefined) {
      timers.clearTimeout(admissionExpiryTimer)
    }
    if (admissionRenewalTimer !== undefined) {
      timers.clearTimeout(admissionRenewalTimer)
    }
    if (pendingRetryTimer !== undefined) {
      timers.clearTimeout(pendingRetryTimer)
    }
    admissionExpiryTimer = undefined
    admissionRenewalTimer = undefined
    pendingRetryTimer = undefined
  }

  function hasRetainedPrivateAccess(persistence: PrivateEsiQuery | undefined, currentTime: number) {
    const admission = activeAdmission
    const accessOpen =
      !disposed &&
      retainedPrivateAccessOpen &&
      durableInvalidationEpoch === null &&
      durableGenerationVerified &&
      privatePersistenceEnabled &&
      admission !== null &&
      admissionIsCurrent(currentTime)
    if (!accessOpen || !persistence) {
      return accessOpen
    }
    if (persistence.kind === 'character-esi') {
      return admission.characters.some(
        (character) =>
          character.characterId === persistence.characterId &&
          'admissionRevision' in character &&
          character.admissionRevision !== null,
      )
    }
    return (
      !!admission.organization &&
      admission.organization.admissionScopes.includes(persistence.admissionScope) &&
      !isExpired(admission.organization.validUntil, currentTime)
    )
  }

  function admissionAttemptIsCurrent(attempt: AdmissionAttempt) {
    return (
      !disposed &&
      pendingAdmissionRequest?.attempt.id === attempt.id &&
      attempt.epoch === privateLifecycleEpoch &&
      attempt.ownerUserId === verifiedUserId
    )
  }

  function identityAttemptIsCurrent(attempt: number) {
    return !disposed && attempt === identityAttempt
  }

  function lifecycleGuard(): LifecycleGuard {
    return { epoch: privateLifecycleEpoch, generation: invalidationGeneration }
  }

  function guardIsCurrent(guard: LifecycleGuard) {
    return (
      !disposed &&
      guard.epoch === privateLifecycleEpoch &&
      guard.generation === invalidationGeneration
    )
  }

  function admissionIsCurrent(currentTime: number) {
    return activeAdmission !== null && activeAdmissionDeadline > currentTime
  }

  return lifecycle
}

const preservePendingBaselines = (
  previous: CacheAdmissionContext | null,
  admission: CacheAdmissionContext,
): CacheAdmissionContext => {
  if (previous?.userId !== admission.userId) {
    return admission
  }
  return {
    ...admission,
    characters: admission.characters.map((character) => {
      if (!('status' in character) || character.status !== 'temporarily-unavailable') {
        return character
      }
      const baseline = previous.characters.find(
        (prior) => prior.characterId === character.characterId,
      )
      return baseline && 'admissionRevision' in baseline ? baseline : character
    }),
  }
}

const safeRefreshScope = (
  scope: PrivateQueryInvalidationScope | undefined,
  admission: CacheAdmissionContext,
): PrivateQueryInvalidationScope | null => {
  if (!scope) {
    return null
  }
  if (scope.kind === 'organization') {
    return scope
  }
  const pending = admission.characters.some(
    (character) =>
      'status' in character &&
      character.status === 'temporarily-unavailable' &&
      (scope.kind === 'all' ||
        scope.characterId === undefined ||
        scope.characterId === character.characterId),
  )
  return pending ? null : scope
}

function cacheAdmissionDeadline(admission: CacheAdmissionContext, requestStartedAt: number) {
  const clientDeadline = requestStartedAt + PRIVATE_ADMISSION_MAX_AGE_MS
  const organizationDeadline = admission.organization?.validUntil
    ? Date.parse(admission.organization.validUntil)
    : Number.POSITIVE_INFINITY
  return Math.min(clientDeadline, organizationDeadline)
}

function admissionMayRenew(
  previousDeadline: number,
  deadline: number,
  admission: CacheAdmissionContext,
) {
  const organizationDeadline = admission.organization?.validUntil
    ? Date.parse(admission.organization.validUntil)
    : Number.POSITIVE_INFINITY
  return previousDeadline !== deadline || organizationDeadline !== deadline
}

function authenticatedUserId(session: AuthSession | undefined) {
  return session?.authenticated ? session.account.userId : null
}

export const defaultQueryPersistenceTimers: QueryPersistenceTimers = {
  clearTimeout: (timer) => clearTimeout(timer),
  setTimeout: (callback, delay) => setTimeout(callback, delay),
}
