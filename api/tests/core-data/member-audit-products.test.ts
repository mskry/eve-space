import { describe, expect, test, vi } from 'vitest'
import { loadPublishedSkillCatalogueProduct } from '../../src/core-data/published-skill-catalogue-adapter.js'
import { loadPublishedTypeDetailsProduct } from '../../src/core-data/published-type-details-adapter.js'
import { loadPublishedTypeGroupsProduct } from '../../src/core-data/published-type-groups-adapter.js'
import {
  boundedPositiveIds,
  nonemptyString,
  nullableNonnegativeFinite,
  positiveSafeInteger,
  selectCoreDataRevision,
} from '../../src/core-data/sde-product-adapter.js'
import { loadStaticLocationLabelsProduct } from '../../src/core-data/static-location-labels-adapter.js'

const sparseIds: number[] = []
sparseIds.length = 1

describe.each([
  ['published type details', loadPublishedTypeDetailsProduct, 'typeIds'],
  ['static location labels', loadStaticLocationLabelsProduct, 'locationIds'],
] as const)('%s product validation', (_label, load, property) => {
  test('rejects inherited and accessor ID arrays without evaluating the accessor', () => {
    const getter = vi.fn(() => [1])
    const inherited = Object.create({ [property]: [1] })
    const accessor = Object.defineProperty({}, property, { get: getter })

    expect(() => boundedPositiveIds(inherited, property, 'Product', 500)).toThrow(
      `must contain a ${property} array`,
    )
    expect(() => boundedPositiveIds(accessor, property, 'Product', 500)).toThrow(
      `must contain a ${property} array`,
    )
    expect(getter).not.toHaveBeenCalled()
  })

  test.each([
    [undefined, `must contain a ${property} array`],
    [{ [property]: sparseIds }, 'positive safe integers'],
    [{ [property]: [0] }, 'positive safe integers'],
    [{ [property]: [1.5] }, 'positive safe integers'],
    [{ [property]: [Number.MAX_SAFE_INTEGER + 1] }, 'positive safe integers'],
    [{ [property]: Array.from({ length: 501 }, (_, index) => index + 1) }, 'cannot exceed 500'],
  ])('rejects invalid requests before source access', (request, message) => {
    const begin = vi.fn()
    const sourceDatabase = { begin }

    expect(() => load(request as never, sourceDatabase)).toThrow(message)
    expect(begin).not.toHaveBeenCalled()
  })

  test('deduplicates before enforcing the source request', async () => {
    const begin = vi.fn(() => Promise.reject(new Error('source reached')))
    const sourceDatabase = { begin }
    const ids = Array.from({ length: 501 }, () => 7)

    await expect(load({ [property]: ids } as never, sourceDatabase)).rejects.toThrow(
      'source reached',
    )
    expect(begin).toHaveBeenCalledOnce()
  })
})

test('projects bounded skill, type-detail, and location products from one committed revision', async () => {
  const skillResult = await loadPublishedSkillCatalogueProduct(
    {},
    database([
      {
        group_id: '255',
        group_name: 'Gunnery',
        primary_attribute: 167,
        rank: 1,
        secondary_attribute: 168,
        type_id: '3300',
        type_name: 'Gunnery',
      },
    ]) as never,
  )
  const typeResult = await loadPublishedTypeDetailsProduct(
    { typeIds: [34, 34] },
    database([
      {
        category_id: '4',
        category_name: 'Material',
        group_id: '18',
        group_name: 'Mineral',
        packaged_volume: 0.01,
        type_id: '34',
        type_name: 'Tritanium',
      },
    ]) as never,
  )
  const typeGroupResult = await loadPublishedTypeGroupsProduct(
    { typeIds: [34, 34] },
    database([
      {
        group_id: '18',
        group_name: 'Mineral',
        type_id: '34',
        type_name: 'Tritanium',
      },
    ]) as never,
  )
  const locationResult = await loadStaticLocationLabelsProduct(
    { locationIds: [30_000_142] },
    database([
      {
        kind: 'solar_system',
        location_id: '30000142',
        name: 'Jita',
        solar_system_id: '30000142',
      },
    ]) as never,
  )

  expect(skillResult).toMatchObject({
    complete: true,
    rows: [
      {
        primaryAttribute: 'perception',
        rank: 1,
        secondaryAttribute: 'willpower',
        typeId: 3300,
      },
    ],
  })
  expect(typeResult).toMatchObject({
    complete: true,
    rows: [{ categoryId: 4, packagedVolume: 0.01, typeId: 34 }],
  })
  expect(typeGroupResult).toMatchObject({
    complete: true,
    rows: [{ groupId: 18, groupName: 'Mineral', typeId: 34, typeName: 'Tritanium' }],
  })
  expect(locationResult).toMatchObject({
    complete: true,
    rows: [{ kind: 'solar_system', locationId: 30_000_142, name: 'Jita' }],
  })
  expect(skillResult.revision).toStrictEqual(typeResult.revision)
  expect(typeResult.revision).toStrictEqual(typeGroupResult.revision)
  expect(typeResult.revision).toStrictEqual(locationResult.revision)
})

