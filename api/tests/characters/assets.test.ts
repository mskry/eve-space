import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const query = {
    from: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  }
  query.from.mockImplementation(() => query)
  query.leftJoin.mockImplementation(() => query)
  query.where.mockImplementation(() => query)
  return {
    createAssetsClient: vi.fn(),
    createEsiTransport: vi.fn(),
    get: vi.fn(),
    limit: query.limit,
    listCharacterAssets: vi.fn(),
    listCorporationAssets: vi.fn(),
    lookupCharacterLocations: vi.fn(),
    lookupCharacterNames: vi.fn(),
    lookupCorporationLocations: vi.fn(),
    lookupCorporationNames: vi.fn(),
    query,
    resolveUniverseNamesBestEffort: vi.fn(),
  }
})

vi.mock('@evespace/esi-client/domains/assets', () => ({
  createAssetsClient: mocks.createAssetsClient,
}))
vi.mock('../../src/db/client.js', () => ({
  db: { select: vi.fn(() => mocks.query) },
}))
vi.mock('../../src/esi-resilience/resilience.js', () => ({
  getEsiResilienceLayer: () => ({ getCharacter: mocks.get }),
}))
vi.mock('../../src/esi-resilience/transport.js', () => ({
  createEsiTransport: mocks.createEsiTransport,
}))
vi.mock('../../src/universe/names.js', () => ({
  resolveUniverseNamesBestEffort: mocks.resolveUniverseNamesBestEffort,
}))

import {
  characterAssetNameBatchSize,
  characterAssetWorkerConcurrency,
  CharacterAssetsPaginationError,
  getCharacterAssets,
  maximumCharacterAssetPages,
  normalizeCharacterAssetNameBatch,
} from '../../src/characters/assets.js'
import { EsiQuotaError } from '../../src/esi-resilience/cooldowns.js'

const characterId = 1404328063
const revalidation = { ifNoneMatch: 'page-etag', ifModifiedSince: 'page-date' }
const authority = { accessToken: 'access-token', principal: `character-${characterId}` }
const defaultFreshness = {
  cachedUntil: '2026-09-03T12:00:00.000Z',
  validatedAt: '2026-09-03T11:00:00.000Z',
  quota: {},
  source: 'esi' as const,
  stale: false,
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) if (typeof mock === 'function') mock.mockReset()
  for (const method of Object.values(mocks.query)) method.mockClear()
  mocks.query.from.mockImplementation(() => mocks.query)
  mocks.query.leftJoin.mockImplementation(() => mocks.query)
  mocks.query.where.mockImplementation(() => mocks.query)
  mocks.query.limit.mockResolvedValue([])
  mocks.get.mockImplementation(loadResource)
  mocks.createAssetsClient.mockReturnValue({
    withMetadata: () => ({
      listCharacterAssets: mocks.listCharacterAssets,
      listCorporationAssets: mocks.listCorporationAssets,
      lookupCharacterLocations: mocks.lookupCharacterLocations,
      lookupCharacterNames: mocks.lookupCharacterNames,
      lookupCorporationLocations: mocks.lookupCorporationLocations,
      lookupCorporationNames: mocks.lookupCorporationNames,
    }),
  })
  mocks.listCharacterAssets.mockResolvedValue(pageResponse([asset()], 1))
  mocks.lookupCharacterNames.mockImplementation((_characterId, options) =>
    Promise.resolve(
      response(
        options.body.map((itemId: number) => ({ item_id: itemId, name: `Asset ${itemId}` })),
      ),
    ),
  )
  mocks.resolveUniverseNamesBestEffort.mockResolvedValue({ names: new Map(), complete: true })
})

