import { describe, expect, it } from 'vitest'
import {
  createIndexedDbQueryPersistenceStorage,
  type QueryPersistenceStorage,
} from '../../app/query-persistence/storage'
import {
  PERSISTED_ESI_QUERY_CACHE_MAX_BYTES,
  type EsiQueryCacheEnvelope,
  type PersistedQueryTuple,
} from '../../app/query-persistence/envelope'

const NOW = Date.parse('2026-09-14T11:00:00.000Z')
const PUBLIC_KEY = '["public","characters",7]'
const CHARACTER_KEY = '["private","characters",7,"overview"]'
const ORGANIZATION_KEY = '["private","organization","activities"]'
const ORGANIZATION_SCOPE = 'organization:v1:core:member:organization.activities'
const MODULE_KEY =
  '["private","organization",3,"corporations",99,"modules","organization-activity","detail"]'
const MODULE_SCOPE = 'organization:v1:organization-activity:member:organization-activity.view'

describe('IndexedDB query persistence storage', () => {
  it('atomically advances generation and rejects an obsolete private write', async () => {
    const storage = createStorage()
    const initial = envelope('Initial public')
    await storage.write(JSON.stringify(initial), true)

    await expect(storage.invalidate({ kind: 'character', characterId: 7 })).resolves.toEqual({
      generation: 1,
      scope: { kind: 'character', characterId: 7 },
    })

    const stale = envelope('Updated public')
    await expect(storage.write(JSON.stringify(stale), true)).resolves.toEqual({
      generation: 1,
      privateAccepted: false,
    })
    const restored = await storage.read()

    expect(restored.generation).toBe(1)
    expect(JSON.parse(restored.value!)).toMatchObject({
      invalidationGeneration: 1,
      public: { [PUBLIC_KEY]: tuple({ name: 'Updated public' }, { kind: 'public-esi' }) },
      characters: {},
      organizations: initial.organizations,
    })
  })

  it('keeps the generation control when the ordinary envelope is removed', async () => {
    const storage = createStorage()
    await storage.write(JSON.stringify(envelope('Public')), true)

    await storage.removeEnvelope()

    await expect(storage.read()).resolves.toEqual({ generation: 0, value: null })
    await expect(storage.readGeneration()).resolves.toBe(0)
  })

  it('rejects and removes an oversized envelope during restoration', async () => {
    const indexedDb = new FakeIndexedDb()
    indexedDb.setRecord(
      'eve-space-esi-query-cache',
      'x'.repeat(PERSISTED_ESI_QUERY_CACHE_MAX_BYTES + 1),
    )
    const storage = createIndexedDbQueryPersistenceStorage({
      indexedDb: indexedDb as unknown as IDBFactory,
      localStorage: new FakeStorage(),
      now: () => NOW,
    })

    await expect(storage.read()).resolves.toEqual({ generation: 0, value: null })
    await expect(storage.read()).resolves.toEqual({ generation: 0, value: null })
  })

  it('invalidates one module scope atomically and rejects its stale captured-generation write', async () => {
    const storage = createStorage()
    const initial = envelope('Initial public')
    const staleWrite = envelope('Updated public')
    await storage.write(JSON.stringify(initial), true)

    await expect(
      storage.invalidate({ kind: 'organization', admissionScope: MODULE_SCOPE }),
    ).resolves.toEqual({
      generation: 1,
      scope: { kind: 'organization', admissionScope: MODULE_SCOPE },
    })
    await expect(storage.write(JSON.stringify(staleWrite), true)).resolves.toEqual({
      generation: 1,
      privateAccepted: false,
    })

    const restored = JSON.parse((await storage.read()).value!) as EsiQueryCacheEnvelope
    expect(restored.invalidationGeneration).toBe(1)
    expect(restored.public).toEqual({
      [PUBLIC_KEY]: tuple({ name: 'Updated public' }, { kind: 'public-esi' }),
    })
    expect(restored.characters).toEqual(initial.characters)
    expect(restored.organizations[ORGANIZATION_SCOPE]).toEqual(
      initial.organizations[ORGANIZATION_SCOPE],
    )
    expect(restored.organizations[MODULE_SCOPE]).toBeUndefined()
  })

  it('physically discards private partitions when durable control is invalid', async () => {
    const indexedDb = new FakeIndexedDb()
    const localStorage = new FakeStorage()
    const storage = createIndexedDbQueryPersistenceStorage({
      indexedDb: indexedDb as unknown as IDBFactory,
      localStorage,
      now: () => NOW,
    })
    await storage.write(JSON.stringify(envelope('Initial public')), true)
    indexedDb.setRecord('eve-space-esi-query-cache-control', {
      version: 1,
      invalidationGeneration: 'invalid',
    })

    const restored = await storage.read()

    expect(restored.generation).toBeNull()
    expect(JSON.parse(restored.value!)).toMatchObject({
      public: { [PUBLIC_KEY]: tuple({ name: 'Initial public' }, { kind: 'public-esi' }) },
      characters: {},
      organizations: {},
    })

    await expect(storage.write(JSON.stringify(envelope('Updated public')), true)).resolves.toEqual({
      generation: null,
      privateAccepted: false,
    })
    expect(JSON.parse((await storage.read()).value!)).toMatchObject({
      public: { [PUBLIC_KEY]: tuple({ name: 'Updated public' }, { kind: 'public-esi' }) },
      characters: {},
      organizations: {},
    })
  })

  it('recovers a failed invalidation on reload before private data can be admitted again', async () => {
    const indexedDb = new FakeIndexedDb()
    const localStorage = new FakeStorage()
    const storage = createIndexedDbQueryPersistenceStorage({
      indexedDb: indexedDb as unknown as IDBFactory,
      localStorage,
      now: () => NOW,
    })
    await storage.write(JSON.stringify(envelope('Initial public')), true)
    indexedDb.rejectNextTransaction()

    await expect(storage.invalidate({ kind: 'character', characterId: 7 })).resolves.toBeNull()

    const reloaded = createIndexedDbQueryPersistenceStorage({
      indexedDb: indexedDb as unknown as IDBFactory,
      localStorage,
      now: () => NOW,
    })
    const restored = await reloaded.read()
    expect(restored.generation).toBe(1)
    expect(JSON.parse(restored.value!)).toMatchObject({
      invalidationGeneration: 1,
      public: { [PUBLIC_KEY]: tuple({ name: 'Initial public' }, { kind: 'public-esi' }) },
      characters: {},
      organizations: {},
    })
    await expect(reloaded.write(JSON.stringify(envelope('Updated public')), true)).resolves.toEqual(
      {
        generation: 1,
        privateAccepted: false,
      },
    )
  })

  it('uses the IndexedDB barrier when local storage is unavailable', async () => {
    const indexedDb = new FakeIndexedDb()
    const localStorage = new ThrowingStorage()
    const storage = createIndexedDbQueryPersistenceStorage({
      indexedDb: indexedDb as unknown as IDBFactory,
      localStorage,
      now: () => NOW,
    })
    await storage.write(JSON.stringify(envelope('Initial public')), true)
    indexedDb.rejectTransactionAfter(1)

    await expect(storage.invalidate({ kind: 'character', characterId: 7 })).resolves.toBeNull()
    await expect(storage.readGeneration()).resolves.toBeNull()

    const reloaded = createIndexedDbQueryPersistenceStorage({
      indexedDb: indexedDb as unknown as IDBFactory,
      localStorage,
      now: () => NOW,
    })
    const restored = await reloaded.read()
    expect(restored.generation).toBe(1)
    expect(JSON.parse(restored.value!)).toMatchObject({
      invalidationGeneration: 1,
      public: { [PUBLIC_KEY]: tuple({ name: 'Initial public' }, { kind: 'public-esi' }) },
      characters: {},
      organizations: {},
    })
  })

  it('reports a full invalidation when a later request recovers a pending barrier', async () => {
    const indexedDb = new FakeIndexedDb()
    const localStorage = new FakeStorage()
    const storage = createIndexedDbQueryPersistenceStorage({
      indexedDb: indexedDb as unknown as IDBFactory,
      localStorage,
      now: () => NOW,
    })
    await storage.write(JSON.stringify(envelope('Initial public')), true)
    indexedDb.rejectTransactionAfter(1)
    await expect(storage.invalidate({ kind: 'character', characterId: 7 })).resolves.toBeNull()

    await expect(
      storage.invalidate({ kind: 'organization', admissionScope: ORGANIZATION_SCOPE }),
    ).resolves.toEqual({ generation: 1, scope: { kind: 'all' } })
    const restored = JSON.parse((await storage.read()).value!) as EsiQueryCacheEnvelope
    expect(restored.characters).toEqual({})
    expect(restored.organizations).toEqual({})
  })

  it.each([
    ['malformed', { version: 1, invalidationGeneration: 'invalid' }],
    ['exhausted', { version: 1, invalidationGeneration: Number.MAX_SAFE_INTEGER }],
  ])('poisons %s durable control during invalidation', async (_label, invalidControl) => {
    const indexedDb = new FakeIndexedDb()
    const localStorage = new FakeStorage()
    const storage = createIndexedDbQueryPersistenceStorage({
      indexedDb: indexedDb as unknown as IDBFactory,
      localStorage,
      now: () => NOW,
    })
    await storage.write(JSON.stringify(envelope('Initial public')), true)
    indexedDb.setRecord('eve-space-esi-query-cache-control', invalidControl)

    await expect(storage.invalidate({ kind: 'character', characterId: 7 })).resolves.toBeNull()
    await expect(storage.read()).resolves.toEqual({ generation: null, value: null })
    await expect(storage.write(JSON.stringify(envelope('Updated public')), true)).resolves.toEqual({
      generation: null,
      privateAccepted: false,
    })
    const restored = JSON.parse((await storage.read()).value!) as EsiQueryCacheEnvelope
    expect(restored.public).toEqual({
      [PUBLIC_KEY]: tuple({ name: 'Updated public' }, { kind: 'public-esi' }),
    })
    expect(restored.characters).toEqual({})
    expect(restored.organizations).toEqual({})
  })
})

