import {
  invalidateSerializedEnvelope,
  isInvalidationGeneration,
  mergePublicSerializedEnvelope,
  parsePersistedEnvelope,
  PERSISTED_ESI_QUERY_CACHE_KEY,
  readSerializedEnvelopeGeneration,
  serializeBoundedEnvelope,
  toPublicOnlySerializedEnvelope,
  type PrivateQueryInvalidationScope,
} from './envelope'
import { isExactRecord, isRecord } from './shape'
import {
  advanceScopeWatermarks,
  initialScopeWatermarks,
  type ScopeWatermarks,
} from './scope-watermarks'

const DATABASE_NAME = 'eve-space-query-cache'
const DATABASE_VERSION = 1
const OBJECT_STORE_NAME = 'query-cache'
const INVALIDATION_CONTROL_VERSION = 2
const LEGACY_PERSISTED_CACHE_KEY = 'eve-space-character-query-cache'
const INVALIDATION_CONTROL_KEY = 'eve-space-esi-query-cache-control'
const INVALIDATION_BARRIER_KEY = 'eve-space-esi-query-cache-invalidation-pending'

type InvalidationControl = ScopeWatermarks
type ControlRecord = {
  readonly version?: unknown
  readonly invalidationGeneration?: unknown
  readonly historyFromGeneration?: unknown
  readonly fullGeneration?: unknown
  readonly organizationGeneration?: unknown
  readonly charactersGeneration?: unknown
  readonly characterGenerations?: unknown
}

interface QueryPersistenceStorageRead {
  readonly generation: number | null
  readonly value: string | null
  readonly scopeHistory?: ScopeWatermarks
}

export interface QueryPersistenceStorageWrite {
  readonly generation: number | null
  readonly privateAccepted: boolean
  readonly scopeHistory?: ScopeWatermarks
}

interface QueryPersistenceStorageInvalidation {
  readonly generation: number
  readonly scope: PrivateQueryInvalidationScope
  readonly scopeHistory?: ScopeWatermarks
}

export interface QueryPersistenceStorage {
  readonly available: boolean
  invalidate(
    scope: PrivateQueryInvalidationScope,
    deleteEnvelope?: boolean,
  ): Promise<QueryPersistenceStorageInvalidation | null>
  read(): Promise<QueryPersistenceStorageRead>
  readGeneration(): Promise<ScopeWatermarks | null>
  removeEnvelope(): Promise<void>
  write(value: string, allowPrivateWrite: boolean): Promise<QueryPersistenceStorageWrite>
}

interface IndexedDbRequest extends EventTarget {
  readonly result: unknown
  readonly error: DOMException | null
}

interface IndexedDbStore {
  get(key: IDBValidKey): IndexedDbRequest
  put(value: unknown, key: IDBValidKey): IndexedDbRequest
  delete(key: IDBValidKey): IndexedDbRequest
}

interface IndexedDbTransaction extends EventTarget {
  readonly error: DOMException | null
  objectStore(name: string): IndexedDbStore
  abort(): void
}

interface IndexedDbDatabase extends EventTarget {
  readonly objectStoreNames: Pick<DOMStringList, 'contains'>
  createObjectStore(name: string): unknown
  transaction(name: string, mode: IDBTransactionMode): IndexedDbTransaction
  close(): void
}

interface IndexedDbFactory {
  open(name: string, version: number): IndexedDbRequest & { readonly result: IndexedDbDatabase }
}