describe('complete character asset collection', () => {
  test('maps one validated page to an intentional source-only snapshot and enriched DTO', async () => {
    mocks.listCharacterAssets.mockResolvedValue(
      pageResponse(
        [
          asset({
            item_id: 22,
            type_id: 34,
            quantity: 5,
            is_singleton: true,
            location_id: 60_000_001,
            location_type: 'station',
            location_flag: 'Hangar',
            ignored: 'raw field',
          }),
          asset({
            item_id: 23,
            type_id: 35,
            quantity: 1,
            is_singleton: false,
            is_blueprint_copy: false,
            location_id: 22,
            location_type: 'item',
            location_flag: 'Cargo',
          }),
        ],
        1,
      ),
    )
    mocks.query.limit.mockResolvedValue([
      {
        typeId: 34,
        typeName: 'Tritanium',
        groupId: 18,
        groupName: 'Mineral',
        categoryId: 4,
        categoryName: 'Material',
        unitVolume: 0.01,
      },
      {
        typeId: 35,
        typeName: 'Pyerite',
        groupId: 18,
        groupName: 'Mineral',
        categoryId: 4,
        categoryName: 'Material',
        unitVolume: null,
      },
    ])
    mocks.resolveUniverseNamesBestEffort.mockResolvedValue({
      names: new Map([
        [60_000_001, { id: 60_000_001, name: 'Jita IV - Moon 4', category: 'station' }],
      ]),
      complete: true,
    })

    const result = await getCharacterAssets(characterId)

    expect(result).toEqual({
      characterId,
      assets: [
        {
          itemId: 22,
          typeId: 34,
          typeName: 'Tritanium',
          groupId: 18,
          groupName: 'Mineral',
          categoryId: 4,
          categoryName: 'Material',
          unitVolume: 0.01,
          totalVolume: 0.05,
          quantity: 5,
          isSingleton: true,
          isBlueprintCopy: null,
          customName: 'Asset 22',
          locationId: 60_000_001,
          locationType: 'station',
          locationName: 'Jita IV - Moon 4',
          locationFlag: 'Hangar',
          parentItemId: null,
        },
        {
          itemId: 23,
          typeId: 35,
          typeName: 'Pyerite',
          groupId: 18,
          groupName: 'Mineral',
          categoryId: 4,
          categoryName: 'Material',
          unitVolume: null,
          totalVolume: null,
          quantity: 1,
          isSingleton: false,
          isBlueprintCopy: false,
          customName: null,
          locationId: 22,
          locationType: 'item',
          locationName: null,
          locationFlag: 'Cargo',
          parentItemId: 22,
        },
      ],
      enrichment: { types: 'complete', names: 'complete', locations: 'complete' },
      cachedUntil: defaultFreshness.cachedUntil,
      validatedAt: defaultFreshness.validatedAt,
      stale: false,
    })
    expect(mocks.get.mock.calls.map(([resource]) => resource.operation)).toEqual([
      'character-assets-page',
      'character-asset-names',
    ])
    expect(mocks.get.mock.calls[0]?.[0]).toMatchObject({
      inputs: { characterId, page: 1 },
    })
    expect(mocks.get.mock.calls[1]?.[0]).toMatchObject({
      inputs: { characterId, itemIds: [22] },
    })
    expect(mocks.listCharacterAssets).toHaveBeenCalledWith(characterId, {
      page: 1,
      ...revalidation,
    })
    expect(mocks.lookupCharacterNames).toHaveBeenCalledWith(characterId, {
      body: [22],
      ...revalidation,
    })
    expect(JSON.stringify(result)).not.toMatch(
      /item_id|type_id|location_id|location_type|is_blueprint_copy|ignored|source|quota|meta/,
    )
  })

  test('merges out-of-order pages in page order and keeps the first duplicate item', async () => {
    const completionOrder: number[] = []
    mocks.listCharacterAssets.mockImplementation(async (_characterId, options) => {
      const page = options.page
      if (page === 2) await wait(10)
      completionOrder.push(page)
      return pageResponse(
        page === 1
          ? [asset({ item_id: 1, type_id: 10 }), asset({ item_id: 2, type_id: 20 })]
          : page === 2
            ? [asset({ item_id: 1, type_id: 99 }), asset({ item_id: 3, type_id: 30 })]
            : [asset({ item_id: 4, type_id: 40 })],
        3,
      )
    })

    const result = await getCharacterAssets(characterId)

    expect(completionOrder).toEqual([1, 3, 2])
    expect(result.assets.map(({ itemId, typeId }) => ({ itemId, typeId }))).toEqual([
      { itemId: 1, typeId: 10 },
      { itemId: 2, typeId: 20 },
      { itemId: 3, typeId: 30 },
      { itemId: 4, typeId: 40 },
    ])
  })

  test('bounds page fan-out independently of completion order', async () => {
    let active = 0
    let maximumActive = 0
    mocks.listCharacterAssets.mockImplementation(async (_characterId, options) => {
      if (options.page > 1) {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await wait(2)
        active -= 1
      }
      return pageResponse([asset({ item_id: options.page })], 10)
    })

    const result = await getCharacterAssets(characterId)

    expect(result.assets).toHaveLength(10)
    expect(maximumActive).toBe(characterAssetWorkerConcurrency)
  })

  test('collects an inventory advertising more than a hundred pages', async () => {
    const advertisedPages = 150
    mocks.listCharacterAssets.mockImplementation(async (_characterId, options) =>
      pageResponse([asset({ item_id: options.page })], advertisedPages),
    )

    const result = await getCharacterAssets(characterId)

    expect(result.assets).toHaveLength(advertisedPages)
    expect(mocks.listCharacterAssets).toHaveBeenCalledTimes(advertisedPages)
  })

  test.each([undefined, 0, -1, 1.5, maximumCharacterAssetPages + 1, Number.MAX_VALUE])(
    'rejects invalid advertised page count %s before scheduling fan-out',
    async (pages) => {
      mocks.listCharacterAssets.mockResolvedValue(response([asset()], pages))

      await expect(getCharacterAssets(characterId)).rejects.toBeInstanceOf(
        CharacterAssetsPaginationError,
      )
      expect(mocks.listCharacterAssets).toHaveBeenCalledOnce()
    },
  )

  test('rejects inconsistent pagination and any unavailable required page', async () => {
    mocks.listCharacterAssets.mockImplementation(async (_characterId, options) => {
      if (options.page === 3) throw new Error('page unavailable')
      return pageResponse([asset({ item_id: options.page })], options.page === 2 ? 4 : 3)
    })

    await expect(getCharacterAssets(characterId)).rejects.toThrow('page unavailable')
    expect(mocks.query.limit).not.toHaveBeenCalled()

    mocks.listCharacterAssets.mockImplementation(async (_characterId, options) =>
      pageResponse([asset({ item_id: options.page })], options.page === 2 ? 3 : 2),
    )
    await expect(getCharacterAssets(characterId)).rejects.toBeInstanceOf(
      CharacterAssetsPaginationError,
    )
  })

  test('uses each new page-1 boundary when the collection shrinks and expands', async () => {
    const advertised = [3, 1, 4]
    let run = -1
    const callsByRun: number[][] = [[], [], []]
    mocks.listCharacterAssets.mockImplementation(async (_characterId, options) => {
      if (options.page === 1) run += 1
      callsByRun[run]!.push(options.page)
      return pageResponse([asset({ item_id: run * 100 + options.page })], advertised[run]!)
    })

    await getCharacterAssets(characterId)
    await getCharacterAssets(characterId)
    await getCharacterAssets(characterId)

    expect(callsByRun.map((pages) => pages.toSorted((left, right) => left - right))).toEqual([
      [1, 2, 3],
      [1],
      [1, 2, 3, 4],
    ])
  })

  test('passes page-specific validators and conservatively composes not-modified metadata', async () => {
    mocks.listCharacterAssets.mockImplementation(async (_characterId, options) =>
      pageResponse([asset({ item_id: options.page })], 2),
    )
    mocks.get.mockImplementation(async (resource) => {
      const page = resource.inputs.page
      const validators = {
        ifNoneMatch: `etag-${page}`,
        ifModifiedSince: `modified-${page}`,
      }
      const loaded = await resource.load(authority, validators)
      return cached(loaded.data, {
        cachedUntil: page === 1 ? '2026-09-03T12:00:00.000Z' : '2026-09-03T11:30:00.000Z',
        validatedAt: page === 1 ? '2026-09-03T11:00:00.000Z' : '2026-09-03T10:00:00.000Z',
        source: 'not-modified',
      })
    })

    const result = await getCharacterAssets(characterId)

    expect(mocks.listCharacterAssets).toHaveBeenNthCalledWith(1, characterId, {
      page: 1,
      ifNoneMatch: 'etag-1',
      ifModifiedSince: 'modified-1',
    })
    expect(mocks.listCharacterAssets).toHaveBeenNthCalledWith(2, characterId, {
      page: 2,
      ifNoneMatch: 'etag-2',
      ifModifiedSince: 'modified-2',
    })
    expect(result).toMatchObject({
      cachedUntil: '2026-09-03T11:30:00.000Z',
      validatedAt: '2026-09-03T10:00:00.000Z',
      stale: false,
    })
  })

  test('composes a complete stale fallback only after every required page resolves', async () => {
    mocks.listCharacterAssets.mockImplementation(async (_characterId, options) =>
      pageResponse([asset({ item_id: options.page })], 2),
    )
    mocks.get.mockImplementation(async (resource) => {
      const loaded = await resource.load(authority, revalidation)
      return cached(loaded.data, {
        cachedUntil: '2026-09-03T10:00:00.000Z',
        validatedAt:
          resource.inputs.page === 1 ? '2026-09-03T09:30:00.000Z' : '2026-09-03T09:00:00.000Z',
        stale: true,
        refreshFailureClass: 'esi-unavailable',
      })
    })

    await expect(getCharacterAssets(characterId)).resolves.toMatchObject({
      stale: true,
      validatedAt: '2026-09-03T09:00:00.000Z',
      refreshFailureClass: 'esi-unavailable',
      assets: [{ itemId: 1 }, { itemId: 2 }],
    })
  })

  test('only returns retry timing for the selected cooldown failure class', async () => {
    mocks.listCharacterAssets.mockImplementation(async (_characterId, options) =>
      pageResponse([asset({ item_id: options.page })], 2),
    )
    mocks.get.mockImplementation(async (resource) => {
      const loaded = await resource.load(authority, revalidation)
      return cached(loaded.data, {
        validatedAt:
          resource.inputs.page === 1 ? '2026-09-03T09:00:00.000Z' : '2026-09-03T09:30:00.000Z',
        stale: true,
        refreshFailureClass: resource.inputs.page === 1 ? 'esi-unavailable' : 'esi-cooldown',
        retryAt: '2026-09-03T10:00:00.000Z',
      })
    })

    const result = await getCharacterAssets(characterId)

    expect(result).toMatchObject({ refreshFailureClass: 'esi-unavailable' })
    expect(result).not.toHaveProperty('retryAt')
  })

  test('uses cache-identical page inputs so concurrent collection loads can collapse', async () => {
    const pending = new Map<string, Promise<unknown>>()
    mocks.listCharacterAssets.mockImplementation(async () => {
      await wait(5)
      return pageResponse([asset()], 1)
    })
    mocks.get.mockImplementation((resource) => {
      const key = `${resource.operation}:${JSON.stringify(resource.inputs)}`
      let current = pending.get(key)
      if (!current) {
        current = loadResource(resource)
        pending.set(key, current)
      }
      return current
    })

    await Promise.all([getCharacterAssets(characterId), getCharacterAssets(characterId)])

    expect(mocks.listCharacterAssets).toHaveBeenCalledOnce()
  })

  test('preserves cooldown errors from required pages', async () => {
    mocks.listCharacterAssets.mockImplementation(async (_characterId, options) =>
      pageResponse([asset({ item_id: options.page })], 2),
    )
    mocks.get.mockImplementation((resource) => {
      if (resource.inputs.page === 2) throw new EsiQuotaError(19)
      return loadResource(resource)
    })

    await expect(getCharacterAssets(characterId)).rejects.toMatchObject({
      retryAfterSeconds: 19,
    })
  })
})