test('returns complete empty bounded products without issuing their data query', async () => {
  const typeDatabase = database([])
  const typeGroupDatabase = database([])
  const locationDatabase = database([])

  await expect(
    loadPublishedTypeDetailsProduct({ typeIds: [] }, typeDatabase as never),
  ).resolves.toMatchObject({
    complete: true,
    rows: [],
  })
  await expect(
    loadStaticLocationLabelsProduct({ locationIds: [] }, locationDatabase as never),
  ).resolves.toMatchObject({ complete: true, rows: [] })
  await expect(
    loadPublishedTypeGroupsProduct({ typeIds: [] }, typeGroupDatabase as never),
  ).resolves.toMatchObject({ complete: true, rows: [] })
  expect(typeDatabase.transaction).not.toHaveBeenCalledWith(
    expect.arrayContaining([expect.stringContaining('from sde_types')]),
  )
  expect(locationDatabase.transaction).not.toHaveBeenCalledWith(
    expect.arrayContaining([expect.stringContaining('from sde_solar_systems')]),
  )
  expect(typeGroupDatabase.transaction).not.toHaveBeenCalledWith(
    expect.arrayContaining([expect.stringContaining('from sde_types as types')]),
  )
})

test('rejects oversized catalogues and invalid source rows', async () => {
  await expect(
    loadPublishedSkillCatalogueProduct(
      {},
      database(Array.from({ length: 10_001 }, () => ({}))) as never,
    ),
  ).rejects.toThrow('exceeds its bound')
  await expect(
    loadStaticLocationLabelsProduct(
      { locationIds: [1] },
      database([
        { kind: 'region', location_id: '1', name: 'Invalid', solar_system_id: '1' },
      ]) as never,
    ),
  ).rejects.toThrow('location kind is invalid')
  await expect(
    loadPublishedTypeDetailsProduct(
      { typeIds: [34] },
      database([
        {
          category_id: '4',
          category_name: 'Material',
          group_id: '18',
          group_name: 'Mineral',
          packaged_volume: -1,
          type_id: '34',
          type_name: 'Tritanium',
        },
      ]) as never,
    ),
  ).rejects.toThrow('packaged volume is invalid')
})

test('validates shared SDE values and missing committed revisions', async () => {
  expect(positiveSafeInteger(7, 'value')).toBe(7)
  expect(positiveSafeInteger('8', 'value')).toBe(8)
  expect(() => positiveSafeInteger('0', 'value')).toThrow('value is invalid')
  expect(() => positiveSafeInteger('1x', 'value')).toThrow('value is invalid')
  expect(nonemptyString('name', 'value')).toBe('name')
  expect(() => nonemptyString('  ', 'value')).toThrow('value is invalid')
  expect(() => nonemptyString(1, 'value')).toThrow('value is invalid')
  expect(nullableNonnegativeFinite(null, 'value')).toBeNull()
  expect(nullableNonnegativeFinite(0, 'value')).toBe(0)
  expect(() => nullableNonnegativeFinite(-1, 'value')).toThrow('value is invalid')
  expect(() => nullableNonnegativeFinite(Number.POSITIVE_INFINITY, 'value')).toThrow(
    'value is invalid',
  )
  expect(() => nullableNonnegativeFinite('1', 'value')).toThrow('value is invalid')
  await expect(
    selectCoreDataRevision(transaction([], null) as never, new AbortController().signal),
  ).rejects.toThrow('Committed SDE revision is missing')
})

function database(rows: readonly Record<string, unknown>[]) {
  const databaseTransaction = transaction(rows)
  return {
    begin: vi.fn(
      (_options: string, load: (value: typeof databaseTransaction) => Promise<unknown>) =>
        load(databaseTransaction),
    ),
    transaction: databaseTransaction,
  }
}

function transaction(
  rows: readonly Record<string, unknown>[],
  revision: Record<string, unknown> | null = {
    build_number: '1234',
    ingest_version: 4,
    ingested_at: '2026-09-17T10:00:00Z',
  },
) {
  return Object.assign(
    vi.fn((strings: TemplateStringsArray) => {
      const statement = strings.join(' ')
      if (statement.includes('from sde_projection_state')) {
        return cancellable(revision === null ? [] : [revision])
      }
      if (
        statement.includes('from sde_types as types') ||
        statement.includes('from sde_solar_systems as systems')
      ) {
        return cancellable([...rows])
      }
      return cancellable([])
    }),
    {
      array: vi.fn((values: readonly number[]) => [...values]),
      unsafe: vi.fn(() => cancellable([])),
    },
  )
}

function cancellable<Value>(value: Value) {
  return Object.assign(Promise.resolve(value), { cancel: vi.fn() })
}
