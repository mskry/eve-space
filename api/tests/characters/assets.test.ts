import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createFeatureExecutionMock } from '../support/mock-feature-execution.js'

const mocks = vi.hoisted(() => {
  const query = { from: vi.fn(), leftJoin: vi.fn(), limit: vi.fn(), where: vi.fn() }
  query.from.mockImplementation(() => query)
  query.leftJoin.mockImplementation(() => query)
  query.where.mockImplementation(() => query)
  return {
    executeRepresentation: vi.fn(),
    getStaticLocations: vi.fn(),
    query,
    resolveUniverseNamesBestEffort: vi.fn(),
  }
})

vi.mock('../../src/db/client.js', () => ({ db: { select: vi.fn(() => mocks.query) } }))
vi.mock('../../src/esi-gateway/feature-execution.js', () =>
  createFeatureExecutionMock(mocks.executeRepresentation),
)
vi.mock('../../src/universe/names.js', () => ({
  resolveUniverseNamesBestEffort: mocks.resolveUniverseNamesBestEffort,
}))
vi.mock('../../src/universe/static-locations.js', () => ({
  getStaticLocations: mocks.getStaticLocations,
}))

import { CharacterAssetsPaginationError, getCharacterAssets } from '../../src/characters/assets.js'
import { EsiQuotaError } from '../../src/esi-gateway/failures.js'

const characterId = 1_404_328_063
const subjectLifecycleId = '11111111-1111-4111-8111-111111111111'
const freshness = {
  cachedUntil: '2026-09-03T12:00:00.000Z',
  quota: {},
  source: 'esi' as const,
  stale: false,
  validatedAt: '2026-09-03T11:00:00.000Z',
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) {
    if (typeof mock === 'function') mock.mockReset()
  }
  for (const method of Object.values(mocks.query)) {
    method.mockClear()
  }
  mocks.query.from.mockImplementation(() => mocks.query)
  mocks.query.leftJoin.mockImplementation(() => mocks.query)
  mocks.query.where.mockImplementation(() => mocks.query)
  mocks.query.limit.mockResolvedValue([])
  mocks.executeRepresentation.mockImplementation((definition, input) => {
    if (definition.operation === 'character-asset-names') {
      return Promise.resolve(
        result(
          (input as { body: number[] }).body.map((itemId) => ({ itemId, name: `Asset ${itemId}` })),
        ),
      )
    }
    return Promise.resolve(result(page((input as { page: number }).page, 1)))
  })
  mocks.resolveUniverseNamesBestEffort.mockResolvedValue({ complete: true, names: new Map() })
  mocks.getStaticLocations.mockResolvedValue([])
})

