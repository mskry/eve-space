import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPublic: vi.fn(),
  readUniverseIds: vi.fn(),
  readUniverseNames: vi.fn(),
  resolveIds: vi.fn(),
  resolveNames: vi.fn(),
  suppressUniverseIdNames: vi.fn(),
  suppressUniverseNameIds: vi.fn(),
  writeUniverseIds: vi.fn(),
  writeUniverseNames: vi.fn(),
}))

vi.mock('@evespace/esi-client/domains/universe', () => ({
  createUniverseClient: () => ({
    withMetadata: () => ({ resolveIds: mocks.resolveIds, resolveNames: mocks.resolveNames }),
  }),
}))
vi.mock('../../src/esi-resilience/resilience.js', () => ({
  getEsiResilienceLayer: () => ({ getPublic: mocks.getPublic }),
}))
vi.mock('../../src/esi-resilience/transport.js', () => ({ createEsiTransport: vi.fn() }))
vi.mock('../../src/universe/resolution-cache.js', () => ({
  readUniverseIds: mocks.readUniverseIds,
  readUniverseNames: mocks.readUniverseNames,
  suppressUniverseIdNames: mocks.suppressUniverseIdNames,
  suppressUniverseNameIds: mocks.suppressUniverseNameIds,
  writeUniverseIds: mocks.writeUniverseIds,
  writeUniverseNames: mocks.writeUniverseNames,
}))

const emptyCache = () => ({ fresh: new Map(), stale: new Map(), suppressed: new Set() })

