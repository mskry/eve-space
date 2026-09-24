import { describe, expect, it } from 'vitest'
import type { AssetRecord } from '../../app/types/assets'
import { filterAssetHierarchy } from '../../app/utils/assets-filter'
import {
  assetBlueprintLabel,
  assetImageKind,
  assetPlacementLabel,
  buildAssetHierarchy,
  flattenAssetRows,
  isSkinAsset,
} from '../../app/utils/assets-hierarchy'

describe('asset hierarchy', () => {
  it('groups roots by location and attaches nested children in deterministic display order', () => {
    const hierarchy = buildAssetHierarchy([
      asset(4, { customName: 'Zulu', locationId: 2, locationName: 'Amarr' }),
      asset(3, { customName: null, locationId: 1, locationName: 'Jita', typeName: 'Veldspar' }),
      asset(2, { customName: 'Beta', locationId: 1, locationType: 'item', parentItemId: 1 }),
      asset(1, { customName: 'Alpha', locationId: 1, locationName: 'Jita' }),
    ])

    expect(hierarchy.map((group) => group.label)).toStrictEqual(['Amarr', 'Jita'])
    const jita = hierarchy[1]!
    expect(jita.assetCount).toBe(3)
    expect(jita.knownVolume).toBe(3)
    expect(jita.rows.map((row) => row.asset.itemId)).toStrictEqual([1, 3])
    expect(jita.rows[0]?.children.map((row) => row.asset.itemId)).toStrictEqual([2])
    expect(flattenAssetRows(jita.rows, 'all').map(({ row }) => row.asset.itemId)).toStrictEqual([
      1, 2, 3,
    ])
  })

  it('handles deep hierarchies without recursive traversal', () => {
    const assets = [asset(1)]
    for (let itemId = 2; itemId <= 20_000; itemId += 1) {
      assets.push(
        asset(itemId, {
          locationId: itemId - 1,
          locationType: 'item',
          parentItemId: itemId - 1,
        }),
      )
    }

    const hierarchy = buildAssetHierarchy(assets)
    expect(hierarchy).toHaveLength(1)
    expect(hierarchy[0]?.assetCount).toBe(20_000)
    expect(flattenAssetRows(hierarchy[0]!.rows, 'all')).toHaveLength(20_000)
  })

  it('places orphans, self-links, and cycles safely while preserving unrelated branches', () => {
    const hierarchy = buildAssetHierarchy([
      asset(1),
      asset(2, { locationId: 1, locationType: 'item', parentItemId: 1 }),
      asset(10, { locationId: 999, locationType: 'item', parentItemId: 999 }),
      asset(11, { locationId: 11, locationType: 'item', parentItemId: 11 }),
      asset(20, { locationId: 21, locationType: 'item', parentItemId: 21 }),
      asset(21, { locationId: 22, locationType: 'item', parentItemId: 22 }),
      asset(22, { locationId: 20, locationType: 'item', parentItemId: 20 }),
    ])
    const byPlacement = new Map(hierarchy.map((group) => [group.placement, group]))

    expect(byPlacement.get('location')?.assetCount).toBe(2)
    expect(byPlacement.get('unresolved-container')?.rows[0]?.asset.itemId).toBe(10)
    expect(byPlacement.get('unresolved-container')?.rows[0]?.issues).toContain('missing-parent')
    const broken = byPlacement.get('broken-cycle')!
    expect(flattenAssetRows(broken.rows, 'all').map(({ row }) => row.asset.itemId)).toStrictEqual([
      11, 20, 22, 21,
    ])
    expect(broken.rows.find((row) => row.asset.itemId === 11)?.issues).toContain('self-link')
    expect(broken.rows.find((row) => row.asset.itemId === 20)?.issues).toContain('cycle')
    expect(
      new Set(
        hierarchy
          .flatMap((group) => flattenAssetRows(group.rows, 'all'))
          .map(({ row }) => row.asset.itemId),
      ).size,
    ).toBe(7)
  })

  it('selects one deterministic representation for duplicate identities', () => {
    const forward = buildAssetHierarchy([
      asset(1, { customName: 'Zulu' }),
      asset(1, { customName: 'Alpha' }),
    ])
    const reverse = buildAssetHierarchy([
      asset(1, { customName: 'Alpha' }),
      asset(1, { customName: 'Zulu' }),
    ])

    for (const hierarchy of [forward, reverse]) {
      expect(hierarchy[0]?.assetCount).toBe(1)
      expect(hierarchy[0]?.rows[0]?.asset.customName).toBe('Alpha')
      expect(hierarchy[0]?.rows[0]?.issues).toContain('duplicate')
    }
  })
})