describe('bounded character asset enrichment', () => {
  test('sorts singleton candidates into stable 1,000-ID batches with bounded workers', async () => {
    const candidateCount = characterAssetNameBatchSize * characterAssetWorkerConcurrency + 2
    mocks.listCharacterAssets.mockResolvedValue(
      pageResponse(
        Array.from({ length: candidateCount }, (_, index) =>
          asset({ item_id: candidateCount - index, is_singleton: true }),
        ),
        1,
      ),
    )
    const bodies: number[][] = []
    let active = 0
    let maximumActive = 0
    mocks.lookupCharacterNames.mockImplementation(async (_characterId, options) => {
      bodies.push([...options.body])
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await wait(2)
      active -= 1
      return response(
        options.body.map((itemId: number) => ({ item_id: itemId, name: `${itemId}` })),
      )
    })

    const result = await getCharacterAssets(characterId)

    expect(bodies).toHaveLength(characterAssetWorkerConcurrency + 1)
    expect(bodies.flat()).toEqual(Array.from({ length: candidateCount }, (_, index) => index + 1))
    expect(bodies.every((body) => body.length <= characterAssetNameBatchSize)).toBe(true)
    expect(maximumActive).toBe(characterAssetWorkerConcurrency)
    expect(result.enrichment.names).toBe('complete')
  })

  test('retains successful names and base assets when another batch is rejected without splitting', async () => {
    const candidateCount = characterAssetNameBatchSize + 1
    mocks.listCharacterAssets.mockResolvedValue(
      pageResponse(
        Array.from({ length: candidateCount }, (_, index) =>
          asset({ item_id: index + 1, is_singleton: true }),
        ),
        1,
      ),
    )
    mocks.lookupCharacterNames.mockImplementation(async (_characterId, options) => {
      if (options.body[0] === characterAssetNameBatchSize + 1)
        throw Object.assign(new Error('batch rejected'), { status: 400 })
      return response([{ item_id: 1, name: 'Retained name' }])
    })

    const result = await getCharacterAssets(characterId)

    expect(mocks.lookupCharacterNames).toHaveBeenCalledTimes(2)
    expect(result.assets).toHaveLength(candidateCount)
    expect(result.assets[0]?.customName).toBe('Retained name')
    expect(result.assets[1]?.customName).toBeNull()
    expect(result.enrichment.names).toBe('partial')
  })

  test('rejects non-normalized name batches before identity or SDK projection', () => {
    expect(normalizeCharacterAssetNameBatch([30, 10, 20])).toEqual([10, 20, 30])
    expect(() => normalizeCharacterAssetNameBatch([])).toThrow('between 1 and 1000')
    expect(() =>
      normalizeCharacterAssetNameBatch(
        Array.from({ length: characterAssetNameBatchSize + 1 }, (_, index) => index + 1),
      ),
    ).toThrow('between 1 and 1000')
    expect(() => normalizeCharacterAssetNameBatch([1, 1])).toThrow('must be unique')
    expect(() => normalizeCharacterAssetNameBatch([0])).toThrow('positive safe integers')
    expect(() => normalizeCharacterAssetNameBatch([Number.MAX_SAFE_INTEGER + 1])).toThrow(
      'positive safe integers',
    )
  })

  test('left-preserves SDE misses, joins type context, and rejects unsafe derived totals', async () => {
    mocks.listCharacterAssets.mockResolvedValue(
      pageResponse(
        [
          asset({ item_id: 1, type_id: 10, quantity: 5 }),
          asset({ item_id: 2, type_id: 20, quantity: Number.MAX_VALUE }),
          asset({ item_id: 3, type_id: 30, quantity: 1 }),
        ],
        1,
      ),
    )
    mocks.query.limit.mockResolvedValue([
      {
        typeId: 10,
        typeName: 'Known type',
        groupId: 100,
        groupName: 'Known group',
        categoryId: 200,
        categoryName: 'Known category',
        unitVolume: 2,
      },
      {
        typeId: 20,
        typeName: 'Huge type',
        groupId: 100,
        groupName: 'Known group',
        categoryId: 200,
        categoryName: 'Known category',
        unitVolume: 2,
      },
    ])

    const result = await getCharacterAssets(characterId)

    expect(mocks.query.limit).toHaveBeenCalledWith(3)
    expect(result.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemId: 1, typeName: 'Known type', totalVolume: 10 }),
        expect.objectContaining({ itemId: 2, typeName: 'Huge type', totalVolume: null }),
        expect.objectContaining({
          itemId: 3,
          typeName: 'Unknown type 30',
          groupId: null,
          categoryId: null,
          unitVolume: null,
          totalVolume: null,
        }),
      ]),
    )
    expect(result.enrichment.types).toBe('partial')
  })

  test('degrades all type context deterministically when the single SDE projection fails', async () => {
    mocks.listCharacterAssets.mockResolvedValue(
      pageResponse([asset({ item_id: 1, type_id: 10 }), asset({ item_id: 2, type_id: 20 })], 1),
    )
    mocks.query.limit.mockRejectedValue(new Error('SDE unavailable'))

    const result = await getCharacterAssets(characterId)

    expect(result.assets.map(({ typeName }) => typeName)).toEqual([
      'Unknown type 10',
      'Unknown type 20',
    ])
    expect(result.enrichment.types).toBe('unavailable')
    expect(result.assets).toHaveLength(2)
  })

  test('resolves only repeated explicit public roots and rejects category mismatches', async () => {
    const structureId = 1_035_466_617_946
    mocks.listCharacterAssets.mockResolvedValue(
      pageResponse(
        [
          asset({ item_id: 1, location_id: 60_000_001, location_type: 'station' }),
          asset({ item_id: 2, location_id: 60_000_001, location_type: 'station' }),
          asset({ item_id: 3, location_id: 30_000_142, location_type: 'solar_system' }),
          asset({ item_id: 4, location_id: 1, location_type: 'item' }),
          asset({ item_id: 5, location_id: structureId, location_type: 'other' }),
        ],
        1,
      ),
    )
    mocks.resolveUniverseNamesBestEffort.mockResolvedValue({
      names: new Map([
        [60_000_001, { id: 60_000_001, name: 'Wrong system', category: 'solar_system' }],
        [30_000_142, { id: 30_000_142, name: 'Jita', category: 'solar_system' }],
      ]),
      complete: true,
    })

    const result = await getCharacterAssets(characterId)

    expect(mocks.resolveUniverseNamesBestEffort).toHaveBeenCalledWith([30_000_142, 60_000_001])
    expect(result.assets.map(({ itemId, locationName }) => ({ itemId, locationName }))).toEqual([
      { itemId: 1, locationName: null },
      { itemId: 2, locationName: null },
      { itemId: 3, locationName: 'Jita' },
      { itemId: 4, locationName: null },
      { itemId: 5, locationName: null },
    ])
    expect(result.enrichment.locations).toBe('partial')
  })

  test('retains valid public locations when another resolution batch fails', async () => {
    mocks.listCharacterAssets.mockResolvedValue(
      pageResponse(
        [
          asset({ item_id: 1, location_id: 60_000_001, location_type: 'station' }),
          asset({ item_id: 2, location_id: 30_000_142, location_type: 'solar_system' }),
        ],
        1,
      ),
    )
    mocks.resolveUniverseNamesBestEffort.mockResolvedValue({
      names: new Map([
        [60_000_001, { id: 60_000_001, name: 'Jita IV - Moon 4', category: 'station' }],
      ]),
      complete: false,
    })

    const result = await getCharacterAssets(characterId)

    expect(result.assets[0]?.locationName).toBe('Jita IV - Moon 4')
    expect(result.assets[1]?.locationName).toBeNull()
    expect(result.enrichment.locations).toBe('partial')
  })

  test('keeps enrichment status independent from current base freshness', async () => {
    mocks.listCharacterAssets.mockResolvedValue(
      pageResponse([asset({ item_id: 1, is_singleton: true, location_type: 'station' })], 1),
    )
    mocks.lookupCharacterNames.mockRejectedValue(new Error('names unavailable'))
    mocks.query.limit.mockRejectedValue(new Error('SDE unavailable'))
    mocks.resolveUniverseNamesBestEffort.mockRejectedValue(new Error('locations unavailable'))

    await expect(getCharacterAssets(characterId)).resolves.toMatchObject({
      stale: false,
      enrichment: { types: 'unavailable', names: 'unavailable', locations: 'unavailable' },
      assets: [
        {
          itemId: 1,
          typeName: 'Unknown type 34',
          customName: null,
          locationName: null,
        },
      ],
    })
  })
})

