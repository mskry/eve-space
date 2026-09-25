import {
  hydrateQueryCache,
  toCacheKey,
  type EntryKey,
  type PiniaColadaPlugin,
  type QueryCache,
  type UseQueryEntry,
  type UseQueryOptions,
} from '@pinia/colada'
import {
  isCacheReady,
  PiniaColadaCachePersister,
  type PiniaColadaStorage,
} from '@pinia/colada-plugin-cache-persister'
import {
  clearAuthenticatedQueriesAfterSessionTransition,
  selectEsiQueryPersistencePresentation,
  type EsiQueryPersistencePresentation,
} from '@eve-space/platform-module-nuxt/runtime'
import { computed, onScopeDispose, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import type { AuthSession, CacheAdmissionContext, CacheAdmissionBootstrap } from '../queries/auth'
import { PRIVATE_QUERY_KEYS } from '../queries/query-keys'
import { isAuthenticationDenial } from '../utils/authentication-denial'
import { ApiQueryError } from '../utils/query-error'
import {
  combineInvalidationScopes,
  createCache,
  emptyEnvelope,
  forEachPrivateTuple,
  invalidationScopeForPersistence,
  invalidationScopeMatchesPersistence,
  isRetainedSuccessTimestamp,
  parsePersistedEnvelope,
  partitionMatchesAdmission,
  PERSISTED_ESI_QUERY_CACHE_KEY,
  PERSISTED_ESI_QUERY_CACHE_RETENTION_MS,
  readEsiPersistence,
  removeEnvelopePartitions,
  removeTupleFromEnvelope,
  shouldPersistEsiQuery,
  type EsiQueryCacheEnvelope,
  type PersistedQueryCache,
  type PrivateQueryInvalidationScope,
} from './envelope'
import {
  createBrowserQueryPersistenceNotifications,
  createSilentQueryPersistenceNotifications,
  type QueryPersistenceNotifications,
} from './notifications'
import {
  createPrivateQueryLifecycle,
  defaultQueryPersistenceTimers,
  type QueryPersistenceTimers,
} from './private-lifecycle'
import {
  createQueryPersistenceState,
  touchQueryPersistenceState,
  type QueryPersistenceRuntimeState,
} from './state'
import { createIndexedDbQueryPersistenceStorage, type QueryPersistenceStorage } from './storage'

const MAX_TIMEOUT_MS = 2_147_483_647
const CHARACTER_AUTHORIZATION_DENIAL_CODES = new Set([
  'CHARACTER_NOT_FOUND',
  'EVE_REAUTH_REQUIRED',
  'EVE_SCOPE_REQUIRED',
])
const ORGANIZATION_AUTHORIZATION_DENIAL_CODES = new Set([
  'ORGANIZATION_COMPLIANCE_REQUIRED',
  'ORGANIZATION_HR_REQUIRED',
  'ORGANIZATION_MANAGER_REQUIRED',
  'ORGANIZATION_MEMBER_BLOCKED',
  'ORGANIZATION_OWNER_REQUIRED',
  'ORGANIZATION_PERMISSION_REQUIRED',
])
const QUERY_PERSISTENCE_RUNTIME = Symbol('query-persistence-runtime')

type QueryPersistencePresentation = EsiQueryPersistencePresentation & {
  readonly retainedPrivateAccess: boolean
}

export interface QueryPersistenceDependencies {
  readonly document?: Document
  readonly notifications?: QueryPersistenceNotifications
  readonly now?: () => number
  readonly storage?: QueryPersistenceStorage
  readonly timers?: QueryPersistenceTimers
  readonly window?: Window
}

type AdmissionLoader = (signal?: AbortSignal) => Promise<CacheAdmissionContext>
type PrivateQueryLifecycle = ReturnType<typeof createPrivateQueryLifecycle>

interface QueryPersistenceRuntime {
  applyVerifiedIdentity(
    session: AuthSession,
    loadAdmission?: AdmissionLoader,
    signal?: AbortSignal,
    admission?: CacheAdmissionBootstrap,
  ): Promise<boolean>
  awaitRestoration(): Promise<void>
  dispose(): void
  finishHydration(): void
  canPrefetch(options: QueryPersistenceAdmissionOptions): boolean
  invalidate(scope: PrivateQueryInvalidationScope): Promise<boolean>
  reportAuthorizationDenial(scope: PrivateQueryInvalidationScope, error: unknown): boolean
  refreshAdmission(scope: PrivateQueryInvalidationScope): Promise<boolean>
  readActiveState(): ComputedRef<EsiQueryPersistencePresentation | undefined>
  readCharacterOwnership(characterId: MaybeRefOrGetter<number | undefined>): ComputedRef<boolean>
  readState(key: MaybeRefOrGetter<EntryKey>): ComputedRef<QueryPersistencePresentation>
  subscribeInvalidation(
    scope: MaybeRefOrGetter<PrivateQueryInvalidationScope>,
    listener: () => void,
  ): () => void
  suspendAdmission(): void
}

type QueryPersistenceAdmissionOptions = Pick<UseQueryOptions, 'key' | 'meta'>

type QueryCacheWithPersistence = QueryCache & {
  [QUERY_PERSISTENCE_RUNTIME]?: QueryPersistenceRuntime
}

export function installQueryPersistence(
  dependencies: QueryPersistenceDependencies = {},
): PiniaColadaPlugin {
  return (context) => {
    const storage =
      dependencies.storage ?? createIndexedDbQueryPersistenceStorage({ now: dependencies.now })
    const notifications =
      dependencies.notifications ??
      (globalThis.window === undefined
        ? createSilentQueryPersistenceNotifications()
        : createBrowserQueryPersistenceNotifications({
            broadcastChannel: globalThis.BroadcastChannel,
            window: dependencies.window ?? globalThis.window,
          }))
    const runtime = createQueryPersistenceRuntime(context.queryCache, storage, notifications, {
      ...dependencies,
      document: dependencies.document ?? globalThis.document,
      window: dependencies.window ?? globalThis.window,
    })
    const queryCache = context.queryCache as QueryCacheWithPersistence
    Object.defineProperty(queryCache, QUERY_PERSISTENCE_RUNTIME, {
      configurable: true,
      value: runtime,
    })

    context.scope.run(() => onScopeDispose(runtime.dispose))
    runtime.installOfficialPlugin(context)
  }
}

export function awaitQueryPersistenceRestoration(queryCache: QueryCache) {
  return requireRuntime(queryCache).awaitRestoration()
}

/**
 * Applies an already verified live identity and reports retained private cache availability.
 * `false` does not mean that verification of the supplied live session failed.
 */
export function applyVerifiedQueryIdentity(
  queryCache: QueryCache,
  session: AuthSession,
  loadAdmission?: AdmissionLoader,
  signal?: AbortSignal,
  admission?: CacheAdmissionBootstrap,
): Promise<boolean> {
  return requireRuntime(queryCache).applyVerifiedIdentity(session, loadAdmission, signal, admission)
}

export function invalidatePrivateQueryScope(
  queryCache: QueryCache,
  scope?: PrivateQueryInvalidationScope,
) {
  return requireRuntime(queryCache).invalidate(scope ?? { kind: 'all' })
}

export function refreshPrivateQueryAdmission(
  queryCache: QueryCache,
  scope: PrivateQueryInvalidationScope,
) {
  return requireRuntime(queryCache).refreshAdmission(scope)
}

export function suspendPrivateQueryAdmission(queryCache: QueryCache) {
  requireRuntime(queryCache).suspendAdmission()
}

export function reportPrivateQueryAuthorizationDenial(
  queryCache: QueryCache,
  scope: PrivateQueryInvalidationScope,
  error: unknown,
) {
  return requireRuntime(queryCache).reportAuthorizationDenial(scope, error)
}

export function subscribePrivateQueryInvalidation(
  queryCache: QueryCache,
  scope: MaybeRefOrGetter<PrivateQueryInvalidationScope>,
  listener: () => void,
) {
  const unsubscribe = requireRuntime(queryCache).subscribeInvalidation(scope, listener)
  onScopeDispose(unsubscribe, true)
  return unsubscribe
}

export function canPrefetchPrivateQuery(
  queryCache: QueryCache,
  options: QueryPersistenceAdmissionOptions,
) {
  return requireRuntime(queryCache).canPrefetch(options)
}

export function signalNuxtHydrationFinished(queryCache: QueryCache) {
  requireRuntime(queryCache).finishHydration()
}

export function readQueryPersistenceState(queryCache: QueryCache, key: MaybeRefOrGetter<EntryKey>) {
  return requireRuntime(queryCache).readState(key)
}

export function readActiveQueryPersistenceState(queryCache: QueryCache) {
  return requireRuntime(queryCache).readActiveState()
}

export function readQueryCharacterOwnership(
  queryCache: QueryCache,
  characterId: MaybeRefOrGetter<number | undefined>,
) {
  return requireRuntime(queryCache).readCharacterOwnership(characterId)
}

function createQueryPersistenceRuntime(
  queryCache: QueryCache,
  storage: QueryPersistenceStorage,
  notifications: QueryPersistenceNotifications,
  dependencies: QueryPersistenceDependencies,
) {
  const state = createQueryPersistenceState(queryCache, emptyEnvelope())
  const invalidationSubscribers = new Set<{
    readonly listener: () => void
    readonly scope: MaybeRefOrGetter<PrivateQueryInvalidationScope>
  }>()
  const now = dependencies.now ?? Date.now
  const timers = dependencies.timers ?? defaultQueryPersistenceTimers
  const privateLifecycle = createPrivateQueryLifecycle({
    document: dependencies.document,
    host: {
      applyVerifiedSession(session, ownerMatches) {
        const sessionKey = PRIVATE_QUERY_KEYS.session()
        if (ownerMatches) {
          queryCache.setQueryData(sessionKey, session)
        } else {
          clearAuthenticatedQueriesAfterSessionTransition(queryCache, session, sessionKey)
        }
      },
      clearCorruptCache(envelope) {
        clearCorruptCacheState(state, envelope)
      },
      closeAndPurge(scope, preserveErrors, preserveFreshSuccesses, preserveSession) {
        closeAndPurgePrivateCache(
          state,
          scope,
          preserveErrors,
          preserveFreshSuccesses,
          preserveSession,
        )
        if (!preserveFreshSuccesses) {
          notifyPrivateQueryInvalidation(invalidationSubscribers, scope)
        }
      },
      collectAdmittedCache(admission, currentTime) {
        return collectAdmittedPrivateCache(state, admission, currentTime)
      },
      commitAdmittedCache(cache, currentTime) {
        commitAdmittedPrivateCache(state, cache, currentTime)
        reconcileRetainedDataExpiry(state, privateLifecycle, now, timers)
      },
      commitSerializedEnvelope(result) {
        state.envelope = result.envelope
        reconcileRetainedDataExpiry(state, privateLifecycle, now, timers)
      },
      hasCharacterData() {
        return queryCache.getEntries({ key: PRIVATE_QUERY_KEYS.characters() }).length > 0
      },
      hasFailedData(keyHash) {
        return state.entryState.hasFailedData(keyHash)
      },
      hasQuarantinedData(keyHash) {
        return state.entryState.hasQuarantinedData(keyHash)
      },
      hasRetainedPrivateData(activeOnly) {
        return hasRetainedPrivateData(state, activeOnly)
      },
      isAuthenticationDenial,
      isRemovalTombstoned(keyHash) {
        return state.entryState.isRemovalTombstoned(keyHash)
      },
      isRestorationSettled() {
        return state.restorationSettled
      },
      quarantineRetainedData() {
        quarantineRetainedPrivateData(state)
      },
      readCachedUserId() {
        return authenticatedUserId(
          queryCache.getQueryData<AuthSession>(PRIVATE_QUERY_KEYS.session()),
        )
      },
      readEnvelope() {
        return state.envelope
      },
      readOriginalSuccessTime(keyHash) {
        return state.entryState.readOriginalSuccessTime(keyHash)
      },
      readPersistedPrivateOwner() {
        return persistedPrivateOwner(state.envelope)
      },
      reconcileRetainedData() {
        reconcileRetainedDataExpiry(state, privateLifecycle, now, timers)
      },
      refetchParkedPrivateQueries() {
        refetchParkedPrivateQueries(state)
      },
      resolveAdmissionInvalidationScope(
        admission,
        previousAdmission,
        currentTime,
        alreadyInvalidatedScope,
      ) {
        return admissionInvalidationScope(
          state,
          admission,
          previousAdmission,
          currentTime,
          alreadyInvalidatedScope,
        )
      },
      serializerMerged(successfulTimes) {
        state.entryState.serializerMerged(successfulTimes)
      },
      setEnvelope(envelope) {
        state.envelope = envelope
      },
      touch() {
        touchQueryPersistenceState(state)
      },
      waitForHydration() {
        return state.hydrationReady
      },
      waitForRestoration,
    },
    notifications,
    now,
    storage,
    timers,
    window: dependencies.window,
  })

  async function waitForRestoration() {
    await state.restorationReady
    if (state.officialPersisterInstalled) {
      await isCacheReady()
    }
    privateLifecycle.runIfActive(() => extendRestoredEntries(queryCache))
  }

  const runtime: QueryPersistenceRuntime & {
    installOfficialPlugin: (context: Parameters<PiniaColadaPlugin>[0]) => void
  } = {
    applyVerifiedIdentity(session, loadAdmission, signal, admission) {
      return privateLifecycle.applyVerifiedIdentity(session, loadAdmission, signal, admission)
    },
    awaitRestoration() {
      return waitForRestoration()
    },
    canPrefetch(options) {
      const meta = toValue(options.meta)
      const persistence = meta ? readEsiPersistence(meta) : null
      if (!persistence || persistence.kind === 'public-esi') {
        return true
      }
      if (privateLifecycle.hasCurrentAdmission(persistence)) {
        return true
      }
      const key = toValue(options.key)
      return (
        queryCache.get(key)?.state.value.data === undefined ||
        state.entryState.readRetentionDeadline(toCacheKey(key)) === undefined
      )
    },
    dispose() {
      privateLifecycle.dispose()
      invalidationSubscribers.clear()
      clearRetainedDataExpiryTimer(state, timers)
      state.resolveHydration()
      settleRestoration(state)
      const attached = queryCache as QueryCacheWithPersistence
      if (attached[QUERY_PERSISTENCE_RUNTIME] === runtime) {
        delete attached[QUERY_PERSISTENCE_RUNTIME]
      }
    },
    finishHydration() {
      if (state.hydrationFinished) {
        return
      }
      state.hydrationFinished = true
      recordUnclassifiedSuccessfulEntries(state, now())
      applyStagedPublicFallbacks(state, privateLifecycle, now)
      signalSuccessfulEntriesForPersistence(state)
      state.resolveHydration()
      touchQueryPersistenceState(state)
      reconcileRetainedDataExpiry(state, privateLifecycle, now, timers)
    },
    installOfficialPlugin(context) {
      initializeQueryCacheHooks(state, privateLifecycle, now, timers)
      privateLifecycle.installListeners()
      if (globalThis.window === undefined || !storage.available) {
        privateLifecycle.disablePersistence()
        settleRestoration(state)
        return
      }

      state.officialPersisterInstalled = true
      PiniaColadaCachePersister({
        key: PERSISTED_ESI_QUERY_CACHE_KEY,
        storage: createColadaStorage(privateLifecycle, () => settleRestoration(state)),
        filter: { predicate: shouldPersistEsiQuery },
        stringify: (cache) => privateLifecycle.serialize(cache),
        parse: (stored) => parseCache(state, privateLifecycle, stored, now, timers),
        onParseError: () => {
          void privateLifecycle.clearCorruptCache().finally(() => settleRestoration(state))
        },
        onStringifyError: () => {},
      })(context)
    },
    invalidate(scope) {
      return privateLifecycle.invalidate(scope)
    },
    readActiveState() {
      return computedPresentation(state, () => {
        const presentations = queryCache
          .getEntries({ predicate: shouldPersistEsiQuery })
          .filter((entry) => entry.active && entry.state.value.data !== undefined)
          .map((entry) => queryPersistencePresentation(state, entry.keyHash))
        return presentations.length
          ? selectEsiQueryPersistencePresentation(presentations)
          : undefined
      })
    },
    readCharacterOwnership(characterId) {
      return computedPresentation(state, () => privateLifecycle.ownsCharacter(toValue(characterId)))
    },
    readState(key) {
      return computedPresentation(state, () => {
        const resolvedKey = toValue(key)
        const keyHash = toCacheKey(resolvedKey)
        const entry = queryCache.get(resolvedKey)
        const persistence = entry ? readEsiPersistence(entry.meta) : null
        return {
          ...queryPersistencePresentation(state, keyHash),
          retainedPrivateAccess:
            !!persistence &&
            persistence.kind !== 'public-esi' &&
            entry?.state.value.data !== undefined &&
            state.entryState.readRetentionDeadline(keyHash) !== undefined &&
            privateLifecycle.hasCurrentAdmission(persistence),
        }
      })
    },
    refreshAdmission(scope) {
      return privateLifecycle.refreshAdmission(scope)
    },
    reportAuthorizationDenial(scope, error) {
      const invalidationScope = authoritativeDenialInvalidationScope(scope, error)
      if (!invalidationScope) {
        return false
      }
      // A missing write scope leaves read access intact, so live results and consumer state survive.
      void privateLifecycle.invalidate(invalidationScope, false, isMissingScopeDenial(error))
      return true
    },
    subscribeInvalidation(scope, listener) {
      const subscription = { listener, scope }
      invalidationSubscribers.add(subscription)
      return () => invalidationSubscribers.delete(subscription)
    },
    suspendAdmission() {
      privateLifecycle.suspendAdmission()
    },
  }

  return runtime
}

function computedPresentation<T>(state: QueryPersistenceRuntimeState, read: () => T) {
  return computed(() => readAtPresentationRevision(state.presentationRevision.value, read))
}

function readAtPresentationRevision<T>(_revision: number, read: () => T) {
  return read()
}

function createColadaStorage(
  privateLifecycle: PrivateQueryLifecycle,
  settle: () => void,
): PiniaColadaStorage {
  return {
    async getItem(key) {
      if (key !== PERSISTED_ESI_QUERY_CACHE_KEY) {
        return null
      }
      try {
        const value = await privateLifecycle.readStoredEnvelope()
        if (value === null) {
          settle()
        }
        return value
      } catch (error) {
        settle()
        throw error
      }
    },
    async removeItem(key) {
      if (key === PERSISTED_ESI_QUERY_CACHE_KEY) {
        await privateLifecycle.removeStoredEnvelope()
      }
    },
    async setItem(key, value) {
      if (key !== PERSISTED_ESI_QUERY_CACHE_KEY) {
        return
      }
      await privateLifecycle.writeStoredEnvelope(value)
    },
  }
}

function parseCache(
  state: QueryPersistenceRuntimeState,
  privateLifecycle: PrivateQueryLifecycle,
  stored: string,
  now: () => number,
  timers: QueryPersistenceTimers,
) {
  const parsed = parsePersistedEnvelope(stored, now())
  privateLifecycle.applyRestoredEnvelope(parsed.envelope)
  state.pendingPublicHydration = createCache()
  for (const [keyHash, tuple] of Object.entries(parsed.envelope.public)) {
    state.pendingPublicHydration[keyHash] = tuple
  }
  if (state.hydrationFinished) {
    applyStagedPublicFallbacks(state, privateLifecycle, now)
  }

  touchQueryPersistenceState(state)
  reconcileRetainedDataExpiry(state, privateLifecycle, now, timers)
  if (parsed.pruned) {
    void persistCurrentEnvelope(state, privateLifecycle).finally(() => settleRestoration(state))
  } else {
    settleRestoration(state)
  }
  return createCache()
}

function applyStagedPublicFallbacks(
  state: QueryPersistenceRuntimeState,
  privateLifecycle: PrivateQueryLifecycle,
  now: () => number,
) {
  const currentTime = now()
  let expired = false
  for (const [keyHash, tuple] of Object.entries(state.pendingPublicHydration)) {
    delete state.pendingPublicHydration[keyHash]
    if (!isRetainedSuccessTimestamp(tuple[2], currentTime)) {
      delete state.envelope.public[keyHash]
      state.entryState.removed(keyHash)
      expired = true
      continue
    }

    const key = JSON.parse(keyHash) as EntryKey
    const current = state.queryCache.get(key)
    if (current?.state.value.data !== undefined) {
      if (current.state.value.status === 'success') {
        recordSuccessfulCurrentResult(state, current, 'ssr', currentTime, true)
      }
      continue
    }

    if (current) {
      state.queryCache.setEntryState(current, {
        data: tuple[0],
        error: null,
        status: 'success',
      })
      current.when = tuple[2]
    } else {
      hydrateAbsoluteCache(state.queryCache, { [keyHash]: tuple }, currentTime)
    }
    state.entryState.restored(keyHash, tuple[0], tuple[2])
  }
  if (expired) {
    void persistCurrentEnvelope(state, privateLifecycle)
  }
  touchQueryPersistenceState(state)
}

function reconcileRetainedDataExpiry(
  state: QueryPersistenceRuntimeState,
  privateLifecycle: PrivateQueryLifecycle,
  now: () => number,
  timers: QueryPersistenceTimers,
) {
  clearRetainedDataExpiryTimer(state, timers)
  const currentTime = now()
  const persistedDeadlines = retainedEnvelopeDeadlines(state.envelope)
  const entries = new Map(
    state.queryCache
      .getEntries({ predicate: shouldPersistEsiQuery })
      .map((entry) => [entry.keyHash, entry] as const),
  )
  const keyHashes = new Set([
    ...persistedDeadlines.keys(),
    ...Object.keys(state.pendingPublicHydration),
    ...entries.keys(),
  ])
  let envelopeChanged = false
  let stateChanged = false

  for (const keyHash of keyHashes) {
    const entry = entries.get(keyHash)
    const changes = expireRetainedDataForKey(
      state,
      keyHash,
      entry,
      persistedDeadlines.get(keyHash),
      currentTime,
    )
    envelopeChanged = envelopeChanged || changes.envelopeChanged
    stateChanged = stateChanged || changes.stateChanged
  }

  if (stateChanged || envelopeChanged) {
    touchQueryPersistenceState(state)
  }
  if (envelopeChanged) {
    void persistCurrentEnvelope(state, privateLifecycle)
  }
  scheduleRetainedDataExpiry(state, privateLifecycle, now, timers)
}

function expireRetainedDataForKey(
  state: QueryPersistenceRuntimeState,
  keyHash: string,
  entry: UseQueryEntry | undefined,
  persistedDeadline: number | undefined,
  currentTime: number,
) {
  const entryDeadline = state.entryState.readRetentionDeadline(keyHash)
  const entryExpired = entryDeadline !== undefined && entryDeadline <= currentTime
  const persistedExpired = persistedDeadline !== undefined && persistedDeadline <= currentTime
  if (!entryExpired && !persistedExpired) {
    return { envelopeChanged: false, stateChanged: false }
  }

  let stateChanged = false
  if (entryExpired && entry) {
    expireRetainedQueryEntry(state, entry)
    stateChanged = true
  }

  const pendingHydrationExpired = Object.hasOwn(state.pendingPublicHydration, keyHash)
  if (pendingHydrationExpired) {
    delete state.pendingPublicHydration[keyHash]
    stateChanged = true
  }

  const envelopeChanged = persistedExpired && removeTupleFromEnvelope(state.envelope, keyHash)
  if (!entry && (pendingHydrationExpired || envelopeChanged)) {
    state.entryState.removed(keyHash)
  }

  return { envelopeChanged, stateChanged }
}

function expireRetainedQueryEntry(state: QueryPersistenceRuntimeState, entry: UseQueryEntry) {
  const entryState = entry.state.value
  const presentation = state.entryState.readPresentation(entry.keyHash)
  const priorError =
    entryState.status === 'error'
      ? entryState.error
      : entry.ext.retryError?.value || retainedDataExpiryError(presentation)
  const shouldRefresh =
    priorError === null && entry.active && entry.options !== null && toValue(entry.options.enabled)

  state.queryCache.invalidate(entry)
  state.entryState.removed(entry.keyHash)
  state.queryCache.setEntryState(
    entry,
    priorError === null
      ? { data: undefined, error: null, status: 'pending' }
      : { data: undefined, error: priorError, status: 'error' },
  )
  entry.when = 0
  touchQueryPersistenceState(state)

  if (!entry.active) {
    state.queryCache.remove(entry)
  }
  if (shouldRefresh) {
    void state.queryCache.fetch(entry).catch(() => {})
  }
}

function retainedDataExpiryError(
  presentation: EsiQueryPersistencePresentation,
): ApiQueryError | null {
  if (presentation.kind === 'restored-refresh-failed') {
    return new ApiQueryError(
      'Previously cached data expired before current ESI data became available.',
      {
        code: presentation.refreshFailureCode ?? 'ESI_UNAVAILABLE',
        retryAt: presentation.retryAt,
        status: presentation.refreshFailureStatus ?? 502,
      },
    )
  }
  if (presentation.kind === 'server-stale') {
    return new ApiQueryError(
      'Previously cached data expired before current ESI data became available.',
      {
        code: 'ESI_UNAVAILABLE',
        retryAt: presentation.retryAt,
        status: 502,
      },
    )
  }
  return null
}

function scheduleRetainedDataExpiry(
  state: QueryPersistenceRuntimeState,
  privateLifecycle: PrivateQueryLifecycle,
  now: () => number,
  timers: QueryPersistenceTimers,
) {
  clearRetainedDataExpiryTimer(state, timers)
  const deadlines = [...retainedEnvelopeDeadlines(state.envelope).values()]
  for (const entry of state.queryCache.getEntries({ predicate: shouldPersistEsiQuery })) {
    const deadline = state.entryState.readRetentionDeadline(entry.keyHash)
    if (deadline !== undefined) {
      deadlines.push(deadline)
    }
  }
  if (deadlines.length === 0) {
    return
  }
  const deadline = Math.min(...deadlines)
  const delay = Math.min(Math.max(0, deadline - now()), MAX_TIMEOUT_MS)
  state.retainedDataExpiryTimer = timers.setTimeout(() => {
    state.retainedDataExpiryTimer = undefined
    privateLifecycle.runIfActive(() =>
      reconcileRetainedDataExpiry(state, privateLifecycle, now, timers),
    )
  }, delay)
}

function retainedEnvelopeDeadlines(envelope: EsiQueryCacheEnvelope) {
  const deadlines = new Map<string, number>()
  for (const [keyHash, tuple] of Object.entries(envelope.public)) {
    deadlines.set(keyHash, tuple[2] + PERSISTED_ESI_QUERY_CACHE_RETENTION_MS)
  }
  forEachPrivateTuple(envelope, (keyHash, tuple) => {
    deadlines.set(keyHash, tuple[2] + PERSISTED_ESI_QUERY_CACHE_RETENTION_MS)
  })
  return deadlines
}

function clearRetainedDataExpiryTimer(
  state: QueryPersistenceRuntimeState,
  timers: QueryPersistenceTimers,
) {
  if (state.retainedDataExpiryTimer !== undefined) {
    timers.clearTimeout(state.retainedDataExpiryTimer)
  }
  state.retainedDataExpiryTimer = undefined
}

function persistedPrivateOwner(envelope: EsiQueryCacheEnvelope) {
  const owners = new Set<string>()
  for (const partition of Object.values(envelope.characters)) {
    owners.add(partition.ownerUserId)
  }
  for (const partition of Object.values(envelope.organizations)) {
    owners.add(partition.ownerUserId)
  }
  return owners.size === 1 ? (owners.values().next().value ?? null) : null
}

function collectAdmittedPrivateCache(
  state: QueryPersistenceRuntimeState,
  admission: CacheAdmissionContext,
  now: number,
) {
  const admittedCache = createCache()
  forEachPrivateTuple(state.envelope, (keyHash, tuple, partition, persistence) => {
    if (!partitionMatchesAdmission(partition, persistence, admission, now)) {
      return
    }
    const key = JSON.parse(keyHash) as EntryKey
    const current = state.queryCache.get(key)
    if (current?.state.value.data !== undefined) {
      return
    }
    admittedCache[keyHash] = tuple
  })
  return admittedCache
}

function commitAdmittedPrivateCache(
  state: QueryPersistenceRuntimeState,
  admittedCache: PersistedQueryCache,
  now: number,
) {
  for (const [keyHash, tuple] of Object.entries(admittedCache)) {
    const key = JSON.parse(keyHash) as EntryKey
    if (!isRetainedSuccessTimestamp(tuple[2], now)) {
      delete admittedCache[keyHash]
      removeTupleFromEnvelope(state.envelope, keyHash)
      state.entryState.removed(keyHash)
      continue
    }
    if (state.queryCache.get(key)?.state.value.data !== undefined) {
      delete admittedCache[keyHash]
    }
  }
  hydrateAbsoluteCache(state.queryCache, admittedCache, now)
  for (const [keyHash, tuple] of Object.entries(admittedCache)) {
    const key = JSON.parse(keyHash) as EntryKey
    const committed = state.queryCache.get(key)
    if (committed?.state.value.status === 'success' && committed.state.value.data !== undefined) {
      state.entryState.restored(keyHash, tuple[0], tuple[2])
    }
  }
  extendRestoredEntries(state.queryCache)
}

function refetchParkedPrivateQueries(state: QueryPersistenceRuntimeState) {
  for (const entry of state.queryCache.getEntries({ key: PRIVATE_QUERY_KEYS.root })) {
    const entryState = entry.state.value
    if (
      !entry.active ||
      entry.options === null ||
      !toValue(entry.options.enabled) ||
      entry.pending !== null ||
      entryState.status !== 'pending' ||
      entryState.data !== undefined
    ) {
      continue
    }
    void state.queryCache.fetch(entry).catch(() => {})
  }
}

function admissionInvalidationScope(
  state: QueryPersistenceRuntimeState,
  admission: CacheAdmissionContext,
  previousAdmission: CacheAdmissionContext | null,
  now: number,
  alreadyInvalidatedScope?: PrivateQueryInvalidationScope,
) {
  const scopes = persistedPartitionInvalidationScopes(
    state.envelope,
    admission,
    now,
    alreadyInvalidatedScope,
  )
  if (!previousAdmission) {
    return combineInvalidationScopes(scopes)
  }
  if (previousAdmission.userId !== admission.userId) {
    return { kind: 'all' } as const
  }
  scopes.push(
    ...changedAdmissionInvalidationScopes(
      previousAdmission,
      admission,
      now,
      alreadyInvalidatedScope,
    ),
  )
  return combineInvalidationScopes(scopes)
}

function persistedPartitionInvalidationScopes(
  envelope: EsiQueryCacheEnvelope,
  admission: CacheAdmissionContext,
  now: number,
  alreadyInvalidatedScope?: PrivateQueryInvalidationScope,
) {
  const scopes: PrivateQueryInvalidationScope[] = []
  for (const [characterId, partition] of Object.entries(envelope.characters)) {
    const persistence = { characterId: Number(characterId), kind: 'character-esi' } as const
    if (!partitionMatchesAdmission(partition, persistence, admission, now)) {
      appendUncoveredInvalidationScope(
        scopes,
        {
          characterId: persistence.characterId,
          kind: 'character',
        },
        alreadyInvalidatedScope,
      )
    }
  }
  for (const [admissionScope, partition] of Object.entries(envelope.organizations)) {
    const persistence = { admissionScope, kind: 'organization-esi' } as const
    if (!partitionMatchesAdmission(partition, persistence, admission, now)) {
      appendUncoveredInvalidationScope(
        scopes,
        {
          admissionScope,
          kind: 'organization',
        },
        alreadyInvalidatedScope,
      )
    }
  }
  return scopes
}

function appendUncoveredInvalidationScope(
  scopes: PrivateQueryInvalidationScope[],
  scope: PrivateQueryInvalidationScope,
  alreadyInvalidatedScope?: PrivateQueryInvalidationScope,
) {
  if (alreadyInvalidatedScope && invalidationScopeCovers(alreadyInvalidatedScope, scope)) {
    return
  }
  scopes.push(scope)
}

function changedAdmissionInvalidationScopes(
  previousAdmission: CacheAdmissionContext,
  admission: CacheAdmissionContext,
  now: number,
  alreadyInvalidatedScope?: PrivateQueryInvalidationScope,
) {
  const scopes: PrivateQueryInvalidationScope[] = []
  const characterIds = new Set([
    ...previousAdmission.characters.map(({ characterId }) => characterId),
    ...admission.characters.map(({ characterId }) => characterId),
  ])
  for (const characterId of characterIds) {
    if (
      characterAdmissionRevision(previousAdmission, characterId) !==
      characterAdmissionRevision(admission, characterId)
    ) {
      appendUncoveredInvalidationScope(
        scopes,
        {
          characterId,
          kind: 'character',
        },
        alreadyInvalidatedScope,
      )
    }
  }
  if (organizationAdmissionChanged(previousAdmission, admission, now)) {
    appendUncoveredInvalidationScope(
      scopes,
      {
        kind: 'organization',
      },
      alreadyInvalidatedScope,
    )
  }
  return scopes
}

function characterAdmissionRevision(admission: CacheAdmissionContext, characterId: number) {
  return admission.characters.find((character) => character.characterId === characterId)
    ?.admissionRevision
}

function organizationAdmissionChanged(
  previous: CacheAdmissionContext,
  next: CacheAdmissionContext,
  now: number,
) {
  const previousOrganization = previous.organization
  const nextOrganization = next.organization
  if (!previousOrganization || !nextOrganization) {
    return previousOrganization !== nextOrganization
  }
  return (
    previousOrganization.organizationVersion !== nextOrganization.organizationVersion ||
    previousOrganization.admissionRevision !== nextOrganization.admissionRevision ||
    previousOrganization.validUntil !== nextOrganization.validUntil ||
    (nextOrganization.validUntil !== null && Date.parse(nextOrganization.validUntil) <= now) ||
    previousOrganization.admissionScopes.length !== nextOrganization.admissionScopes.length ||
    previousOrganization.admissionScopes.some(
      (scope) => !nextOrganization.admissionScopes.includes(scope),
    )
  )
}

function invalidationScopeCovers(
  scope: PrivateQueryInvalidationScope,
  candidate: PrivateQueryInvalidationScope,
) {
  if (scope.kind === 'all') {
    return true
  }
  if (scope.kind !== candidate.kind) {
    return false
  }
  if (scope.kind === 'character' && candidate.kind === 'character') {
    return scope.characterId === undefined || scope.characterId === candidate.characterId
  }
  return (
    scope.kind === 'organization' &&
    candidate.kind === 'organization' &&
    (scope.admissionScope === undefined || scope.admissionScope === candidate.admissionScope)
  )
}

function closeAndPurgePrivateCache(
  state: QueryPersistenceRuntimeState,
  scope: PrivateQueryInvalidationScope,
  preserveErrors: boolean,
  preserveFreshSuccesses = false,
  preserveSession = true,
) {
  cancelPendingPrivateQueries(state.queryCache, scope, preserveSession)
  purgePrivateQueryData(state, scope, preserveErrors, preserveFreshSuccesses, preserveSession)
  purgePrivateEnvelopePartitions(state, scope)
  touchQueryPersistenceState(state)
}

function quarantineRetainedPrivateData(state: QueryPersistenceRuntimeState) {
  for (const entry of state.queryCache.getEntries({ predicate: shouldPersistEsiQuery })) {
    const persistence = readEsiPersistence(entry.meta)
    if (
      !persistence ||
      persistence.kind === 'public-esi' ||
      state.entryState.readRetentionDeadline(entry.keyHash) === undefined
    ) {
      continue
    }
    if (entry.pending) {
      state.queryCache.cancel(entry, new Error('Persisted query admission is being verified.'))
    }
    state.entryState.quarantine(entry.keyHash)
    const entryState = entry.state.value
    state.queryCache.setEntryState(
      entry,
      entryState.status === 'error'
        ? { data: undefined, error: entryState.error, status: 'error' }
        : { data: undefined, error: null, status: 'pending' },
    )
  }
}

function cancelPendingPrivateQueries(
  queryCache: QueryCache,
  scope: PrivateQueryInvalidationScope,
  preserveSession: boolean,
) {
  for (const entry of queryCache.getEntries({ key: PRIVATE_QUERY_KEYS.root })) {
    if (preserveSession && entry.keyHash === toCacheKey(PRIVATE_QUERY_KEYS.session())) {
      continue
    }
    if (privateQueryEntryMatchesScope(entry, scope) && entry.pending) {
      queryCache.cancel(entry, new Error('Persisted query admission changed.'))
    }
  }
}

function purgePrivateQueryData(
  state: QueryPersistenceRuntimeState,
  scope: PrivateQueryInvalidationScope,
  preserveErrors: boolean,
  preserveFreshSuccesses = false,
  preserveSession = true,
) {
  for (const entry of state.queryCache.getEntries({ key: PRIVATE_QUERY_KEYS.root })) {
    if (preserveSession && entry.keyHash === toCacheKey(PRIVATE_QUERY_KEYS.session())) {
      continue
    }
    if (!privateQueryEntryMatchesScope(entry, scope)) {
      continue
    }
    if (
      preserveFreshSuccesses &&
      entry.state.value.status === 'success' &&
      !state.entryState.hasRestoredData(entry.keyHash)
    ) {
      continue
    }
    purgeQueryEntryData(state, entry, preserveErrors)
  }
}

function purgeQueryEntryData(
  state: QueryPersistenceRuntimeState,
  entry: UseQueryEntry,
  preserveError = false,
) {
  state.entryState.removed(entry.keyHash)
  const entryState = entry.state.value
  if (preserveError && entryState.status === 'error') {
    state.queryCache.setEntryState(entry, {
      data: undefined,
      error: entryState.error,
      status: 'error',
    })
    touchQueryPersistenceState(state)
    return
  }

  if (entryState.data !== undefined || entryState.status !== 'pending') {
    state.queryCache.setEntryState(entry, { data: undefined, error: null, status: 'pending' })
  }
  // setEntryState stamps `when`, which would leave a cleared entry looking fresh and suppress every
  // staleness-driven refetch, so a purged query would stay pending with no request in flight.
  entry.when = 0
  touchQueryPersistenceState(state)
}

function purgePrivateEnvelopePartitions(
  state: QueryPersistenceRuntimeState,
  scope: PrivateQueryInvalidationScope,
) {
  for (const [characterId, partition] of Object.entries(state.envelope.characters)) {
    const persistence = { characterId: Number(characterId), kind: 'character-esi' } as const
    if (!invalidationScopeMatchesPersistence(scope, persistence)) {
      continue
    }
    for (const keyHash of Object.keys(partition.cache)) {
      state.entryState.removed(keyHash)
    }
  }
  for (const [admissionScope, partition] of Object.entries(state.envelope.organizations)) {
    const persistence = { admissionScope, kind: 'organization-esi' } as const
    if (!invalidationScopeMatchesPersistence(scope, persistence)) {
      continue
    }
    for (const keyHash of Object.keys(partition.cache)) {
      state.entryState.removed(keyHash)
    }
  }
  removeEnvelopePartitions(state.envelope, scope)
}

function privateInvalidationScopeForEntry(
  entry: Pick<UseQueryEntry, 'key' | 'meta'>,
): PrivateQueryInvalidationScope | null {
  const persistence = readEsiPersistence(entry.meta)
  if (persistence?.kind === 'character-esi' || persistence?.kind === 'organization-esi') {
    return invalidationScopeForPersistence(persistence)
  }
  if (entry.key[0] !== PRIVATE_QUERY_KEYS.root[0]) {
    return null
  }
  if (entry.key[1] === 'characters') {
    return typeof entry.key[2] === 'number'
      ? { characterId: entry.key[2], kind: 'character' }
      : { kind: 'character' }
  }
  if (entry.key[1] === 'organization') {
    return { kind: 'organization' }
  }
  return { kind: 'all' }
}

function privateQueryEntryMatchesScope(
  entry: Pick<UseQueryEntry, 'key' | 'meta'>,
  scope: PrivateQueryInvalidationScope,
) {
  const entryScope = privateInvalidationScopeForEntry(entry)
  if (!entryScope) {
    return false
  }
  if (scope.kind === 'all') {
    return true
  }
  if (entryScope.kind === 'all' || entryScope.kind !== scope.kind) {
    return false
  }
  if (scope.kind === 'character' && entryScope.kind === 'character') {
    return (
      scope.characterId === undefined ||
      entryScope.characterId === undefined ||
      scope.characterId === entryScope.characterId
    )
  }
  return (
    scope.kind === 'organization' &&
    entryScope.kind === 'organization' &&
    (scope.admissionScope === undefined ||
      entryScope.admissionScope === undefined ||
      scope.admissionScope === entryScope.admissionScope)
  )
}

function initializeQueryCacheHooks(
  state: QueryPersistenceRuntimeState,
  privateLifecycle: PrivateQueryLifecycle,
  now: () => number,
  timers: QueryPersistenceTimers,
) {
  state.queryCache.$onAction(({ name, args, after, onError }) => {
    if (name === 'setQueryData') {
      const keyHash = toCacheKey(args[0] as EntryKey)
      after(() => {
        const currentTime = now()
        state.entryState.localWrite({
          keyHash,
          now: currentTime,
          priorSuccessAt: persistedOriginalSuccessAt(state, keyHash, currentTime),
        })
        touchQueryPersistenceState(state)
        reconcileRetainedDataExpiry(state, privateLifecycle, now, timers)
      })
      return
    }
    if (name === 'fetch') {
      const entry = args[0] as UseQueryEntry
      const persistenceEligible = shouldPersistEsiQuery(entry)
      const privateScope = privateInvalidationScopeForEntry(entry)
      const privateRequestIsCurrent =
        privateScope === null ? undefined : privateLifecycle.guardPrivateRequest()
      onError((error) => {
        if (privateRequestIsCurrent && !privateRequestIsCurrent()) {
          return
        }
        const scope = authoritativeDenialInvalidationScope(privateScope, error)
        if (scope) {
          void privateLifecycle.invalidate(scope, true, isMissingScopeDenial(error))
          return
        }
        if (persistenceEligible) {
          state.entryState.failed(entry.keyHash, error, entry.state.value.data !== undefined)
          touchQueryPersistenceState(state)
        }
      })
      after((entryState) => {
        if (privateRequestIsCurrent && !privateRequestIsCurrent()) {
          return
        }
        if (entryState.status === 'error') {
          const scope = authoritativeDenialInvalidationScope(privateScope, entryState.error)
          if (scope) {
            void privateLifecycle.invalidate(scope, true, isMissingScopeDenial(entryState.error))
          } else if (persistenceEligible) {
            state.entryState.failed(entry.keyHash, entryState.error, entryState.data !== undefined)
            touchQueryPersistenceState(state)
          }
          return
        }
        if (entryState.status !== 'success') {
          return
        }
        if (persistenceEligible) {
          recordSuccessfulCurrentResult(state, entry, 'fetch', now(), false, entryState.data)
          reconcileRetainedDataExpiry(state, privateLifecycle, now, timers)
          privateLifecycle.refreshAdmissionTimers()
        }
      })
      return
    }
    if (name === 'track' || name === 'untrack') {
      after(() => privateLifecycle.refreshAdmissionTimers())
      return
    }
    if (name === 'ensure') {
      after((entry) => {
        if (entry.state.value.status === 'success' && shouldPersistEsiQuery(entry)) {
          recordSuccessfulCurrentResult(state, entry, 'ssr', now())
          reconcileRetainedDataExpiry(state, privateLifecycle, now, timers)
        }
        privateLifecycle.refreshAdmissionTimers()
      })
      return
    }
    if (name !== 'remove') {
      return
    }
    const entry = args[0] as UseQueryEntry
    if (!shouldPersistEsiQuery(entry)) {
      return
    }
    after(() => {
      state.entryState.removed(entry.keyHash)
      touchQueryPersistenceState(state)
      if (removeTupleFromEnvelope(state.envelope, entry.keyHash)) {
        void persistCurrentEnvelope(state, privateLifecycle)
      }
      reconcileRetainedDataExpiry(state, privateLifecycle, now, timers)
    })
  })
}

function recordSuccessfulCurrentResult(
  state: QueryPersistenceRuntimeState,
  entry: UseQueryEntry,
  source: 'fetch' | 'ssr',
  currentTime: number,
  reconcileStagedRestore = false,
  data = entry.state.value.data,
) {
  const changed = state.entryState.succeeded({
    data,
    keyHash: entry.keyHash,
    now: currentTime,
    priorSuccessAt: persistedOriginalSuccessAt(state, entry.keyHash, currentTime),
    reconcileStagedRestore,
    source,
    when: entry.when,
  })
  const hydrationChanged = Object.hasOwn(state.pendingPublicHydration, entry.keyHash)
  if (hydrationChanged) {
    delete state.pendingPublicHydration[entry.keyHash]
  }
  if (changed || hydrationChanged) {
    touchQueryPersistenceState(state)
  }
}

function recordUnclassifiedSuccessfulEntries(state: QueryPersistenceRuntimeState, now: number) {
  for (const entry of state.queryCache.getEntries({ predicate: shouldPersistEsiQuery })) {
    if (entry.state.value.status !== 'success') {
      continue
    }
    recordSuccessfulCurrentResult(state, entry, 'ssr', now)
  }
}

function signalSuccessfulEntriesForPersistence(state: QueryPersistenceRuntimeState) {
  for (const entry of state.queryCache.getEntries({ predicate: shouldPersistEsiQuery })) {
    if (entry.state.value.status !== 'success') {
      continue
    }
    const when = entry.when
    state.queryCache.setEntryState(entry, { ...entry.state.value })
    entry.when = when
  }
}

function persistedOriginalSuccessAt(
  state: QueryPersistenceRuntimeState,
  keyHash: string,
  now: number,
) {
  const candidates = [
    state.pendingPublicHydration[keyHash]?.[2],
    state.envelope.public[keyHash]?.[2],
  ]
  for (const partition of Object.values(state.envelope.characters)) {
    candidates.push(partition.cache[keyHash]?.[2])
  }
  for (const partition of Object.values(state.envelope.organizations)) {
    candidates.push(partition.cache[keyHash]?.[2])
  }
  const valid = candidates.filter(
    (candidate): candidate is number =>
      typeof candidate === 'number' && Number.isFinite(candidate) && candidate <= now,
  )
  return valid.length === 0 ? undefined : Math.min(...valid)
}

function queryPersistencePresentation(
  state: QueryPersistenceRuntimeState,
  keyHash: string,
): EsiQueryPersistencePresentation {
  return state.entryState.readPresentation(keyHash)
}

function hasRetainedPrivateData(state: QueryPersistenceRuntimeState, activeOnly = false) {
  return state.queryCache.getEntries({ predicate: shouldPersistEsiQuery }).some((entry) => {
    if (
      entry.state.value.data === undefined ||
      state.entryState.readRetentionDeadline(entry.keyHash) === undefined ||
      (activeOnly && !entry.active)
    ) {
      return false
    }
    const persistence = readEsiPersistence(entry.meta)
    return !!persistence && persistence.kind !== 'public-esi'
  })
}

function authoritativeDenialInvalidationScope(
  privateScope: PrivateQueryInvalidationScope | null,
  error: unknown,
): PrivateQueryInvalidationScope | null {
  if (isAuthenticationDenial(error)) {
    return { kind: 'all' }
  }
  if (!(error instanceof ApiQueryError) || !privateScope || !error.code) {
    return null
  }
  if (privateScope.kind === 'character' && CHARACTER_AUTHORIZATION_DENIAL_CODES.has(error.code)) {
    return privateScope
  }
  if (
    privateScope.kind === 'organization' &&
    ORGANIZATION_AUTHORIZATION_DENIAL_CODES.has(error.code)
  ) {
    return privateScope
  }
  return null
}

function isMissingScopeDenial(error: unknown) {
  return error instanceof ApiQueryError && error.code === 'EVE_SCOPE_REQUIRED'
}

function notifyPrivateQueryInvalidation(
  subscribers: ReadonlySet<{
    readonly listener: () => void
    readonly scope: MaybeRefOrGetter<PrivateQueryInvalidationScope>
  }>,
  scope: PrivateQueryInvalidationScope,
) {
  for (const subscription of subscribers) {
    if (!invalidationScopesOverlap(toValue(subscription.scope), scope)) {
      continue
    }
    subscription.listener()
  }
}

function invalidationScopesOverlap(
  left: PrivateQueryInvalidationScope,
  right: PrivateQueryInvalidationScope,
) {
  if (left.kind === 'all' || right.kind === 'all') {
    return true
  }
  if (left.kind !== right.kind) {
    return false
  }
  if (left.kind === 'character' && right.kind === 'character') {
    return (
      left.characterId === undefined ||
      right.characterId === undefined ||
      left.characterId === right.characterId
    )
  }
  return (
    left.kind === 'organization' &&
    right.kind === 'organization' &&
    (left.admissionScope === undefined ||
      right.admissionScope === undefined ||
      left.admissionScope === right.admissionScope)
  )
}

async function persistCurrentEnvelope(
  state: QueryPersistenceRuntimeState,
  privateLifecycle: PrivateQueryLifecycle,
) {
  try {
    await privateLifecycle.writeStoredEnvelope(JSON.stringify(state.envelope))
  } catch {
    return
  }
}

function clearCorruptCacheState(
  state: QueryPersistenceRuntimeState,
  envelope: EsiQueryCacheEnvelope,
) {
  for (const entry of state.queryCache.getEntries({ predicate: shouldPersistEsiQuery })) {
    if (!state.entryState.hasRestoredData(entry.keyHash)) {
      continue
    }
    purgeQueryEntryData(state, entry)
    state.queryCache.remove(entry)
  }
  state.envelope = envelope
  state.pendingPublicHydration = createCache()
  state.entryState.reset()
}

function hydrateAbsoluteCache(queryCache: QueryCache, cache: PersistedQueryCache, now: number) {
  const hydrationCache: Parameters<typeof hydrateQueryCache>[1] = {}
  for (const [keyHash, [data, error, when, meta]] of Object.entries(cache)) {
    const key = JSON.parse(keyHash) as EntryKey
    const current = queryCache.get(key)
    if (current) {
      queryCache.setEntryState(current, { data, error, status: 'success' })
      current.when = when
    } else {
      hydrationCache[keyHash] = [data, error, Math.max(0, now - when), meta]
    }
  }
  hydrateQueryCache(queryCache, hydrationCache)
}

function extendRestoredEntries(queryCache: QueryCache) {
  for (const entry of queryCache.getEntries()) {
    if ('isRetrying' in entry.ext) {
      continue
    }
    Object.assign(entry, { ext: {} })
    queryCache.extend(entry)
  }
}

function authenticatedUserId(session: AuthSession | undefined) {
  return session?.authenticated ? session.account.userId : null
}

function settleRestoration(state: QueryPersistenceRuntimeState) {
  if (state.restorationSettled) {
    return
  }
  state.restorationSettled = true
  state.resolveRestoration()
}

function requireRuntime(queryCache: QueryCache) {
  const runtime = (queryCache as QueryCacheWithPersistence)[QUERY_PERSISTENCE_RUNTIME]
  if (!runtime) {
    throw new Error('Query persistence is not installed for this query cache.')
  }
  return runtime
}