describe('asset contextual filtering', () => {
  const hierarchy = buildAssetHierarchy([
    asset(1, { customName: 'Travel Kit', typeName: 'Freight Container' }),
    asset(2, {
      categoryId: 6,
      categoryName: 'Module',
      groupId: 20,
      groupName: 'Energy Weapon',
      isBlueprintCopy: null,
      isSingleton: true,
      locationFlag: 'Cargo',
      locationId: 1,
      locationType: 'item',
      parentItemId: 1,
      typeId: 200,
      typeName: 'Café Laser',
    }),
    asset(3, {
      categoryId: 6,
      categoryName: 'Module',
      groupId: 30,
      groupName: 'Shield',
      isBlueprintCopy: null,
      isSingleton: true,
      locationFlag: 'Cargo',
      locationId: 1,
      locationType: 'item',
      parentItemId: 1,
      typeId: 300,
      typeName: 'Shield Booster',
    }),
    asset(4, {
      categoryId: 9,
      categoryName: 'Blueprint',
      groupId: 40,
      groupName: 'Module Blueprint',
      isBlueprintCopy: true,
      isSingleton: true,
      locationFlag: 'Cargo',
      locationId: 1,
      locationType: 'item',
      parentItemId: 1,
      typeId: 400,
      typeName: 'Shield Booster Blueprint',
    }),
  ])

  it('normalizes descendant search and retains its location and container ancestors', () => {
    const result = filterAssetHierarchy(hierarchy, filters({ search: '  CAFE   laser ' }))
    expect(result.matchCount).toBe(1)
    expect(result.groups[0]?.knownVolume).toBe(2)
    expect(result.groups[0]?.label).toBe('Jita IV - Moon 4')
    expect(
      flattenAssetRows(result.groups[0]!.rows, 'all').map(({ row }) => row.asset.itemId),
    ).toStrictEqual([1, 2])
  })

  it('searches custom name, location, group, category, blueprint, singleton, and flag context', () => {
    for (const search of [
      'Travel Kit',
      'Jita IV',
      'Energy Weapon',
      'Module',
      'blueprint copy',
      'singleton',
      'Cargo',
    ]) {
      expect(filterAssetHierarchy(hierarchy, filters({ search })).matchCount).toBeGreaterThan(0)
    }
  })

  it('combines filters without mutating the source and reports filtered-empty distinctly', () => {
    const result = filterAssetHierarchy(
      hierarchy,
      filters({
        blueprint: 'unknown',
        categoryIds: [6],
        flags: ['Cargo'],
        groupIds: [20],
        locationKeys: [hierarchy[0]!.key],
        locationTypes: ['station'],
        singleton: 'yes',
        typeIds: [200],
      }),
    )
    expect(result.matchCount).toBe(1)
    expect(result.sourceCount).toBe(4)
    expect(flattenAssetRows(result.groups[0]!.rows, 'all')).toHaveLength(2)
    expect(hierarchy[0]?.assetCount).toBe(4)

    const empty = filterAssetHierarchy(hierarchy, filters({ typeIds: [999] }))
    expect(empty).toStrictEqual({ groups: [], matchCount: 0, sourceCount: 4 })
  })
})

function filters(overrides: Partial<Parameters<typeof filterAssetHierarchy>[1]> = {}) {
  return {
    blueprint: 'all' as const,
    categoryIds: [],
    flags: [],
    groupIds: [],
    locationKeys: [],
    locationTypes: [],
    search: '',
    singleton: 'all' as const,
    typeIds: [],
    ...overrides,
  }
}

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
    typeId: 100,
    typeName: 'Container',
    unitVolume: 1,
    ...overrides,
  }
}

describe('blueprint presentation', () => {
  it('recognises a blueprint from static data because ESI omits the flag for originals', () => {
    const original = asset(1, { categoryId: 9, categoryName: 'Blueprint', isBlueprintCopy: null })
    expect(assetImageKind(original)).toBe('type-bp')
    expect(assetBlueprintLabel(original)).toBe('BPO')
  })

  it('distinguishes a copy from an original', () => {
    const copy = asset(2, { categoryId: 9, categoryName: 'Blueprint', isBlueprintCopy: true })
    expect(assetImageKind(copy)).toBe('type-bpc')
    expect(assetBlueprintLabel(copy)).toBe('BPC')
  })

  it('leaves a non-blueprint on the icon variation with no badge', () => {
    const module = asset(3, { categoryId: 7, categoryName: 'Module', isBlueprintCopy: null })
    expect(assetImageKind(module)).toBe('type-icon')
    expect(assetBlueprintLabel(module)).toBeNull()
  })
})

describe('SKIN presentation', () => {
  it('recognises SKIN inventory types from static category data', () => {
    expect(isSkinAsset(asset(4, { categoryId: 91, categoryName: 'SKINs' }))).toBe(true)
    expect(isSkinAsset(asset(5, { categoryId: 7, categoryName: 'Module' }))).toBe(false)
  })
})

describe('placement labels', () => {
  it('reads ESI PascalCase flags as words', () => {
    expect(assetPlacementLabel('AssetSafety')).toBe('Asset Safety')
    expect(assetPlacementLabel('ShipHangar')).toBe('Ship Hangar')
    expect(assetPlacementLabel('HiSlot0')).toBe('Hi Slot 0')
    expect(assetPlacementLabel('CorpSAG1')).toBe('Corp SAG 1')
    expect(assetPlacementLabel('Hangar')).toBe('Hangar')
  })

  it('disambiguates Cargo and reports an absent flag', () => {
    expect(assetPlacementLabel('Cargo')).toBe('Cargo Hold')
    expect(assetPlacementLabel('')).toBe('Unknown')
  })
})

describe('group ordering', () => {
  it('sorts unresolved placements after resolved locations', () => {
    const groups = buildAssetHierarchy([
      asset(1, { locationId: 1, locationName: null, locationType: 'item', parentItemId: 404 }),
      asset(2, { locationId: 60_003_760, locationName: 'Zzz Station' }),
      asset(3, { locationId: 60_003_761, locationName: 'Aaa Station' }),
    ])

    expect(groups.map((group) => group.label)).toStrictEqual([
      'Aaa Station',
      'Zzz Station',
      'Restricted structure',
    ])
  })
})