function createStorage(): QueryPersistenceStorage {
  return createIndexedDbQueryPersistenceStorage({
    indexedDb: new FakeIndexedDb() as unknown as IDBFactory,
    localStorage: new FakeStorage(),
    now: () => NOW,
  })
}

function envelope(publicName: string): EsiQueryCacheEnvelope {
  return {
    version: 1,
    invalidationGeneration: 0,
    public: { [PUBLIC_KEY]: tuple({ name: publicName }, { kind: 'public-esi' }) },
    characters: {
      7: {
        ownerUserId: 'user-1',
        admissionRevision: 'character-revision-1',
        cache: {
          [CHARACTER_KEY]: tuple({ name: 'Character' }, { kind: 'character-esi', characterId: 7 }),
        },
      },
    },
    organizations: {
      [ORGANIZATION_SCOPE]: {
        ownerUserId: 'user-1',
        organizationVersion: 3,
        admissionRevision: 'organization-revision-1',
        validUntil: null,
        cache: {
          [ORGANIZATION_KEY]: tuple(
            { name: 'Organization' },
            { kind: 'organization-esi', admissionScope: ORGANIZATION_SCOPE },
          ),
        },
      },
      [MODULE_SCOPE]: {
        ownerUserId: 'user-1',
        organizationVersion: 3,
        admissionRevision: 'organization-revision-1',
        validUntil: null,
        cache: {
          [MODULE_KEY]: tuple(
            { name: 'Module' },
            { kind: 'organization-esi', admissionScope: MODULE_SCOPE },
          ),
        },
      },
    },
  }
}

