import type { AuthSession, CacheAdmissionContext, CacheAdmissionBootstrap } from '../queries/auth'
import {
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

const PRIVATE_ADMISSION_MAX_AGE_MS = 30_000
const PRIVATE_ADMISSION_RENEWAL_LEAD_MS = 5_000
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
  reconcileRetainedData(): void
  resolveAdmissionInvalidationScope(
    admission: CacheAdmissionContext,
    previousAdmission: CacheAdmissionContext | null,
    now: number,
    alreadyInvalidatedScope?: PrivateQueryInvalidationScope,
  ): PrivateQueryInvalidationScope | null
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

interface AdmissionAttempt {
  readonly alreadyInvalidatedScope?: PrivateQueryInvalidationScope
  epoch: number
  readonly id: symbol
  readonly ownerUserId: string
  readonly previousAdmission: CacheAdmissionContext | null
  readonly previousDeadline: number
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
  let disposed = false
  let durableInvalidationEpoch: number | null = null
  let durableGenerationVerified = false
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
  let pendingAdmissionRequest: PendingAdmissionRequest | undefined
  let privateLifecycleEpoch = 0
  let privatePersistenceEnabled = true
  let retainedPrivateAccessOpen = false
  let verifiedUserId: string | null = null
  const cleanup = new Set<() => void>()

  const lifecycle = {
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
        if (!identityAttemptIsCurrent(attempt)) return false
        return applyRestoredVerifiedIdentity(session, loadAdmission, signal, attempt, admission)
      })
    },
    applyRestoredEnvelope(envelope: EsiQueryCacheEnvelope) {
      if (disposed) return
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
    async clearCorruptCache() {
      if (disposed) return false
      const epoch = closeAndPurgePrivateCache({ kind: 'all' }, false)
      host.clearCorruptCache(emptyEnvelope(invalidationGeneration))
      try {
        await storage.removeEnvelope()
      } catch {
        if (!disposed && epoch === privateLifecycleEpoch) disablePrivatePersistence()
        return false
      }
      return !disposed && epoch === privateLifecycleEpoch
    },
    disablePersistence() {
      disablePrivatePersistence()
    },
    dispose() {
      if (disposed) return
      disposed = true
      identityAttempt += 1
      privateLifecycleEpoch += 1
      durableInvalidationEpoch = null
      lastAcceptedAdmission = null
      parkedRefetchPending = false
      retainedPrivateAccessOpen = false
      clearAdmissionTimers()
      for (const dispose of cleanup) dispose()
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
    installListeners() {
      if (listenersInstalled || disposed) return
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
    async refreshAdmission(scope: PrivateQueryInvalidationScope) {
      const expectedIdentityAttempt = identityAttempt
      const invalidated = await invalidatePrivateCache(scope, false)
      if (!invalidated || !identityAttemptIsCurrent(expectedIdentityAttempt) || !admissionLoader) {
        return false
      }
      return requestAdmission(admissionLoader, scope)
    },
    refreshAdmissionTimers() {
      scheduleAdmissionExpiry()
    },
    runIfActive(effect: () => void) {
      if (!disposed) effect()
    },
    async readStoredEnvelope() {
      const guard = lifecycleGuard()
      try {
        const result = await storage.read()
        if (disposed) return null
        if (!guardIsCurrent(guard)) return result.value
        applyStorageGeneration(result.generation)
        return result.value
      } catch (error) {
        if (!guardIsCurrent(guard)) return null
        disablePrivatePersistence()
        throw error
      }
    },
    removeStoredEnvelope() {
      if (disposed) return Promise.resolve()
      return storage.removeEnvelope()
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
      if (!disposed) suspendPrivateAdmission()
    },
    async writeStoredEnvelope(value: string) {
      if (!storage.available || disposed) return
      const guard = lifecycleGuard()
      const privateWriteRequested = durableGenerationVerified && privatePersistenceEnabled
      let result: QueryPersistenceStorageWrite
      try {
        result = await storage.write(value, privateWriteRequested)
      } catch (error) {
        if (guardIsCurrent(guard) && privateWriteRequested) disablePrivatePersistence()
        throw error
      }
      if (!guardIsCurrent(guard)) return
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
    if (!identityAttemptIsCurrent(attempt) || nextUserId === null) return false
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
    if (!ownerMatches) lastAcceptedAdmission = null
    identityCommitDepth += 1
    try {
      if (!ownerMatches) closeAndPurgePrivateCache({ kind: 'all' }, false)
      host.applyVerifiedSession(session, ownerMatches)
    } finally {
      identityCommitDepth -= 1
    }
    if (nextOwner === null) admissionLoader = undefined
    host.touch()
    return !ownerMatches
  }

  function requestAdmission(
    loadAdmission: () => Promise<CacheAdmissionContext>,
    alreadyInvalidatedScope?: PrivateQueryInvalidationScope,
    previousAdmission = lastAcceptedAdmission,
    signal?: AbortSignal,
    bootstrap?: CacheAdmissionBootstrap,
  ): Promise<boolean> {
    const epoch = privateLifecycleEpoch
    if (
      pendingAdmissionRequest?.attempt.epoch === epoch &&
      pendingAdmissionRequest.attempt.ownerUserId === verifiedUserId &&
      !pendingAdmissionRequest.attempt.signal?.aborted
    ) {
      return pendingAdmissionRequest.promise
    }
    if (disposed || verifiedUserId === null) return Promise.resolve(false)

    const attempt: AdmissionAttempt = {
      alreadyInvalidatedScope,
      epoch,
      id: Symbol('private-admission-attempt'),
      ownerUserId: verifiedUserId,
      previousAdmission,
      previousDeadline: activeAdmissionDeadline,
      signal,
      startedAt: bootstrap?.requestedAt ?? now(),
    }
    let promise!: Promise<boolean>
    promise = (async () => {
      try {
        const value = await Promise.resolve().then(() =>
          bootstrap ? bootstrap.context : loadAdmission(),
        )
        if (!admissionAttemptIsCurrent(attempt)) return false
        if (value === null) {
          suspendPrivateAdmission()
          return false
        }
        return await admitPrivateCache(value, attempt)
      } catch (error) {
        if (!admissionAttemptIsCurrent(attempt)) return false
        if (host.isAuthenticationDenial(error)) await rejectAdmission()
        else suspendPrivateAdmission()
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
    if (!admissionAttemptIsCurrent(attempt)) return false
    const admission = parseCacheAdmissionContext(value)
    if (admission?.userId !== attempt.ownerUserId || admission?.userId !== verifiedUserId) {
      await rejectAdmission()
      return false
    }
    const deadline = cacheAdmissionDeadline(admission, attempt.startedAt)
    if (!admissionAttemptIsCurrent(attempt) || now() >= deadline) {
      if (admissionAttemptIsCurrent(attempt)) await rejectAdmission()
      return false
    }

    retainedPrivateAccessOpen = false
    host.touch()
    if (!storage.available) {
      applyAdmissionWithoutPersistence(admission, deadline)
      return false
    }
    const durableGeneration = await verifyDurableGeneration(() =>
      admissionAttemptIsCurrent(attempt),
    )
    if (durableGeneration.kind === 'superseded' || now() >= deadline) return false
    if (durableGeneration.kind === 'unusable') {
      // Durable persistence is unusable rather than the admission invalid: it still authorizes live
      // requests, while retained data stays closed and no cache is committed until a later probe
      // verifies the generation. Disabling persistence advanced the epoch itself, so the attempt is
      // deliberately not re-checked here.
      applyAdmissionWithoutPersistence(admission, deadline)
      return false
    }
    if (!admissionAttemptIsCurrent(attempt)) return false

    const currentTime = now()
    host.reconcileRetainedData()
    if (!admissionAttemptIsCurrent(attempt) || currentTime >= deadline) return false
    const invalidationScope = host.resolveAdmissionInvalidationScope(
      admission,
      attempt.previousAdmission,
      currentTime,
      attempt.alreadyInvalidatedScope,
    )
    if (invalidationScope) {
      attempt.epoch = closeAndPurgePrivateCache(invalidationScope, false)
      const invalidated = await advanceInvalidationGeneration(invalidationScope, attempt.epoch)
      if (!admissionAttemptIsCurrent(attempt) || !invalidated || now() >= deadline) return false
    }

    activeAdmission = admission
    lastAcceptedAdmission = admission
    activeAdmissionDeadline = deadline
    activeAdmissionMayRenew = admissionMayRenew(attempt.previousDeadline, deadline, admission)
    const admittedCache = host.collectAdmittedCache(admission, now())

    await host.waitForHydration()
    if (
      !admissionAttemptIsCurrent(attempt) ||
      activeAdmission !== admission ||
      now() >= deadline ||
      !durableGenerationVerified ||
      !privatePersistenceEnabled
    ) {
      return false
    }
    host.commitAdmittedCache(admittedCache, now())
    retainedPrivateAccessOpen = true
    scheduleAdmissionExpiry()
    host.touch()
    scheduleParkedQueryRefetch()
    return true
  }

  function applyAdmissionWithoutPersistence(admission: CacheAdmissionContext, deadline: number) {
    const scope = host.resolveAdmissionInvalidationScope(admission, lastAcceptedAdmission, now())
    if (scope) closeAndPurgePrivateCache(scope, false)
    verifiedUserId = admission.userId
    activeAdmission = admission
    lastAcceptedAdmission = admission
    activeAdmissionDeadline = deadline
    retainedPrivateAccessOpen = false
    clearAdmissionTimers()
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
    return invalidatePrivateCache({ kind: 'all' }, false)
  }

  function suspendPrivateAdmission() {
    activeAdmission = null
    activeAdmissionDeadline = 0
    activeAdmissionMayRenew = true
    clearAdmissionTimers()
    suspendRetainedPrivateAccess()
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
      if (
        !disposed &&
        expectedEpoch === privateLifecycleEpoch &&
        generationAtStart === invalidationGeneration &&
        durableInvalidationEpoch === expectedEpoch
      ) {
        durableInvalidationEpoch = null
        notifications.publish({ generation: null, scope: { kind: 'all' } })
      }
      return false
    }
    const effectiveScope =
      invalidation?.generation === generationAtStart + 1
        ? invalidation.scope
        : ({ kind: 'all' } as const)
    const nextGeneration = invalidation?.generation
    if (nextGeneration !== undefined && nextGeneration > invalidationGeneration) {
      notifications.publish({ generation: nextGeneration, scope: effectiveScope })
    }
    if (
      disposed ||
      expectedEpoch !== privateLifecycleEpoch ||
      generationAtStart !== invalidationGeneration ||
      durableInvalidationEpoch !== expectedEpoch
    ) {
      return false
    }
    durableInvalidationEpoch = null
    if (!invalidation) {
      notifications.publish({ generation: null, scope: { kind: 'all' } })
      return false
    }
    if (invalidation.generation <= generationAtStart) return false

    if (effectiveScope.kind === 'all' && scope.kind !== 'all') {
      closeAndPurgePrivateCache(effectiveScope, false)
    }
    invalidationGeneration = invalidation.generation
    host.setEnvelope({
      ...host.readEnvelope(),
      invalidationGeneration: invalidation.generation,
    })
    durableGenerationVerified = true
    privatePersistenceEnabled = true
    host.touch()
    return true
  }

  async function verifyDurableGeneration(
    stillCurrent: () => boolean,
  ): Promise<DurableGenerationProbe> {
    if (durableInvalidationEpoch !== null) return { kind: 'superseded' }
    const guard = lifecycleGuard()
    try {
      const generation = await storage.readGeneration()
      if (!stillCurrent() || !guardIsCurrent(guard)) return { kind: 'superseded' }
      if (generation === null) {
        disablePrivatePersistence()
        return { kind: 'unusable' }
      }
      applyVerifiedGeneration(generation)
      return { kind: 'verified', generation }
    } catch {
      if (!stillCurrent() || !guardIsCurrent(guard)) return { kind: 'superseded' }
      disablePrivatePersistence()
      return { kind: 'unusable' }
    }
  }

  function applyStorageGeneration(generation: number | null) {
    if (generation === null) {
      disablePrivatePersistence()
      return
    }
    applyVerifiedGeneration(generation)
  }

  function applyStorageWrite(result: QueryPersistenceStorageWrite, privateWriteRequested: boolean) {
    if (result.generation === null) {
      disablePrivatePersistence()
      return
    }
    if (result.generation !== invalidationGeneration) {
      applyObservedInvalidation(result.generation, { kind: 'all' })
      return
    }
    if (!result.privateAccepted) {
      if (privateWriteRequested) disablePrivatePersistence()
      return
    }
    applyVerifiedGeneration(result.generation)
  }

  function applyVerifiedGeneration(generation: number) {
    if (generation !== invalidationGeneration) {
      applyObservedInvalidation(generation, { kind: 'all' })
    }
    invalidationGeneration = generation
    durableGenerationVerified = true
    privatePersistenceEnabled = true
    host.touch()
  }

  function applyObservedInvalidation(generation: number, scope: PrivateQueryInvalidationScope) {
    const effectiveScope =
      generation === invalidationGeneration + 1 ? scope : ({ kind: 'all' } as const)
    closeAndPurgePrivateCache(effectiveScope, false, false, false)
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
  ) {
    retainedPrivateAccessOpen = false
    privateLifecycleEpoch += 1
    durableInvalidationEpoch = null
    clearAdmissionTimers()
    activeAdmission = null
    activeAdmissionDeadline = 0
    activeAdmissionMayRenew = true
    host.closeAndPurge(scope, preserveErrors, preserveFreshSuccesses, preserveSession)
    host.touch()
    return privateLifecycleEpoch
  }

  function initializeLifecycleListeners() {
    const check = () => {
      if (disposed) return
      void requestLifecycleCheck()
    }
    const stopNotifications = notifications.subscribe((notification) => {
      if (disposed) return
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
        applyObservedInvalidation(notification.generation, notification.scope)
      }
      void requestLifecycleCheck()
    })
    cleanup.add(stopNotifications)

    const browserWindow = options.window
    const browserDocument = options.document
    if (!browserWindow || !browserDocument) return
    const checkVisible = () => {
      if (browserDocument.visibilityState === 'visible') check()
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
    if (disposed || !lifecycleRecheckRequested) return checked
    lifecycleRecheckRequested = false
    return recheckWhileRequested(await checkLifecycle())
  }

  function flushParkedQueryRefetch() {
    if (!parkedRefetchPending) return
    parkedRefetchPending = false
    if (!disposed) host.refetchParkedPrivateQueries()
  }

  async function checkLifecycle() {
    if (disposed) return false
    suspendRetainedPrivateAccess()
    host.reconcileRetainedData()
    let persistenceUsable = true
    if (storage.available) {
      const epoch = privateLifecycleEpoch
      const previousGeneration = invalidationGeneration
      const durableGeneration = await verifyDurableGeneration(
        () => !disposed && epoch === privateLifecycleEpoch,
      )
      if (disposed || durableGeneration.kind === 'superseded') return false
      // An unreadable generation degrades to live-only access instead of ending the resume, so
      // server-authorized queries recover while the persisted cache stays closed. Disabling
      // persistence advances the epoch itself, so that bump must not abort the resume.
      if (durableGeneration.kind === 'unusable') persistenceUsable = false
      else if (durableGeneration.generation !== previousGeneration || !durableGenerationVerified) {
        return false
      }
    }
    if (persistenceUsable && admissionIsCurrent(now())) {
      const admission = activeAdmission
      if (!admission) return false
      retainedPrivateAccessOpen = true
      host.commitAdmittedCache(host.collectAdmittedCache(admission, now()), now())
      scheduleAdmissionExpiry()
      host.touch()
      scheduleParkedQueryRefetch()
      return true
    }
    if (activeAdmission) suspendPrivateAdmission()
    if (!admissionLoader) return false
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
    if (disposed || !activeAdmission || !host.hasRetainedPrivateData(false)) return
    const deadline = activeAdmissionDeadline
    const epoch = privateLifecycleEpoch
    const expiryDelay = Math.min(Math.max(0, deadline - now()), MAX_TIMEOUT_MS)
    admissionExpiryTimer = timers.setTimeout(() => {
      admissionExpiryTimer = undefined
      if (disposed || epoch !== privateLifecycleEpoch || activeAdmissionDeadline !== deadline)
        return
      if (deadline > now()) {
        scheduleAdmissionExpiry()
        return
      }
      if (activeAdmissionMayRenew && admissionLoader && host.hasRetainedPrivateData(true)) {
        void requestAdmission(admissionLoader)
        return
      }
      suspendPrivateAdmission()
    }, expiryDelay)

    if (!activeAdmissionMayRenew || !admissionLoader || !host.hasRetainedPrivateData(true)) return
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

  function clearAdmissionTimers() {
    if (admissionExpiryTimer !== undefined) timers.clearTimeout(admissionExpiryTimer)
    if (admissionRenewalTimer !== undefined) timers.clearTimeout(admissionRenewalTimer)
    admissionExpiryTimer = undefined
    admissionRenewalTimer = undefined
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
    if (!accessOpen || !persistence) return accessOpen
    if (persistence.kind === 'character-esi') {
      return admission.characters.some(
        (character) =>
          character.characterId === persistence.characterId && character.admissionRevision !== null,
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
