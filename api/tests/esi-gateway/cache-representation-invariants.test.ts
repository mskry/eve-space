import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { getCharacterAssets } from '../../src/characters/assets.js'
import { getCharacterContracts } from '../../src/characters/contracts.js'
import { getCharacterMarketOrderHistory } from '../../src/characters/market.js'
import { getWalletJournal, getWalletTransactions } from '../../src/characters/wallet.js'
import { resolveUniverseIds, resolveUniverseNames } from '../../src/universe/names.js'
import { createRuntimeTestExecution, createRuntimeTestPorts } from './runtime-test-adapters.js'

const mocks = vi.hoisted(() => ({
  getProductionRuntime: vi.fn(),
  writeUniverseIds: vi.fn(),
  writeUniverseNames: vi.fn(),
}))

vi.mock('../../src/esi-gateway/internal/production-runtime.js', () => ({
  getProductionEsiExecutionRuntime: mocks.getProductionRuntime,
}))
vi.mock('../../src/universe/resolution-cache.js', () => ({
  readUniverseIds: async () => ({ fresh: new Map(), stale: new Map(), suppressed: new Set() }),
  readUniverseNames: async () => ({ fresh: new Map(), stale: new Map(), suppressed: new Set() }),
  suppressUniverseIdNames: vi.fn(),
  suppressUniverseNameIds: vi.fn(),
  writeUniverseIds: mocks.writeUniverseIds,
  writeUniverseNames: mocks.writeUniverseNames,
}))
vi.mock('../../src/universe/static-locations.js', () => ({ getStaticLocations: vi.fn() }))
vi.mock('../../src/db/client.js', () => ({ db: { select: vi.fn() } }))

const characterId = 7
const subjectLifecycleId = '11111111-1111-4111-8111-111111111111'
const committedFence = 4
const characterAuthorization = {
  generation: 1,
  kind: 'character' as const,
  principal: `character-${characterId}-lifecycle-${subjectLifecycleId}`,
}
let activeRuntime: ReturnType<typeof createRuntimeTestExecution> | undefined

beforeEach(() => vi.clearAllMocks())
afterEach(async () => {
  await activeRuntime?.close()
  activeRuntime = undefined
})

const cachedRuntime = (options: {
  data: unknown
  representationVersion: string
  response: unknown
  authorization?: { kind: 'character'; principal: string; generation: number }
  headers?: HeadersInit
}) => {
  const freshUntil = Date.now() + 60_000
  let serialized = JSON.stringify({
    authorization: options.authorization,
    data: options.data,
    fence: committedFence,
    freshUntil,
    representationVersion: options.representationVersion,
    retainUntil: freshUntil,
    staleUntil: freshUntil,
    validatedAt: new Date().toISOString(),
    version: 3,
  })
  const fetch = vi.fn()
  const cacheGet = vi.fn(async () => serialized)
  const cacheSet = vi.fn(async (_key: string, value: string) => {
    serialized = value
  })
  activeRuntime = createRuntimeTestExecution(
    createRuntimeTestPorts({
      fetch,
      headers: options.headers,
      overrides: {
        cache: { get: cacheGet, set: cacheSet },
        coordination: {
          acquireRequestLease: async () => ({
            fence: committedFence,
            key: 'cache-admission-lease',
            ownerToken: 'owner',
            ttlMs: 30_000,
          }),
          commitFence: async () => true,
          getCommittedFence: async () => committedFence,
          initializeCacheNamespace: async () => 'runtime-test',
        },
      },
      response: options.response,
    }),
  )
  mocks.getProductionRuntime.mockResolvedValue(activeRuntime)
  return { cacheGet, cacheSet, fetch }
}

