import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AssetFilterState, AssetRecord } from '../../app/types/assets'
import { createAssetWorkspaceController } from '../../app/utils/assets-controller'
import { buildAssetHierarchy } from '../../app/utils/assets-hierarchy'

const noFilters: AssetFilterState = {
  search: '',
  typeIds: [],
  groupIds: [],
  categoryIds: [],
  locationKeys: [],
  locationTypes: [],
  flags: [],
  singleton: 'all',
  blueprint: 'all',
}

describe('asset workspace controller', () => {
  it('persists location and container expansion across refreshes and unrelated drill-downs', () => {
    const first = buildAssetHierarchy([asset(1), child(2, 1), child(3, 1)])
    const refreshed = buildAssetHierarchy([asset(1), child(2, 1), child(3, 1), child(4, 1)])
    const controller = createAssetWorkspaceController({
      revealIncrement: 10,
      initiallyExpandedLocations: 0,
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

  it('caps mounted rows per location and reveals fixed increments', () => {
    const group = buildAssetHierarchy(Array.from({ length: 9 }, (_, index) => asset(index + 1)))[0]!
    const controller = createAssetWorkspaceController({
      revealIncrement: 3,
      initiallyExpandedLocations: 1,
    })
    controller.sync([group])

    expect(controller.visibleLocation(group).rows).toHaveLength(3)
    expect(controller.visibleLocation(group)).toMatchObject({ totalVisibleRows: 9, hasMore: true })
    controller.showMore(group)
    expect(controller.revealLimit(group.key)).toBe(6)
    expect(controller.visibleLocation(group).rows).toHaveLength(6)
    controller.showMore(group)
    expect(controller.visibleLocation(group).rows).toHaveLength(9)
    expect(controller.visibleLocation(group)).toMatchObject({ totalVisibleRows: 9, hasMore: false })
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
      revealIncrement: 10,
      initiallyExpandedLocations: 0,
    })
    controller.sync([group])
    controller.setCriteria({ ...noFilters, search: 'nested' })

    expect(controller.isLocationExpanded(group.key)).toBe(false)
    expect(controller.isContainerExpanded(1)).toBe(false)
    expect(controller.visibleLocation(group).rows.map(({ row }) => row.asset.itemId)).toEqual([
      1, 2, 3,
    ])
  })

  it('keeps shared presentation modules independent from source adapters', () => {
    for (const path of [
      'app/types/assets.ts',
      'app/utils/assets-hierarchy.ts',
      'app/utils/assets-filter.ts',
      'app/utils/assets-controller.ts',
    ]) {
      const source = readFileSync(resolve(process.cwd(), path), 'utf8')
      expect(source).not.toMatch(/hono|route|query|scope|ownership|character|corporation/i)
    }
  })
})

function child(itemId: number, parentItemId: number) {
  return asset(itemId, {
    typeName: itemId === 3 ? 'Nested laser' : 'Nested container',
    locationId: parentItemId,
    locationType: 'item',
    locationName: null,
    parentItemId,
  })
}

function asset(itemId: number, overrides: Partial<AssetRecord> = {}): AssetRecord {
  return {
    itemId,
    typeId: 100,
    typeName: 'Container',
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
    locationId: 60003760,
    locationType: 'station',
    locationName: 'Jita IV - Moon 4',
    locationFlag: 'Hangar',
    parentItemId: null,
    ...overrides,
  }
}