export function createIndexedDbQueryPersistenceStorage(
  options: {
    readonly indexedDb?: IndexedDbFactory
    readonly localStorage?: Storage
    readonly now?: () => number
  } = {},
): QueryPersistenceStorage {
  const indexedDb = options.indexedDb ?? globalThis.indexedDB
  if (!indexedDb) {
    return unavailableStorage
  }

  const now = options.now ?? Date.now
  const durableState = options.localStorage ?? readBrowserLocalStorage()
  let databasePromise: Promise<IndexedDbDatabase> | undefined
  let operationQueue = Promise.resolve()

  function run<T>(operation: () => Promise<T>) {
    const result = operationQueue.then(operation, operation)
    operationQueue = result.then(
      () => {},
      () => {},
    )
    return result
  }

  function openDatabase() {
    databasePromise ??= new Promise<IndexedDbDatabase>((resolve, reject) => {
      const request = indexedDb.open(DATABASE_NAME, DATABASE_VERSION)
      request.addEventListener('upgradeneeded', () => {
        if (!request.result.objectStoreNames.contains(OBJECT_STORE_NAME)) {
          request.result.createObjectStore(OBJECT_STORE_NAME)
        }
      })
      request.addEventListener('success', () => {
        request.result.addEventListener('versionchange', () => request.result.close(), {
          once: true,
        })
        resolve(request.result)
      })
      request.addEventListener('error', () => reject(storageRejectionError(request.error)), {
        once: true,
      })
      request.addEventListener(
        'blocked',
        () => reject(new Error('Persisted query cache is blocked.')),
        { once: true },
      )
    })
    return databasePromise
  }

  return {
    available: true,
    invalidate(scope, deleteEnvelope = false) {
      return run(async () => {
        const barrier = beginInvalidationBarrier(durableState)
        let privatePersistencePoisoned = false
        try {
          const database = await openDatabase()
          const indexedDbBarrierPending = await beginIndexedDbInvalidationBarrier(database)
          const effectiveScope =
            barrier.pending || indexedDbBarrierPending ? ({ kind: 'all' } as const) : scope
          const result = await completeValueTransaction<QueryPersistenceStorageInvalidation | null>(
            database,
            'readwrite',
            (store, complete, fail) => {
              readStoredState(store, fail, (storedValue, storedControl) => {
                const control = parseInvalidationControl(storedControl)
                if (storedControl !== undefined && !control) {
                  privatePersistencePoisoned = true
                  poisonPrivatePersistence(store)
                  store.delete(INVALIDATION_BARRIER_KEY)
                  complete(null)
                  return
                }
                const previous = control ?? initialScopeWatermarks()
                const resolvedScope =
                  !control && storedValue !== null ? ({ kind: 'all' } as const) : effectiveScope
                const currentGeneration = previous.invalidationGeneration
                if (currentGeneration === Number.MAX_SAFE_INTEGER) {
                  privatePersistencePoisoned = true
                  poisonPrivatePersistence(store)
                  store.delete(INVALIDATION_BARRIER_KEY)
                  complete(null)
                  return
                }
                const generation = currentGeneration + 1
                const scopeHistory = advanceScopeWatermarks(previous, resolvedScope)
                store.put(scopeHistory, INVALIDATION_CONTROL_KEY)
                store.delete(INVALIDATION_BARRIER_KEY)
                if (deleteEnvelope) {
                  store.delete(PERSISTED_ESI_QUERY_CACHE_KEY)
                } else if (storedValue !== null) {
                  const nextValue = invalidateSerializedEnvelope(
                    storedValue,
                    currentGeneration,
                    generation,
                    resolvedScope,
                    now(),
                  )
                  if (nextValue === null) {
                    store.delete(PERSISTED_ESI_QUERY_CACHE_KEY)
                  } else {
                    store.put(nextValue, PERSISTED_ESI_QUERY_CACHE_KEY)
                  }
                }
                complete({ generation, scope: resolvedScope, scopeHistory })
              })
            },
          )
          if (result || privatePersistencePoisoned) {
            clearInvalidationBarrier(durableState, barrier.token)
          }
          return result
        } catch {
          return null
        }
      })
    },
    read() {
      return run(async () => {
        const database = await openDatabase()
        const recoveryToken = readInvalidationBarrier(durableState)
        const recoverPendingInvalidation = recoveryToken !== null
        let privatePersistencePoisoned = false
        const result = await completeValueTransaction<QueryPersistenceStorageRead>(
          database,
          'readwrite',
          (store, complete, fail) => {
            store.delete(LEGACY_PERSISTED_CACHE_KEY)
            readStoredState(store, fail, (storedValue, storedControl, storedBarrier) => {
              privatePersistencePoisoned = completeStorageRead(
                store,
                complete,
                {
                  barrier: storedBarrier,
                  control: storedControl,
                  value: storedValue,
                },
                recoverPendingInvalidation,
                now(),
              )
            })
          },
        )
        if (
          recoverPendingInvalidation &&
          (result.generation !== null || privatePersistencePoisoned)
        ) {
          clearInvalidationBarrier(durableState, recoveryToken)
        }
        return result
      })
    },
    readGeneration() {
      return run(async () => {
        const database = await openDatabase()
        return completeValueTransaction<ScopeWatermarks | null>(
          database,
          'readonly',
          (store, complete, fail) => {
            readStoredState(store, fail, (_storedValue, storedControl, storedBarrier) => {
              if (readInvalidationBarrier(durableState) !== null || storedBarrier !== undefined) {
                complete(null)
                return
              }
              complete(parseInvalidationControl(storedControl))
            })
          },
        )
      })
    },
    removeEnvelope() {
      return run(async () => {
        const database = await openDatabase()
        await completeTransaction(database, 'readwrite', (store) =>
          store.delete(PERSISTED_ESI_QUERY_CACHE_KEY),
        )
      })
    },
    write(value, allowPrivateWrite) {
      return run(async () => {
        const candidate = parsePersistedEnvelope(value, now()).envelope
        const database = await openDatabase()
        return completeValueTransaction<QueryPersistenceStorageWrite>(
          database,
          'readwrite',
          (store, complete, fail) => {
            readStoredState(store, fail, (storedValue, storedControl, storedBarrier) => {
              const control = parseInvalidationControl(storedControl)
              if (storedControl !== undefined && !control) {
                store.put(
                  toPublicOnlySerializedEnvelope(JSON.stringify(candidate), 0, now())!,
                  PERSISTED_ESI_QUERY_CACHE_KEY,
                )
                complete({ generation: null, privateAccepted: false })
                return
              }

              const scopeHistory = control ?? initialScopeWatermarks()
              const generation = scopeHistory.invalidationGeneration
              if (
                !control ||
                (isExactRecord(storedControl, ['version', 'invalidationGeneration']) &&
                  storedControl.version === 1)
              ) {
                store.put(scopeHistory, INVALIDATION_CONTROL_KEY)
              }
              const invalidationPending =
                readInvalidationBarrier(durableState) !== null || storedBarrier !== undefined
              const privateAccepted =
                !invalidationPending &&
                (control !== null || storedValue === null) &&
                allowPrivateWrite &&
                candidate.invalidationGeneration === generation
              const serializedCandidate = serializeBoundedEnvelope(candidate)
              let nextValue: string
              if (privateAccepted) {
                nextValue = serializedCandidate
              } else if (invalidationPending) {
                nextValue = toPublicOnlySerializedEnvelope(serializedCandidate, generation, now())!
              } else {
                nextValue = mergePublicSerializedEnvelope(candidate, storedValue, generation, now())
              }
              store.put(nextValue, PERSISTED_ESI_QUERY_CACHE_KEY)
              complete({ generation, privateAccepted, scopeHistory })
            })
          },
        )
      })
    },
  }
}

