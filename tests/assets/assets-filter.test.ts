import { describe, expect, it } from 'vitest'
import type { AssetRecord } from '../../app/types/assets'
import { EMPTY_ASSET_FILTERS, filterAssetHierarchy } from '../../app/utils/assets-filter'
import { buildAssetHierarchy } from '../../app/utils/assets-hierarchy'

describe('asset filters', () => {
  it('fuzzy matches misspelled inventory identities', () => {
    const hierarchy = buildAssetHierarchy([
      asset(1, { customName: 'Expedition crate', typeName: 'Secure Container' }),
      asset(2, { customName: 'Deep scanner', typeName: 'Probe Scanner' }),
    ])

    const result = filterAssetHierarchy(hierarchy, {
      ...EMPTY_ASSET_FILTERS,
      search: 'expedtion crte',
    })

    expect(result.matchCount).toBe(1)
    expect(result.groups[0]?.rows[0]?.asset.itemId).toBe(1)
  })

  it('treats skin as a SKIN category term instead of fuzzy-matching singleton', () => {
    const groups = buildAssetHierarchy([
      asset(1, { categoryName: 'Ship', groupName: 'Shuttle', typeName: 'Amarr Shuttle' }),
      asset(2, {
        categoryId: 91,
        categoryName: 'SKINs',
        groupId: 1950,
        groupName: 'Permanent SKIN',
        typeId: 57_006,
        typeName: 'Raptor Aurora Universalis SKIN',
      }),
    ])

    const result = filterAssetHierarchy(groups, { ...EMPTY_ASSET_FILTERS, search: 'skin' })

    expect(
      result.groups.flatMap((group) => group.rows.map((row) => row.asset.typeName)),
    ).toStrictEqual(['Raptor Aurora Universalis SKIN'])
  })

  it('matches an exact prefix longer than the fuzzy-search pattern limit', () => {
    const longIdentity = 'LONG-ASSET-IDENTITY-WITHOUT-BREAKS-'.repeat(18)
    const groups = buildAssetHierarchy([
      asset(1, { customName: longIdentity, typeName: longIdentity }),
      asset(2, { typeName: 'Amarr Shuttle' }),
    ])

    const result = filterAssetHierarchy(groups, {
      ...EMPTY_ASSET_FILTERS,
      search: longIdentity.slice(0, 40),
    })

    expect(
      result.groups.flatMap((group) => group.rows.map((row) => row.asset.itemId)),
    ).toStrictEqual([1])
  })
})

function asset(itemId: number, overrides: Partial<AssetRecord> = {}): AssetRecord {
  return {
    categoryId: 65,
    categoryName: 'Structure',
    customName: null,
    groupId: 12,
    groupName: 'Cargo Container',
    isBlueprintCopy: null,
    isSingleton: true,
    itemId,
    locationFlag: 'Hangar',
    locationId: 60_003_760,
    locationName: 'Jita IV - Moon 4',
    locationType: 'station',
    parentItemId: null,
    quantity: 1,
    solarSystemId: 30_000_142,
    solarSystemSecurityStatus: 0.9,
    totalVolume: 1,
    typeId: 100 + itemId,
    typeName: `Inventory item ${itemId}`,
    unitVolume: 1,
    ...overrides,
  }
}

describe('blueprint terms', () => {
  it('does not match every asset for "blueprint"', () => {
    const groups = buildAssetHierarchy([
      filterAsset(1, { categoryName: 'Ship', groupName: 'Shuttle', typeName: 'Amarr Shuttle' }),
      filterAsset(2, {
        categoryId: 9,
        categoryName: 'Blueprint',
        groupName: 'Cruiser Blueprint',
        typeName: 'Zealot Blueprint',
      }),
    ])
    const result = filterAssetHierarchy(groups, { ...EMPTY_ASSET_FILTERS, search: 'blueprint' })

    expect(
      result.groups.flatMap((group) => group.rows.map((row) => row.asset.typeName)),
    ).toStrictEqual(['Zealot Blueprint'])
  })

  it('matches originals whose copy state ESI never reported', () => {
    const groups = buildAssetHierarchy([
      filterAsset(1, { categoryId: 6, categoryName: 'Ship', typeName: 'Amarr Shuttle' }),
      filterAsset(2, {
        categoryId: 9,
        categoryName: 'Blueprint',
        isBlueprintCopy: null,
        typeName: 'Zealot Blueprint',
      }),
    ])
    const result = filterAssetHierarchy(groups, {
      ...EMPTY_ASSET_FILTERS,
      blueprint: 'original',
    })

    expect(
      result.groups.flatMap((group) => group.rows.map((row) => row.asset.typeName)),
    ).toStrictEqual(['Zealot Blueprint'])
  })
})

function filterAsset(itemId: number, overrides: Partial<AssetRecord> = {}): AssetRecord {
  return {
    categoryId: 2,
    categoryName: 'Category',
    customName: null,
    groupId: 1,
    groupName: 'Group',
    isBlueprintCopy: null,
    isSingleton: true,
    itemId,
    locationFlag: 'Hangar',
    locationId: 60_003_760,
    locationName: 'Jita IV - Moon 4',
    locationType: 'station',
    parentItemId: null,
    quantity: 1,
    solarSystemId: 30_000_142,
    solarSystemSecurityStatus: 0.9,
    totalVolume: 1,
    typeId: 100 + itemId,
    typeName: `Item ${itemId}`,
    unitVolume: 1,
    ...overrides,
  }
}