describe('cached representation domain invariants', () => {
  test.each([
    { page: 1, totalPages: 1001 },
    { page: 1, totalPages: 0 },
    { page: 1, totalPages: 1.5 },
    { page: 0, totalPages: 1 },
    { page: 2, totalPages: 1 },
  ])('misses an invalid private asset page ($page/$totalPages) before fan-out', async (data) => {
    const { cacheSet, fetch } = cachedRuntime({
      authorization: characterAuthorization,
      data: { assets: [], ...data },
      headers: { 'X-Pages': '1' },
      representationVersion: 'character-assets-page-core@v2',
      response: [],
    })

    await expect(getCharacterAssets(characterId, subjectLifecycleId)).resolves.toMatchObject({
      assets: [],
      characterId,
    })
    await getCharacterAssets(characterId, subjectLifecycleId)

    expect(fetch).toHaveBeenCalledOnce()
    expect(cacheSet).toHaveBeenCalledOnce()
  })

  test('serves a valid private asset page from L2', async () => {
    const { fetch } = cachedRuntime({
      authorization: characterAuthorization,
      data: { assets: [], page: 1, totalPages: 1 },
      headers: { 'X-Pages': '1' },
      representationVersion: 'character-assets-page-core@v2',
      response: [],
    })

    await expect(getCharacterAssets(characterId, subjectLifecycleId)).resolves.toMatchObject({
      assets: [],
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  test('misses a request-mismatched asset page before promotion to L1', async () => {
    const { cacheGet, cacheSet, fetch } = cachedRuntime({
      authorization: characterAuthorization,
      data: { assets: [], page: 2, totalPages: 2 },
      headers: { 'X-Pages': '1' },
      representationVersion: 'character-assets-page-core@v2',
      response: [],
    })

    await expect(getCharacterAssets(characterId, subjectLifecycleId)).resolves.toMatchObject({
      assets: [],
      characterId,
    })
    await getCharacterAssets(characterId, subjectLifecycleId)

    expect(cacheGet).toHaveBeenCalledOnce()
    expect(cacheSet).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledOnce()
  })

  test.each([
    {
      name: 'wallet journal',
      data: { entries: [], page: -1, totalPages: 0.5 },
      representationVersion: 'wallet-journal-core@v2',
      execute: () => getWalletJournal(characterId, 1, subjectLifecycleId),
    },
    {
      name: 'wallet journal request identity',
      data: { entries: [], page: 2, totalPages: 2 },
      representationVersion: 'wallet-journal-core@v2',
      execute: () => getWalletJournal(characterId, 1, subjectLifecycleId),
    },
    {
      name: 'market order history',
      data: { orders: [], page: 2, totalPages: 2 },
      representationVersion: 'market-order-history-core@v1',
      execute: () => getCharacterMarketOrderHistory(characterId, 1, subjectLifecycleId),
    },
    {
      name: 'contract list',
      data: { contracts: [], page: 2, totalPages: 2 },
      representationVersion: 'character-contracts-core@v1',
      execute: () => getCharacterContracts(characterId, 1, subjectLifecycleId),
    },
  ])('misses invalid cached $name pagination before L1 promotion', async (fixture) => {
    const { cacheGet, cacheSet, fetch } = cachedRuntime({
      authorization: characterAuthorization,
      data: fixture.data,
      headers: { 'X-Pages': '1' },
      representationVersion: fixture.representationVersion,
      response: [],
    })

    await expect(fixture.execute()).resolves.toMatchObject({ page: 1, totalPages: 1 })
    await fixture.execute()

    expect(cacheGet).toHaveBeenCalledOnce()
    expect(cacheSet).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledOnce()
  })

  test.each([
    { fromId: null, nextFromId: -1, requestFromId: null },
    { fromId: 2, nextFromId: null, requestFromId: null },
    { fromId: 2, nextFromId: 1.5, requestFromId: 2 },
  ])('misses invalid cached wallet continuation ($fromId/$nextFromId)', async (fixture) => {
    const { cacheGet, cacheSet, fetch } = cachedRuntime({
      authorization: characterAuthorization,
      data: { fromId: fixture.fromId, nextFromId: fixture.nextFromId, transactions: [] },
      representationVersion: 'wallet-transactions-core@v3',
      response: [],
    })

    await expect(
      getWalletTransactions(characterId, fixture.requestFromId, subjectLifecycleId),
    ).resolves.toMatchObject({ fromId: fixture.requestFromId, nextFromId: null })
    await getWalletTransactions(characterId, fixture.requestFromId, subjectLifecycleId)

    expect(cacheGet).toHaveBeenCalledOnce()
    expect(cacheSet).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledOnce()
  })

  test('serves a valid cached Finance page and continuation', async () => {
    const { fetch } = cachedRuntime({
      authorization: characterAuthorization,
      data: { fromId: null, nextFromId: null, transactions: [] },
      representationVersion: 'wallet-transactions-core@v3',
      response: [],
    })

    await expect(
      getWalletTransactions(characterId, null, subjectLifecycleId),
    ).resolves.toMatchObject({
      fromId: null,
      nextFromId: null,
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  test('does not copy an invalid cached name category into the positive cache', async () => {
    const { cacheSet, fetch } = cachedRuntime({
      data: [{ category: 'invalid', id: 7, name: 'Poisoned' }],
      representationVersion: 'universe-names-core@v1',
      response: [{ category: 'character', id: 7, name: 'Pilot' }],
    })

    await expect(resolveUniverseNames([7])).resolves.toStrictEqual(
      new Map([[7, { category: 'character', id: 7, name: 'Pilot' }]]),
    )
    await resolveUniverseNames([7])

    expect(fetch).toHaveBeenCalledOnce()
    expect(cacheSet).toHaveBeenCalledOnce()
    expect(mocks.writeUniverseNames).toHaveBeenCalledWith([
      { category: 'character', id: 7, name: 'Pilot' },
    ])
    expect(mocks.writeUniverseNames).not.toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ category: 'invalid' })]),
    )
  })

  test('rejects a cached non-integer ID before retaining a fresh ID resolution', async () => {
    const { cacheSet, fetch } = cachedRuntime({
      data: [{ category: 'character', id: 7.5, name: 'Pilot' }],
      representationVersion: 'universe-ids-core@v1',
      response: { characters: [{ id: 7, name: 'Pilot' }] },
    })

    await expect(resolveUniverseIds(['Pilot'])).resolves.toStrictEqual([
      { category: 'character', id: 7, name: 'Pilot' },
    ])
    await resolveUniverseIds(['Pilot'])

    expect(fetch).toHaveBeenCalledOnce()
    expect(cacheSet).toHaveBeenCalledOnce()
    expect(mocks.writeUniverseIds).toHaveBeenCalledWith(
      new Map([['Pilot', [{ category: 'character', id: 7, name: 'Pilot' }]]]),
    )
  })

  test('serves a valid cached resolution without an upstream call', async () => {
    const { fetch } = cachedRuntime({
      data: [{ category: 'character', id: 7, name: 'Pilot' }],
      representationVersion: 'universe-names-core@v1',
      response: [],
    })

    await expect(resolveUniverseNames([7])).resolves.toStrictEqual(
      new Map([[7, { category: 'character', id: 7, name: 'Pilot' }]]),
    )
    expect(fetch).not.toHaveBeenCalled()
  })
})