describe('complete character asset collection', () => {
  test('enriches mapped page snapshots and exposes only the intentional DTO', async () => {
    mocks.executeRepresentation.mockImplementation((definition, input) => {
      if (definition.operation === 'character-asset-names') {
        return Promise.resolve(result([{ itemId: 22, name: 'Asset 22' }]))
      }
      return Promise.resolve(
        result({
          assets: [
            asset({
              itemId: 22,
              typeId: 34,
              quantity: 5,
              isSingleton: true,
              locationId: 60_000_001,
              locationType: 'station',
            }),
            asset({
              itemId: 23,
              typeId: 35,
              locationId: 22,
              locationType: 'item',
              parentItemId: 22,
            }),
          ],
          page: (input as { page: number }).page,
          totalPages: 1,
        }),
      )
    })
    mocks.query.limit.mockResolvedValue([
      {
        categoryId: 4,
        categoryName: 'Material',
        groupId: 18,
        groupName: 'Mineral',
        typeId: 34,
        typeName: 'Tritanium',
        unitVolume: 0.01,
      },
      {
        categoryId: 4,
        categoryName: 'Material',
        groupId: 18,
        groupName: 'Mineral',
        typeId: 35,
        typeName: 'Pyerite',
        unitVolume: null,
      },
    ])
    mocks.resolveUniverseNamesBestEffort.mockResolvedValue({
      complete: true,
      names: new Map([
        [60_000_001, { id: 60_000_001, name: 'Jita IV - Moon 4', category: 'station' }],
      ]),
    })
    mocks.getStaticLocations.mockResolvedValue([
      {
        id: 60_000_001,
        name: null,
        solarSystemId: 30_000_142,
        solarSystemSecurityStatus: 0.945,
        type: 'station',
      },
    ])

    const resultValue = await getCharacterAssets(characterId, subjectLifecycleId)

    expect(resultValue).toMatchObject({
      assets: [
        {
          itemId: 22,
          typeName: 'Tritanium',
          customName: 'Asset 22',
          totalVolume: 0.05,
          locationName: 'Jita IV - Moon 4',
        },
        { itemId: 23, typeName: 'Pyerite', parentItemId: 22 },
      ],
      characterId,
      enrichment: { locations: 'complete', names: 'complete', types: 'complete' },
    })
    expect(mocks.executeRepresentation.mock.calls[0]?.[1]).toStrictEqual({
      characterId,
      page: 1,
      subjectLifecycleId,
    })
    expect(mocks.executeRepresentation.mock.calls[1]?.[1]).toStrictEqual({
      body: [22],
      path: { character_id: characterId },
      subjectLifecycleId,
    })
  })

  test('preserves page order while bounded workers resolve mapped pages out of order', async () => {
    let active = 0
    let maximumActive = 0
    mocks.executeRepresentation.mockImplementation(async (definition, input) => {
      if (definition.operation === 'character-asset-names') {
        return result([])
      }
      const pageNumber = (input as { page: number }).page
      if (pageNumber > 1) {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await new Promise((resolve) => setTimeout(resolve, pageNumber === 2 ? 10 : 1))
        active -= 1
      }
      return result(page(pageNumber, 10))
    })

    const resultValue = await getCharacterAssets(characterId, subjectLifecycleId)

    expect(resultValue.assets.map((entry) => entry.itemId)).toStrictEqual(
      Array.from({ length: 10 }, (_, index) => index + 1),
    )
    expect(maximumActive).toBe(4)
  })

  test('keeps selected stale metadata and retry semantics from mapped page results', async () => {
    mocks.executeRepresentation.mockImplementation((definition, input) => {
      if (definition.operation === 'character-asset-names') {
        return Promise.resolve(result([]))
      }
      const pageNumber = (input as { page: number }).page
      return Promise.resolve({
        ...result(page(pageNumber, 2)),
        refreshFailureClass: pageNumber === 1 ? 'esi-unavailable' : 'esi-cooldown',
        retryAt: '2026-09-03T10:00:00.000Z',
        stale: true,
      })
    })

    await expect(getCharacterAssets(characterId, subjectLifecycleId)).resolves.toMatchObject({
      refreshFailureClass: 'esi-unavailable',
      stale: true,
    })
  })

  test('preserves required-page callable failures', async () => {
    mocks.executeRepresentation.mockImplementation((definition, input) => {
      if (
        definition.operation === 'character-assets-page' &&
        (input as { page: number }).page === 2
      ) {
        throw new EsiQuotaError(19)
      }
      return Promise.resolve(result(page((input as { page?: number }).page ?? 1, 2)))
    })

    await expect(getCharacterAssets(characterId, subjectLifecycleId)).rejects.toMatchObject({
      retryAfterSeconds: 19,
    })
  })
})

