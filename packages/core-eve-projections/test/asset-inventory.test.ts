import { describe, expect, test } from 'vitest'
import {
  normalizeInventoryObservation,
  excludeInventoryConflicts,
  sumInventoryQuantities,
} from '../src/asset-inventory.js'
import type { AssetSnapshot } from '../src/assets.js'

const asset = (itemId: number, overrides: Partial<AssetSnapshot> = {}): AssetSnapshot => ({
  itemId,
  typeId: 34,
  quantity: 1,
  isSingleton: false,
  isBlueprintCopy: null,
  locationId: 60000001,
  locationType: 'station',
  locationFlag: 'Hangar',
  parentItemId: null,
  ...overrides,
})

describe('complete inventory normalization', () => {
  test('counts containers and their contents separately at the physical root, deduplicating rows', () => {
    const child = asset(2, { locationId: 1, locationType: 'item', parentItemId: 1, quantity: 7 })
    const rows = normalizeInventoryObservation([
      child,
      asset(1),
      asset(3, { locationId: 2, locationType: 'item', parentItemId: 2, quantity: 11 }),
      child,
    ])
    expect(rows.map((row) => [row.itemId, row.quantity, row.root.key])).toEqual([
      [1, '1', 'station:60000001'],
      [2, '7', 'station:60000001'],
      [3, '11', 'station:60000001'],
    ])
    expect(sumInventoryQuantities(rows.map((row) => row.quantity))).toBe('19')
  })

  test('retains unrelated roots and quantities beside missing parents, cycles and restricted roots', () => {
    const rows = normalizeInventoryObservation([
      asset(1),
      asset(2, { locationType: 'item', locationId: 99, parentItemId: 99 }),
      asset(3, { locationType: 'item', locationId: 4, parentItemId: 4 }),
      asset(4, { locationType: 'item', locationId: 3, parentItemId: 3 }),
      asset(5, { locationType: 'other', locationId: 1000000000001 }),
    ])
    expect(rows.map((row) => [row.root.state, row.quantity])).toEqual([
      ['known', '1'],
      ['unresolved', '1'],
      ['unresolved', '1'],
      ['unresolved', '1'],
      ['restricted', '1'],
    ])
    expect(rows[4]?.root.key).toBe('other:1000000000001')
  })

  test('resolves deep ancestry without recursion or quadratic repeated traversal', () => {
    const assets = Array.from({ length: 10000 }, (_, index) =>
      asset(
        index + 1,
        index === 9999
          ? {}
          : {
              locationType: 'item',
              locationId: index + 2,
              parentItemId: index + 2,
            },
      ),
    )
    const rows = normalizeInventoryObservation(assets)
    expect(rows).toHaveLength(10000)
    expect(rows.every((row) => row.root.key === 'station:60000001')).toBe(true)
  })

  test('preserves copy flags and exact sums beyond JavaScript integer precision', () => {
    const rows = normalizeInventoryObservation([
      asset(1, { quantity: Number.MAX_SAFE_INTEGER, isBlueprintCopy: true }),
      asset(2, { quantity: Number.MAX_SAFE_INTEGER, isBlueprintCopy: false }),
    ])
    expect(rows.map((row) => row.blueprint)).toEqual(['copy', 'none'])
    expect(sumInventoryQuantities(rows.map((row) => row.quantity))).toBe('18014398509481982')
  })

  test.each([0, -1, -2, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])(
    'rejects unsupported quantity %s rather than asserting a total',
    (quantity) => {
      expect(() => normalizeInventoryObservation([asset(1, { quantity })])).toThrow(
        'unsupported quantity',
      )
    },
  )

  test('refuses inconsistent copies inside one observation', () => {
    expect(() => normalizeInventoryObservation([asset(1), asset(1, { quantity: 2 })])).toThrow(
      'conflicting duplicate',
    )
  })

  test('excludes every cross-holder copy of a moved item while retaining independent stock', () => {
    const result = excludeInventoryConflicts([
      {
        characterId: 10,
        items: normalizeInventoryObservation([
          asset(1, { quantity: 100 }),
          asset(2, { quantity: 7 }),
        ]),
      },
      {
        characterId: 20,
        items: normalizeInventoryObservation([
          asset(1, { quantity: 100 }),
          asset(3, { quantity: 11 }),
        ]),
      },
      { characterId: 30, items: normalizeInventoryObservation([asset(4, { quantity: 13 })]) },
    ])
    expect(result.observations.map((row) => row.items.map((item) => item.itemId))).toEqual([
      [2],
      [3],
      [4],
    ])
    expect([...result.conflictingCharacters]).toEqual([10, 20])
    expect(
      sumInventoryQuantities(
        result.observations.flatMap((row) => row.items.map((item) => item.quantity)),
      ),
    ).toBe('31')
  })
})