const unavailableStorage: QueryPersistenceStorage = {
  available: false,
  invalidate: async () => null,
  read: async () => ({ generation: null, value: null }),
  readGeneration: async () => null,
  removeEnvelope: async () => {},
  write: async () => ({ generation: null, privateAccepted: false }),
}

interface StoredState {
  readonly value: string | null
  readonly control: unknown
  readonly barrier: unknown
}

function completeStorageRead(
  store: IndexedDbStore,
  complete: (value: QueryPersistenceStorageRead) => void,
  storedState: StoredState,
  recoverPendingInvalidation: boolean,
  now: number,
) {
  const control = parseInvalidationControl(storedState.control)
  if (recoverPendingInvalidation || storedState.barrier !== undefined) {
    return completeRecoveredStorageRead(store, complete, storedState, control, now)
  }
  if (storedState.control !== undefined && !control) {
    completeStorageReadWithInvalidControl(store, complete, storedState.value, now)
    return false
  }
  const legacyControl =
    isExactRecord(storedState.control, ['version', 'invalidationGeneration']) &&
    storedState.control.version === 1
  completeStorageReadAtGeneration(store, complete, storedState.value, legacyControl, control, now)
  return false
}

function completeRecoveredStorageRead(
  store: IndexedDbStore,
  complete: (value: QueryPersistenceStorageRead) => void,
  storedState: StoredState,
  control: ScopeWatermarks | null,
  now: number,
) {
  const invalidControl = storedState.control !== undefined && !control
  if (invalidControl || control?.invalidationGeneration === Number.MAX_SAFE_INTEGER) {
    poisonPrivatePersistence(store)
    store.delete(INVALIDATION_BARRIER_KEY)
    complete({ generation: null, value: null })
    return true
  }

  const generation = (control?.invalidationGeneration ?? 0) + 1
  const scopeHistory = advanceScopeWatermarks(control ?? initialScopeWatermarks(), { kind: 'all' })
  store.put(scopeHistory, INVALIDATION_CONTROL_KEY)
  store.delete(INVALIDATION_BARRIER_KEY)
  const value = toPublicOnlySerializedEnvelope(storedState.value, generation, now)
  storeSerializedEnvelope(store, value)
  complete({ generation, value, scopeHistory })
  return false
}