beforeEach(() => {
  mocks.readUniverseIds.mockImplementation(emptyCache)
  mocks.readUniverseNames.mockImplementation(emptyCache)
  mocks.getPublic.mockImplementation(async (resource) => {
    const loaded = await resource.load({ ifNoneMatch: '"names"' })
    return { data: loaded.data, cachedUntil: '', quota: {}, source: 'esi', stale: false }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('universe name resolver', () => {
  test('deduplicates canonical set inputs and passes conditional validators', async () => {
    mocks.resolveNames.mockResolvedValue(
      response([
        { category: 'corporation', id: 2, name: 'Second' },
        { category: 'corporation', id: 1, name: 'First' },
      ]),
    )
    const { resolveUniverseNames } = await import('../../src/universe/names.js')

    const names = await resolveUniverseNames([2, 1, 2])

    expect([...names.keys()]).toEqual([2, 1])
    expect(mocks.getPublic.mock.calls[0]?.[0]).toMatchObject({
      operation: 'universe-resolve-names',
      inputs: { ids: [2, 1] },
    })
    expect(mocks.resolveNames).toHaveBeenCalledWith({
      body: [2, 1],
      ifNoneMatch: '"names"',
    })
  })

  test('splits only unavailable identifier batches', async () => {
    mocks.resolveNames.mockImplementation(async ({ body }: { body: number[] }) => {
      if (body.length > 1) throw Object.assign(new Error('Unavailable identifier'), { status: 404 })
      return response([{ category: 'corporation', id: body[0], name: `Corporation ${body[0]}` }])
    })
    const { resolveUniverseNames } = await import('../../src/universe/names.js')

    await expect(resolveUniverseNames([1, 2])).resolves.toSatisfy(
      (names: Map<number, unknown>) => names.size === 2,
    )
    expect(mocks.resolveNames).toHaveBeenCalledTimes(3)

    mocks.resolveNames
      .mockReset()
      .mockRejectedValue(Object.assign(new Error('Unavailable'), { status: 503 }))
    await expect(resolveUniverseNames([3, 4])).rejects.toMatchObject({ status: 503 })
    expect(mocks.resolveNames).toHaveBeenCalledOnce()
  })

  test('fails instead of returning partial names when the split budget is exhausted', async () => {
    mocks.resolveNames.mockRejectedValue(
      Object.assign(new Error('Unavailable identifier'), { status: 404 }),
    )
    const { resolveUniverseNames } = await import('../../src/universe/names.js')

    await expect(
      resolveUniverseNames(Array.from({ length: 66 }, (_, index) => index + 1)),
    ).rejects.toMatchObject({ name: 'UniverseNameResolutionLimitError', status: 424 })
  })

  test('reuses fresh entries and stale entries under negative suppression', async () => {
    mocks.readUniverseNames.mockResolvedValue({
      fresh: new Map([[1, { category: 'character', id: 1, name: 'Fresh' }]]),
      stale: new Map([[2, { category: 'character', id: 2, name: 'Stale' }]]),
      suppressed: new Set([2, 3]),
    })
    const { resolveUniverseNames } = await import('../../src/universe/names.js')

    await expect(resolveUniverseNames([1, 2, 3])).resolves.toEqual(
      new Map([
        [2, { category: 'character', id: 2, name: 'Stale' }],
        [1, { category: 'character', id: 1, name: 'Fresh' }],
      ]),
    )
    expect(mocks.getPublic).not.toHaveBeenCalled()
  })

  test('suppresses singleton name resolution failures after preserving successful entries', async () => {
    mocks.resolveNames.mockImplementation(async ({ body }: { body: number[] }) => {
      if (body.includes(2))
        throw Object.assign(new Error('Unavailable identifier'), { status: 404 })
      return response([{ category: 'character', id: 1, name: 'Resolved' }])
    })
    const { resolveUniverseNames } = await import('../../src/universe/names.js')

    await expect(resolveUniverseNames([1, 2])).resolves.toEqual(
      new Map([[1, { category: 'character', id: 1, name: 'Resolved' }]]),
    )
    expect(mocks.writeUniverseNames).toHaveBeenCalledWith([
      { category: 'character', id: 1, name: 'Resolved' },
    ])
    expect(mocks.suppressUniverseNameIds).toHaveBeenCalledWith([2])
  })

  test('records missing IDs before rethrowing a sibling split failure', async () => {
    mocks.resolveNames.mockImplementation(async ({ body }: { body: number[] }) => {
      if (body.length > 1) throw Object.assign(new Error('Unavailable identifier'), { status: 404 })
      if (body[0] === 1) throw Object.assign(new Error('Unavailable identifier'), { status: 404 })
      throw Object.assign(new Error('Unavailable'), { status: 503 })
    })
    const { resolveUniverseNames } = await import('../../src/universe/names.js')

    await expect(resolveUniverseNames([1, 2])).rejects.toMatchObject({ status: 503 })
    expect(mocks.suppressUniverseNameIds).toHaveBeenCalledWith([1])
  })

  test('does not refresh per-item entries from a stale aggregate response', async () => {
    mocks.getPublic.mockResolvedValue({
      data: [{ category: 'character', id: 1, name: 'Stale' }],
      cachedUntil: '',
      quota: {},
      source: 'cache',
      stale: true,
    })
    const { resolveUniverseNames } = await import('../../src/universe/names.js')

    await expect(resolveUniverseNames([1])).resolves.toEqual(
      new Map([[1, { category: 'character', id: 1, name: 'Stale' }]]),
    )
    expect(mocks.writeUniverseNames).not.toHaveBeenCalled()
    expect(mocks.suppressUniverseNameIds).toHaveBeenCalledWith([])
  })
})

describe('universe ID resolver', () => {
  test('deduplicates names, passes validators, and maps every returned category', async () => {
    mocks.resolveIds.mockResolvedValue(
      response({
        agents: [{ id: 1, name: 'Agent' }],
        alliances: [{ id: 2, name: 'Alliance' }],
        characters: [{ id: 3, name: 'Character' }],
        corporations: [{ id: 4, name: 'Corporation' }],
        factions: [{ id: 5, name: 'Faction' }],
        inventory_types: [{ id: 6, name: 'Type' }],
        systems: [{ id: 7, name: 'System' }],
        regions: [{ id: undefined, name: 'Incomplete' }],
      }),
    )
    const { resolveUniverseIds } = await import('../../src/universe/names.js')

    await expect(resolveUniverseIds(['Character', 'Alliance', 'Character'])).resolves.toEqual([
      { id: 1, name: 'Agent', category: 'agent' },
      { id: 2, name: 'Alliance', category: 'alliance' },
      { id: 3, name: 'Character', category: 'character' },
      { id: 4, name: 'Corporation', category: 'corporation' },
      { id: 5, name: 'Faction', category: 'faction' },
      { id: 6, name: 'Type', category: 'inventory_type' },
      { id: 7, name: 'System', category: 'solar_system' },
    ])
    expect(mocks.getPublic.mock.calls.at(-1)?.[0]).toMatchObject({
      operation: 'universe-resolve-ids',
      inputs: { names: ['Character', 'Alliance'] },
    })
    expect(mocks.resolveIds).toHaveBeenCalledWith({
      body: ['Character', 'Alliance'],
      ifNoneMatch: '"names"',
    })
  })

  test('treats an unmatched name as empty and preserves matches from mixed 404 batches', async () => {
    mocks.resolveIds.mockImplementation(async ({ body }: { body: string[] }) => {
      if (body.length > 1) throw Object.assign(new Error('Unknown name'), { status: 404 })
      if (body[0] === 'Unknown') throw Object.assign(new Error('Unknown name'), { status: 404 })
      return response({ characters: [{ id: 9, name: body[0] }] })
    })
    const { resolveUniverseIds } = await import('../../src/universe/names.js')

    await expect(resolveUniverseIds(['Known', 'Unknown'])).resolves.toEqual([
      { id: 9, name: 'Known', category: 'character' },
    ])
    await expect(resolveUniverseIds(['Unknown'])).resolves.toEqual([])
  })

  test('reuses cached ID resolutions without querying ESI', async () => {
    mocks.readUniverseIds.mockResolvedValue({
      fresh: new Map([['Known', [{ category: 'character', id: 9, name: 'Known' }]]]),
      stale: new Map(),
      suppressed: new Set(['Unknown']),
    })
    const { resolveUniverseIds } = await import('../../src/universe/names.js')

    await expect(resolveUniverseIds(['Known', 'Unknown'])).resolves.toEqual([
      { category: 'character', id: 9, name: 'Known' },
    ])
    expect(mocks.getPublic).not.toHaveBeenCalled()
  })

  test('retains but does not refresh a stale ID resolution omitted by a fresh response', async () => {
    const staleEntry = { category: 'character', id: 5, name: 'Alpha' }
    mocks.readUniverseIds.mockResolvedValue({
      fresh: new Map(),
      stale: new Map([['Alpha', [staleEntry]]]),
      suppressed: new Set(),
    })
    mocks.resolveIds.mockResolvedValue(response({}))
    const { resolveUniverseIds } = await import('../../src/universe/names.js')

    await expect(resolveUniverseIds(['Alpha'])).resolves.toEqual([staleEntry])
    expect(mocks.writeUniverseIds).not.toHaveBeenCalled()
    expect(mocks.suppressUniverseIdNames).toHaveBeenCalledWith(['Alpha'])
  })

  test('does not refresh ID entries from a stale aggregate response', async () => {
    mocks.getPublic.mockResolvedValue({
      data: { characters: [{ id: 5, name: 'Alpha' }] },
      cachedUntil: '',
      quota: {},
      source: 'cache',
      stale: true,
    })
    const { resolveUniverseIds } = await import('../../src/universe/names.js')

    await expect(resolveUniverseIds(['Alpha'])).resolves.toEqual([
      { category: 'character', id: 5, name: 'Alpha' },
    ])
    expect(mocks.writeUniverseIds).not.toHaveBeenCalled()
    expect(mocks.suppressUniverseIdNames).toHaveBeenCalledWith([])
  })
})

function response<Data>(data: Data) {
  return { data, meta: { status: 200, headers: {} } }
}