test('does not expose or call prohibited asset and structure operations', async () => {
  await getCharacterAssets(characterId)

  expect(mocks.lookupCharacterLocations).not.toHaveBeenCalled()
  expect(mocks.listCorporationAssets).not.toHaveBeenCalled()
  expect(mocks.lookupCorporationLocations).not.toHaveBeenCalled()
  expect(mocks.lookupCorporationNames).not.toHaveBeenCalled()
  const source = readFileSync(new URL('../../src/characters/assets.ts', import.meta.url), 'utf8')
  expect(source).not.toMatch(
    /lookupCharacterLocations|createStructuresClient|listCorporationAssets|lookupCorporation|createUniverseClient|\/corporations\/|\/alliances\//,
  )
})

async function loadResource(resource: {
  load: (
    authority: { accessToken: string; principal: string },
    revalidation: { ifNoneMatch: string; ifModifiedSince: string },
  ) => Promise<{ data: unknown }>
}) {
  const loaded = await resource.load(authority, revalidation)
  return cached(loaded.data)
}

function cached<Data>(data: Data, overrides: Record<string, unknown> = {}) {
  return { data, ...defaultFreshness, ...overrides }
}

function asset(overrides: Record<string, unknown> = {}) {
  return {
    item_id: 1,
    type_id: 34,
    quantity: 1,
    is_singleton: false,
    location_id: 1_035_466_617_946,
    location_type: 'other',
    location_flag: 'Hangar',
    ...overrides,
  }
}

function pageResponse(data: unknown[], pages: number) {
  return response(data, pages)
}

function response(data: unknown, pages?: unknown) {
  return {
    data,
    meta: {
      status: 200,
      headers: {},
      ...(pages === undefined ? {} : { pagination: { pages } }),
    },
  }
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}