function completeStorageReadWithInvalidControl(
  store: IndexedDbStore,
  complete: (value: QueryPersistenceStorageRead) => void,
  storedValue: string | null,
  now: number,
) {
  const publicOnly = toPublicOnlySerializedEnvelope(storedValue, 0, now)
  if (publicOnly === null || readSerializedEnvelopeGeneration(publicOnly) === null) {
    store.delete(PERSISTED_ESI_QUERY_CACHE_KEY)
  } else {
    store.put(publicOnly, PERSISTED_ESI_QUERY_CACHE_KEY)
  }
  complete({ generation: null, value: publicOnly })
}

function completeStorageReadAtGeneration(
  store: IndexedDbStore,
  complete: (value: QueryPersistenceStorageRead) => void,
  storedValue: string | null,
  legacyControl: boolean,
  control: ScopeWatermarks | null,
  now: number,
) {
  const generation = control?.invalidationGeneration ?? 0
  const scopeHistory = control ?? initialScopeWatermarks()
  if (!control || legacyControl) {
    store.put(scopeHistory, INVALIDATION_CONTROL_KEY)
  }

  const envelopeGeneration = readSerializedEnvelopeGeneration(storedValue)
  if (!control && storedValue !== null) {
    const value = toPublicOnlySerializedEnvelope(storedValue, generation, now)
    storeSerializedEnvelope(store, value)
    complete({ generation, value, scopeHistory })
    return
  }
  if (storedValue === null || envelopeGeneration === generation) {
    complete({ generation, value: storedValue, scopeHistory })
    return
  }

  const value = toPublicOnlySerializedEnvelope(storedValue, generation, now)
  if (value === null) {
    store.delete(PERSISTED_ESI_QUERY_CACHE_KEY)
    complete({ generation, value: null, scopeHistory })
    return
  }
  if (value === storedValue && envelopeGeneration === null) {
    store.delete(PERSISTED_ESI_QUERY_CACHE_KEY)
  } else {
    store.put(value, PERSISTED_ESI_QUERY_CACHE_KEY)
  }
  complete({
    generation,
    value: envelopeGeneration === null ? storedValue : value,
    scopeHistory,
  })
}

function storeSerializedEnvelope(store: IndexedDbStore, value: string | null) {
  if (value === null) {
    store.delete(PERSISTED_ESI_QUERY_CACHE_KEY)
  } else {
    store.put(value, PERSISTED_ESI_QUERY_CACHE_KEY)
  }
}

