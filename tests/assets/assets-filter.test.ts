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
      asset(1, { typeName: 'Amarr Shuttle', groupName: 'Shuttle', categoryName: 'Ship' }),
      asset(2, {
        typeId: 57_006,
        typeName: 'Raptor Aurora Universalis SKIN',
        groupId: 1_950,
        groupName: 'Permanent SKIN',
        categoryId: 91,
        categoryName: 'SKINs',
      }),
    ])

    const result = filterAssetHierarchy(groups, { ...EMPTY_ASSET_FILTERS, search: 'skin' })

    expect(result.groups.flatMap((group) => group.rows.map((row) => row.asset.typeName))).toEqual([
      'Raptor Aurora Universalis SKIN',
    ])
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

    expect(result.groups.flatMap((group) => group.rows.map((row) => row.asset.itemId))).toEqual([1])
  })
})

function asset(itemId: number, overrides: Partial<AssetRecord> = {}): AssetRecord {
  return {
    itemId,
    typeId: 100 + itemId,
    typeName: `Inventory item ${itemId}`,
    groupId: 12,
    groupName: 'Cargo Container',
    categoryId: 65,
    categoryName: 'Structure',
    unitVolume: 1,
    totalVolume: 1,
    quantity: 1,
    isSingleton: true,
    isBlueprintCopy: null,
    customName: null,
    locationId: 60_003_760,
    locationType: 'station',
    locationName: 'Jita IV - Moon 4',
    locationFlag: 'Hangar',
    parentItemId: null,
    ...overrides,
  }
}

describe('blueprint terms', () => {
  it('does not match every asset for "blueprint"', () => {
    const groups = buildAssetHierarchy([
      filterAsset(1, { typeName: 'Amarr Shuttle', groupName: 'Shuttle', categoryName: 'Ship' }),
      filterAsset(2, {
        typeName: 'Zealot Blueprint',
        groupName: 'Cruiser Blueprint',
        categoryId: 9,
        categoryName: 'Blueprint',
      }),
    ])
    const result = filterAssetHierarchy(groups, { ...EMPTY_ASSET_FILTERS, search: 'blueprint' })

    expect(result.groups.flatMap((group) => group.rows.map((row) => row.asset.typeName))).toEqual([
      'Zealot Blueprint',
    ])
  })

  it('matches originals whose copy state ESI never reported', () => {
    const groups = buildAssetHierarchy([
      filterAsset(1, { typeName: 'Amarr Shuttle', categoryId: 6, categoryName: 'Ship' }),
      filterAsset(2, {
        typeName: 'Zealot Blueprint',
        categoryId: 9,
        categoryName: 'Blueprint',
        isBlueprintCopy: null,
      }),
    ])
    const result = filterAssetHierarchy(groups, {
      ...EMPTY_ASSET_FILTERS,
      blueprint: 'original',
    })

    expect(result.groups.flatMap((group) => group.rows.map((row) => row.asset.typeName))).toEqual([
      'Zealot Blueprint',
    ])
  })
})

function filterAsset(itemId: number, overrides: Partial<AssetRecord> = {}): AssetRecord {
  return {
    itemId,
    typeId: 100 + itemId,
    typeName: `Item ${itemId}`,
    groupId: 1,
    groupName: 'Group',
    categoryId: 2,
    categoryName: 'Category',
    unitVolume: 1,
    totalVolume: 1,
    quantity: 1,
    isSingleton: true,
    isBlueprintCopy: null,
    customName: null,
    locationId: 60_003_760,
    locationType: 'station',
    locationName: 'Jita IV - Moon 4',
    locationFlag: 'Hangar',
    parentItemId: null,
    ...overrides,
  }
}