describe('bounded character asset enrichment', () => {
  test('preserves missing locations and exact zero and negative security values', async () => {
    mocks.executeRepresentation.mockImplementation((definition) => {
      if (definition.operation === 'character-asset-names') {
        return Promise.resolve(result([]))
      }
      return Promise.resolve(
        result({
          assets: [
            asset({ itemId: 1, locationId: 60_000_001, locationType: 'station' }),
            asset({ itemId: 2, locationId: 30_000_002, locationType: 'solar_system' }),
            asset({ itemId: 3, locationId: 30_000_003, locationType: 'solar_system' }),
          ],
          page: 1,
          totalPages: 1,
        }),
      )
    })
    mocks.getStaticLocations.mockResolvedValue([
      {
        id: 30_000_002,
        name: 'Zero',
        solarSystemId: 30_000_002,
        solarSystemSecurityStatus: 0,
        type: 'solar_system',
      },
      {
        id: 30_000_003,
        name: 'Negative',
        solarSystemId: 30_000_003,
        solarSystemSecurityStatus: -0.06,
        type: 'solar_system',
      },
    ])

    const resultValue = await getCharacterAssets(characterId, subjectLifecycleId)

    expect(resultValue.assets).toMatchObject([
      {
        itemId: 1,
        locationName: null,
        solarSystemId: null,
        solarSystemSecurityStatus: null,
      },
      {
        itemId: 2,
        locationName: 'Zero',
        solarSystemId: 30_000_002,
        solarSystemSecurityStatus: 0,
      },
      {
        itemId: 3,
        locationName: 'Negative',
        solarSystemId: 30_000_003,
        solarSystemSecurityStatus: -0.06,
      },
    ])
    expect(resultValue.enrichment.locations).toBe('partial')
  })

  test('retains resolved location names when cold static enrichment fails', async () => {
    mocks.executeRepresentation.mockImplementation((definition) => {
      if (definition.operation === 'character-asset-names') {
        return Promise.resolve(result([]))
      }
      return Promise.resolve(
        result({
          assets: [asset({ locationId: 60_000_001, locationType: 'station' })],
          page: 1,
          totalPages: 1,
        }),
      )
    })
    mocks.resolveUniverseNamesBestEffort.mockResolvedValue({
      complete: true,
      names: new Map([
        [60_000_001, { id: 60_000_001, name: 'Jita IV - Moon 4', category: 'station' }],
      ]),
    })
    mocks.getStaticLocations.mockRejectedValue(new Error('Static location projection unavailable'))

    await expect(getCharacterAssets(characterId, subjectLifecycleId)).resolves.toMatchObject({
      assets: [
        {
          locationName: 'Jita IV - Moon 4',
          solarSystemId: null,
          solarSystemSecurityStatus: null,
        },
      ],
      enrichment: { locations: 'partial' },
    })
  })

  test('sorts and deduplicates name candidates before callable execution', async () => {
    mocks.executeRepresentation.mockImplementation((definition, input) => {
      if (definition.operation === 'character-asset-names') {
        return Promise.resolve(
          result(
            (input as { body: number[] }).body.map((itemId) => ({
              itemId,
              name: `Asset ${itemId}`,
            })),
          ),
        )
      }
      return Promise.resolve(
        result({
          assets: [30, 10, 20, 10].map((itemId) => asset({ itemId, isSingleton: true })),
          page: 1,
          totalPages: 1,
        }),
      )
    })

    const resultValue = await getCharacterAssets(characterId, subjectLifecycleId)
    const nameCall = mocks.executeRepresentation.mock.calls.find(
      ([definition]) => definition.operation === 'character-asset-names',
    )

    expect(nameCall?.[1]).toStrictEqual({
      body: [10, 20, 30],
      path: { character_id: characterId },
      subjectLifecycleId,
    })
    expect(
      resultValue.assets.map(({ itemId, customName }) => ({ customName, itemId })),
    ).toStrictEqual([
      { customName: 'Asset 30', itemId: 30 },
      { customName: 'Asset 10', itemId: 10 },
      { customName: 'Asset 20', itemId: 20 },
    ])
  })

  test('splits oversized name sets at the reviewed ESI batch limit', async () => {
    const itemIds = Array.from({ length: 1001 }, (_, index) => 1001 - index)
    mocks.executeRepresentation.mockImplementation((definition, input) => {
      if (definition.operation === 'character-asset-names') {
        return Promise.resolve(
          result(
            (input as { body: number[] }).body.map((itemId) => ({
              itemId,
              name: `Asset ${itemId}`,
            })),
          ),
        )
      }
      return Promise.resolve(
        result({
          assets: itemIds.map((itemId) => asset({ itemId, isSingleton: true })),
          page: 1,
          totalPages: 1,
        }),
      )
    })

    const resultValue = await getCharacterAssets(characterId, subjectLifecycleId)
    const nameBodies = mocks.executeRepresentation.mock.calls
      .filter(([definition]) => definition.operation === 'character-asset-names')
      .map(([, input]) => (input as { body: number[] }).body)

    expect(nameBodies).toStrictEqual([
      Array.from({ length: 1000 }, (_, index) => index + 1),
      [1001],
    ])
    expect(resultValue.enrichment.names).toBe('complete')
    expect(resultValue.assets).toHaveLength(1001)
  })

  test('does not issue an empty name batch when no asset is nameable', async () => {
    await getCharacterAssets(characterId, subjectLifecycleId)

    expect(
      mocks.executeRepresentation.mock.calls.some(
        ([definition]) => definition.operation === 'character-asset-names',
      ),
    ).toBe(false)
  })

  test('rejects invalid name candidates through the character-assets interface', async () => {
    mocks.executeRepresentation.mockResolvedValueOnce(
      result({
        assets: [asset({ itemId: 0, isSingleton: true })],
        page: 1,
        totalPages: 1,
      }),
    )

    await expect(getCharacterAssets(characterId, subjectLifecycleId)).rejects.toThrow(
      'positive safe integers',
    )
  })

  test.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['unsafe', Number.MAX_SAFE_INTEGER + 1],
    ['non-finite', Number.POSITIVE_INFINITY],
    ['above the fan-out bound', 1001],
  ])('rejects %s page totals through the character-assets interface', async (_case, totalPages) => {
    mocks.executeRepresentation.mockImplementation((definition, input) => {
      if (definition.operation !== 'character-assets-page') {
        return Promise.resolve(result([]))
      }
      return Promise.resolve(result(mapAssetPage(definition, input, totalPages)))
    })

    await expect(getCharacterAssets(characterId, subjectLifecycleId)).rejects.toBeInstanceOf(
      CharacterAssetsPaginationError,
    )
  })

  test('rejects a cached first page whose number differs from the request before fan-out', async () => {
    mocks.executeRepresentation.mockResolvedValueOnce({ ...result(page(2, 2)), source: 'cache' })

    await expect(getCharacterAssets(characterId, subjectLifecycleId)).rejects.toBeInstanceOf(
      CharacterAssetsPaginationError,
    )
    expect(mocks.executeRepresentation).toHaveBeenCalledOnce()
  })

  test('rejects a mismatched subsequent page without assembling a partial collection', async () => {
    mocks.executeRepresentation.mockImplementation((definition) => {
      if (definition.operation !== 'character-assets-page') {
        return Promise.resolve(result([]))
      }
      return Promise.resolve(result(page(1, 2)))
    })

    await expect(getCharacterAssets(characterId, subjectLifecycleId)).rejects.toBeInstanceOf(
      CharacterAssetsPaginationError,
    )
    expect(mocks.executeRepresentation).toHaveBeenCalledTimes(2)
  })

  test('accepts a cached page with the requested number', async () => {
    mocks.executeRepresentation.mockResolvedValueOnce({ ...result(page(1, 1)), source: 'cache' })

    await expect(getCharacterAssets(characterId, subjectLifecycleId)).resolves.toMatchObject({
      assets: [{ itemId: 1 }],
      characterId,
    })
  })
})

function asset(overrides: Record<string, unknown> = {}) {
  return {
    isBlueprintCopy: null,
    isSingleton: false,
    itemId: 1,
    locationFlag: 'Hangar',
    locationId: 1_035_466_617_946,
    locationType: 'other' as const,
    parentItemId: null,
    quantity: 1,
    typeId: 34,
    ...overrides,
  }
}

function page(pageNumber: number, totalPages: unknown) {
  return { assets: [asset({ itemId: pageNumber })], page: pageNumber, totalPages }
}

function result<Data>(data: Data) {
  return { data, ...freshness }
}

function mapAssetPage(definition: unknown, input: unknown, totalPages: number) {
  const map = (
    definition as {
      map: (
        response: { data: unknown[]; meta: { pagination: { pages: number } } },
        input: unknown,
      ) => unknown
    }
  ).map
  return map({ data: [], meta: { pagination: { pages: totalPages } } }, input)
}