function poisonPrivatePersistence(store: IndexedDbStore) {
  store.put(
    { invalidationGeneration: null, version: INVALIDATION_CONTROL_VERSION },
    INVALIDATION_CONTROL_KEY,
  )
  store.delete(PERSISTED_ESI_QUERY_CACHE_KEY)
}

function readBrowserLocalStorage() {
  try {
    return globalThis.localStorage
  } catch {
    return
  }
}

function beginInvalidationBarrier(storage: Storage | undefined) {
  try {
    if (!storage) {
      return { pending: false, token: undefined }
    }
    const pending = storage.getItem(INVALIDATION_BARRIER_KEY) !== null
    const token = globalThis.crypto.randomUUID()
    storage.setItem(INVALIDATION_BARRIER_KEY, token)
    return { pending, token }
  } catch {
    return { pending: false, token: undefined }
  }
}

function readInvalidationBarrier(storage: Storage | undefined) {
  try {
    return storage?.getItem(INVALIDATION_BARRIER_KEY) ?? null
  } catch {
    return null
  }
}

function clearInvalidationBarrier(storage: Storage | undefined, token?: string) {
  try {
    if (storage && (token === undefined || storage.getItem(INVALIDATION_BARRIER_KEY) === token)) {
      storage.removeItem(INVALIDATION_BARRIER_KEY)
    }
  } catch {
    return
  }
}

function beginIndexedDbInvalidationBarrier(database: IndexedDbDatabase) {
  return completeValueTransaction<boolean>(database, 'readwrite', (store, complete, fail) => {
    const request = store.get(INVALIDATION_BARRIER_KEY)
    request.addEventListener(
      'success',
      () => {
        const pending = request.result !== undefined
        store.put(true, INVALIDATION_BARRIER_KEY)
        complete(pending)
      },
      { once: true },
    )
    request.addEventListener('error', () => fail(request.error), { once: true })
  })
}

function readStoredState(
  store: IndexedDbStore,
  fail: (error: unknown) => void,
  complete: (storedValue: string | null, storedControl: unknown, storedBarrier: unknown) => void,
) {
  const valueRequest = store.get(PERSISTED_ESI_QUERY_CACHE_KEY)
  const controlRequest = store.get(INVALIDATION_CONTROL_KEY)
  const barrierRequest = store.get(INVALIDATION_BARRIER_KEY)
  let valueReady = false
  let controlReady = false
  let barrierReady = false
  const finish = () => {
    if (!valueReady || !controlReady || !barrierReady) {
      return
    }
    complete(
      typeof valueRequest.result === 'string' ? valueRequest.result : null,
      controlRequest.result,
      barrierRequest.result,
    )
  }
  valueRequest.addEventListener(
    'success',
    () => {
      valueReady = true
      finish()
    },
    { once: true },
  )
  controlRequest.addEventListener(
    'success',
    () => {
      controlReady = true
      finish()
    },
    { once: true },
  )
  barrierRequest.addEventListener(
    'success',
    () => {
      barrierReady = true
      finish()
    },
    { once: true },
  )
  valueRequest.addEventListener('error', () => fail(valueRequest.error), { once: true })
  controlRequest.addEventListener('error', () => fail(controlRequest.error), { once: true })
  barrierRequest.addEventListener('error', () => fail(barrierRequest.error), { once: true })
}

const parseCharacterWatermarks = (control: ControlRecord, maximum: number) => {
  const raw = control.characterGenerations
  if (!isRecord(raw) || Object.keys(raw).length > 128) {
    return null
  }
  const parsed: Record<string, number> = {}
  for (const [id, generation] of Object.entries(raw)) {
    if (
      !/^[1-9]\d*$/.test(id) ||
      !Number.isSafeInteger(Number(id)) ||
      !isInvalidationGeneration(generation) ||
      generation > maximum
    ) {
      return null
    }
    parsed[id] = generation
  }
  return parsed
}

