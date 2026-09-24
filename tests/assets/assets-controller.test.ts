import { describe, expect, it } from 'vitest'
import type { AssetFilterState, AssetRecord } from '../../app/types/assets'
import { createAssetWorkspaceController } from '../../app/utils/assets-controller'
import { buildAssetHierarchy } from '../../app/utils/assets-hierarchy'
import { readWorkspaceFile } from '../support/read-workspace-file'

const noFilters: AssetFilterState = {
  blueprint: 'all',
  categoryIds: [],
  flags: [],
  groupIds: [],
  locationKeys: [],
  locationTypes: [],
  search: '',
  singleton: 'all',
  typeIds: [],
}

describe('asset workspace controller', () => {
  it('persists location and container expansion across refreshes and unrelated drill-downs', () => {
    const first = buildAssetHierarchy([asset(1), child(2, 1), child(3, 1)])
    const refreshed = buildAssetHierarchy([asset(1), child(2, 1), child(3, 1), child(4, 1)])
    const controller = createAssetWorkspaceController({
      initiallyExpandedLocations: 0,
      revealIncrement: 10,
    })
    controller.sync(first)
    controller.toggleLocation(first[0]!.key)
    controller.toggleContainer(1)
    controller.visibleLocation(first[0]!)

    controller.sync(refreshed)
    expect(controller.isLocationExpanded(first[0]!.key)).toBe(true)
    expect(controller.isContainerExpanded(1)).toBe(true)
    expect(controller.visibleLocation(refreshed[0]!).rows).toHaveLength(4)
  })

  it('waits for loaded groups before applying the initial location expansion', () => {
    const group = buildAssetHierarchy([asset(1)])[0]!
    const controller = createAssetWorkspaceController()
    controller.sync([])
    controller.sync([group])
    expect(controller.isLocationExpanded(group.key)).toBe(true)
  })

  it('rebinds automatic expansion when groups reorder without changing manual choices', () => {
    const groups = buildAssetHierarchy([
      asset(1, { locationId: 60_003_760, locationName: 'Alpha' }),
      asset(2, { locationId: 60_003_761, locationName: 'Bravo' }),
      asset(3, { locationId: 60_003_762, locationName: 'Charlie' }),
    ])
    const controller = createAssetWorkspaceController()
    controller.sync(groups)
    controller.toggleLocation(groups[0]!.key)
    controller.toggleLocation(groups[2]!.key)

    controller.sync([groups[1]!, groups[2]!, groups[0]!])

    expect(controller.isLocationExpanded(groups[0]!.key)).toBe(false)
    expect(controller.isLocationExpanded(groups[1]!.key)).toBe(true)
    expect(controller.isLocationExpanded(groups[2]!.key)).toBe(true)
  })

  it('caps mounted rows per location and reveals fixed increments', () => {
    const group = buildAssetHierarchy(Array.from({ length: 9 }, (_, index) => asset(index + 1)))[0]!
    const controller = createAssetWorkspaceController({
      initiallyExpandedLocations: 1,
      revealIncrement: 3,
    })
    controller.sync([group])

    expect(controller.visibleLocation(group).rows).toHaveLength(3)
    expect(controller.visibleLocation(group)).toMatchObject({ hasMore: true, totalVisibleRows: 9 })
    controller.showMore(group)
    expect(controller.revealLimit(group.key)).toBe(6)
    expect(controller.visibleLocation(group).rows).toHaveLength(6)
    controller.showMore(group)
    expect(controller.visibleLocation(group).rows).toHaveLength(9)
    expect(controller.visibleLocation(group)).toMatchObject({ hasMore: false, totalVisibleRows: 9 })
  })

  it('resets reveal cursors, but not expansion, only when normalized criteria change', () => {
    const group = buildAssetHierarchy(Array.from({ length: 8 }, (_, index) => asset(index + 1)))[0]!
    const controller = createAssetWorkspaceController({ revealIncrement: 2 })
    controller.sync([group])
    controller.toggleContainer(1)
    controller.showMore(group)
    expect(controller.revealLimit(group.key)).toBe(4)

    expect(controller.setCriteria({ ...noFilters, search: '  LASER ' })).toBe(true)
    expect(controller.revealLimit(group.key)).toBe(2)
    expect(controller.isLocationExpanded(group.key)).toBe(true)
    expect(controller.isContainerExpanded(1)).toBe(true)
    controller.showMore(group)
    expect(controller.setCriteria({ ...noFilters, search: 'laser' })).toBe(false)
    expect(controller.revealLimit(group.key)).toBe(4)

    expect(controller.setCriteria(noFilters)).toBe(true)
    expect(controller.revealLimit(group.key)).toBe(2)
  })

  it('reveals retained contextual rows during active criteria without changing saved expansion', () => {
    const group = buildAssetHierarchy([asset(1), child(2, 1), child(3, 2)])[0]!
    const controller = createAssetWorkspaceController({
      initiallyExpandedLocations: 0,
      revealIncrement: 10,
    })
    controller.sync([group])
    controller.setCriteria({ ...noFilters, search: 'nested' })

    expect(controller.isLocationExpanded(group.key)).toBe(false)
    expect(controller.isContainerExpanded(1)).toBe(false)
    expect(controller.visibleLocation(group).rows.map(({ row }) => row.asset.itemId)).toStrictEqual(
      [1, 2, 3],
    )
  })

  it('keeps shared presentation modules independent from source adapters', () => {
    for (const path of [
      'app/types/assets.ts',
      'app/utils/assets-hierarchy.ts',
      'app/utils/assets-filter.ts',
      'app/utils/assets-controller.ts',
    ]) {
      const source = readWorkspaceFile(path)
      expect(source).not.toMatch(/hono|route|query|scope|ownership|character|corporation/i)
    }
  })
})

function child(itemId: number, parentItemId: number) {
  return asset(itemId, {
    locationId: parentItemId,
    locationName: null,
    locationType: 'item',
    parentItemId,
    solarSystemId: null,
    typeName: itemId === 3 ? 'Nested laser' : 'Nested container',
  })
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