function tuple(
  data: unknown,
  esiPersistence:
    | { readonly kind: 'public-esi' }
    | { readonly kind: 'character-esi'; readonly characterId: number }
    | { readonly kind: 'organization-esi'; readonly admissionScope: string },
): PersistedQueryTuple {
  return [data, null, NOW, { esiPersistence }]
}

class FakeIndexedDb {
  private readonly database = new FakeDatabase()
  private opened = false

  open() {
    const request = new FakeOpenRequest(this.database)
    queueMicrotask(() => {
      if (!this.opened) {
        this.opened = true
        request.dispatchEvent(new Event('upgradeneeded'))
      }
      request.dispatchEvent(new Event('success'))
    })
    return request as unknown as IDBOpenDBRequest
  }

  setRecord(key: IDBValidKey, value: unknown) {
    this.database.setRecord(key, value)
  }

  rejectNextTransaction() {
    this.database.rejectNextTransaction()
  }

  rejectTransactionAfter(successfulTransactions: number) {
    this.database.rejectTransactionAfter(successfulTransactions)
  }
}

class FakeDatabase extends EventTarget {
  readonly objectStoreNames = {
    contains: () => this.storeCreated,
  } as DOMStringList
  private readonly records = new Map<IDBValidKey, unknown>()
  private transactionsBeforeRejection: number | null = null
  private storeCreated = false