const parseCurrentControl = (value: ControlRecord): InvalidationControl | null => {
  if (
    !isExactRecord(value, [
      'version',
      'invalidationGeneration',
      'historyFromGeneration',
      'fullGeneration',
      'organizationGeneration',
      'charactersGeneration',
      'characterGenerations',
    ]) ||
    value.version !== INVALIDATION_CONTROL_VERSION
  ) {
    return null
  }
  const {
    invalidationGeneration,
    historyFromGeneration,
    fullGeneration,
    organizationGeneration,
    charactersGeneration,
  } = value
  if (
    !isInvalidationGeneration(invalidationGeneration) ||
    !isInvalidationGeneration(historyFromGeneration) ||
    !isInvalidationGeneration(fullGeneration) ||
    !isInvalidationGeneration(organizationGeneration) ||
    !isInvalidationGeneration(charactersGeneration) ||
    historyFromGeneration > invalidationGeneration
  ) {
    return null
  }
  const parsedCharacters = parseCharacterWatermarks(value, invalidationGeneration)
  if (!parsedCharacters) {
    return null
  }
  const latest = Math.max(
    fullGeneration,
    organizationGeneration,
    charactersGeneration,
    ...Object.values(parsedCharacters),
  )
  if (
    latest > invalidationGeneration ||
    (invalidationGeneration > historyFromGeneration && latest !== invalidationGeneration)
  ) {
    return null
  }
  return {
    version: INVALIDATION_CONTROL_VERSION,
    invalidationGeneration,
    historyFromGeneration,
    fullGeneration,
    organizationGeneration,
    charactersGeneration,
    characterGenerations: parsedCharacters,
  }
}

function parseInvalidationControl(value: unknown): InvalidationControl | null {
  if (!isRecord(value)) {
    return null
  }
  if (isExactRecord(value, ['version', 'invalidationGeneration']) && value.version === 1) {
    return isInvalidationGeneration(value.invalidationGeneration)
      ? initialScopeWatermarks(value.invalidationGeneration)
      : null
  }
  return parseCurrentControl(value)
}

function completeTransaction(
  database: IndexedDbDatabase,
  mode: IDBTransactionMode,
  operation: (store: IndexedDbStore) => IndexedDbRequest,
) {
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(OBJECT_STORE_NAME, mode)
    operation(transaction.objectStore(OBJECT_STORE_NAME))
    transaction.addEventListener('complete', () => resolve(), { once: true })
    transaction.addEventListener('error', () => reject(storageRejectionError(transaction.error)), {
      once: true,
    })
    transaction.addEventListener('abort', () => reject(storageRejectionError(transaction.error)), {
      once: true,
    })
  })
}

function completeValueTransaction<T>(
  database: IndexedDbDatabase,
  mode: IDBTransactionMode,
  operation: (
    store: IndexedDbStore,
    complete: (value: T) => void,
    fail: (error: unknown) => void,
  ) => void,
) {
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(OBJECT_STORE_NAME, mode)
    let hasResult = false
    let result: T
    const fail = (error: unknown) => {
      try {
        transaction.abort()
      } catch {
        reject(storageRejectionError(error))
      }
    }
    operation(
      transaction.objectStore(OBJECT_STORE_NAME),
      (value) => {
        result = value
        hasResult = true
      },
      fail,
    )
    transaction.addEventListener(
      'complete',
      () => {
        if (hasResult) {
          resolve(result)
        } else {
          reject(new Error('Persisted query cache transaction completed without a result.'))
        }
      },
      { once: true },
    )
    transaction.addEventListener('error', () => reject(storageRejectionError(transaction.error)), {
      once: true,
    })
    transaction.addEventListener('abort', () => reject(storageRejectionError(transaction.error)), {
      once: true,
    })
  })
}

function storageRejectionError(reason: unknown) {
  return reason instanceof Error
    ? reason
    : new Error('Persisted query cache storage operation failed.', { cause: reason })
}