  createObjectStore() {
    this.storeCreated = true
    return {} as IDBObjectStore
  }

  transaction() {
    const rejectTransaction = this.transactionsBeforeRejection === 0
    if (this.transactionsBeforeRejection !== null) {
      this.transactionsBeforeRejection -= 1
      if (rejectTransaction) this.transactionsBeforeRejection = null
    }
    const transaction = new FakeTransaction(this.records, rejectTransaction)
    return transaction as unknown as IDBTransaction
  }

  close() {}

  setRecord(key: IDBValidKey, value: unknown) {
    this.records.set(key, structuredClone(value))
  }

  rejectNextTransaction() {
    this.transactionsBeforeRejection = 0
  }

  rejectTransactionAfter(successfulTransactions: number) {
    this.transactionsBeforeRejection = successfulTransactions
  }
}

class FakeTransaction extends EventTarget {
  readonly error = null
  private completionRevision = 0
  private finished = false
  private pending = 0
  private readonly store: FakeObjectStore

  constructor(
    records: Map<IDBValidKey, unknown>,
    private readonly rejectRequests: boolean,
  ) {
    super()
    this.store = new FakeObjectStore(records, this)
    this.queueCompletion()
  }

  objectStore() {
    return this.store as unknown as IDBObjectStore
  }

  request(operation: () => unknown) {
    const request = new FakeRequest()
    this.pending += 1
    this.completionRevision += 1
    queueMicrotask(() => {
      if (this.finished) return
      if (this.rejectRequests) {
        request.error = new DOMException('IndexedDB transaction failed.', 'UnknownError')
        request.dispatchEvent(new Event('error'))
        this.pending -= 1
        this.queueCompletion()
        return
      }
      try {
        request.result = structuredClone(operation())
        request.dispatchEvent(new Event('success'))
      } catch (error) {
        request.error = error instanceof DOMException ? error : new DOMException(String(error))
        request.dispatchEvent(new Event('error'))
      } finally {
        this.pending -= 1
        this.queueCompletion()
      }
    })
    return request as unknown as IDBRequest
  }

  abort() {
    if (this.finished) return
    this.finished = true
    this.dispatchEvent(new Event('abort'))
  }

  private queueCompletion() {
    const revision = ++this.completionRevision
    queueMicrotask(() => {
      if (this.finished || this.pending > 0 || revision !== this.completionRevision) return
      this.finished = true
      this.dispatchEvent(new Event('complete'))
    })
  }
}

class FakeObjectStore {
  constructor(
    private readonly records: Map<IDBValidKey, unknown>,
    private readonly transaction: FakeTransaction,
  ) {}

  get(key: IDBValidKey) {
    return this.transaction.request(() => this.records.get(key))
  }

  put(value: unknown, key: IDBValidKey) {
    return this.transaction.request(() => {
      this.records.set(key, structuredClone(value))
      return key
    })
  }

  delete(key: IDBValidKey) {
    return this.transaction.request(() => this.records.delete(key))
  }
}

class FakeRequest extends EventTarget {
  result: unknown
  error: DOMException | null = null
}

class FakeOpenRequest extends EventTarget {
  readonly error = null

  constructor(readonly result: FakeDatabase) {
    super()
  }
}

class FakeStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

class ThrowingStorage implements Storage {
  get length(): number {
    throw new DOMException('Local storage unavailable.', 'SecurityError')
  }

  clear(): void {
    throw new DOMException('Local storage unavailable.', 'SecurityError')
  }

  getItem(): string | null {
    throw new DOMException('Local storage unavailable.', 'SecurityError')
  }

  key(): string | null {
    throw new DOMException('Local storage unavailable.', 'SecurityError')
  }

  removeItem(): void {
    throw new DOMException('Local storage unavailable.', 'SecurityError')
  }

  setItem(): void {
    throw new DOMException('Local storage unavailable.', 'SecurityError')
  }
}
