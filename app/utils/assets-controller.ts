import type { AssetFilterState, AssetLocationGroup, AssetVisibleLocation } from '../types/assets'
import { assetFilterSignature, EMPTY_ASSET_FILTERS, hasActiveAssetFilters } from './assets-filter'
import { flattenAssetRows } from './assets-hierarchy'

interface AssetWorkspaceControllerOptions {
  revealIncrement?: number
  initiallyExpandedLocations?: number
}

export const ASSET_REVEAL_INCREMENT = 100

export function createAssetWorkspaceController(options: AssetWorkspaceControllerOptions = {}) {
  const revealIncrement = positiveInteger(options.revealIncrement, ASSET_REVEAL_INCREMENT)
  const initiallyExpandedLocations = nonnegativeInteger(options.initiallyExpandedLocations, 1)
  const expandedLocations = new Set<string>()
  const expandedContainers = new Set<number>()
  const revealLimits = new Map<string, number>()
  let initialized = false
  let activeFilters = false
  let criteriaSignature = assetFilterSignature(EMPTY_ASSET_FILTERS)

  function sync(groups: readonly AssetLocationGroup[]) {
    if (initialized || groups.length === 0) return
    for (const group of groups.slice(0, initiallyExpandedLocations)) {
      expandedLocations.add(group.key)
    }
    initialized = true
  }

  function setCriteria(filters: AssetFilterState) {
    const nextSignature = assetFilterSignature(filters)
    activeFilters = hasActiveAssetFilters(filters)
    if (nextSignature === criteriaSignature) return false
    criteriaSignature = nextSignature
    revealLimits.clear()
    return true
  }

  function toggleLocation(key: string) {
    if (expandedLocations.has(key)) expandedLocations.delete(key)
    else expandedLocations.add(key)
  }

  function toggleContainer(itemId: number) {
    if (expandedContainers.has(itemId)) expandedContainers.delete(itemId)
    else expandedContainers.add(itemId)
  }

  function visibleLocation(group: AssetLocationGroup): AssetVisibleLocation {
    const flattened = rowsForLocation(group)
    const limit = revealLimits.get(group.key) ?? revealIncrement
    return {
      rows: flattened.slice(0, limit),
      totalVisibleRows: flattened.length,
      hasMore: flattened.length > limit,
    }
  }

  function rowsForLocation(group: AssetLocationGroup) {
    if (!activeFilters && !expandedLocations.has(group.key)) return []
    return flattenAssetRows(group.rows, activeFilters ? 'all' : expandedContainers)
  }

  function showMore(group: AssetLocationGroup) {
    const visible = visibleLocation(group)
    if (!visible.hasMore) return false
    const currentLimit = revealLimits.get(group.key) ?? revealIncrement
    revealLimits.set(group.key, Math.min(visible.totalVisibleRows, currentLimit + revealIncrement))
    return true
  }

  return {
    isContainerExpanded: (itemId: number) => expandedContainers.has(itemId),
    isLocationExpanded: (key: string) => expandedLocations.has(key),
    revealLimit: (key: string) => revealLimits.get(key) ?? revealIncrement,
    rowsForLocation,
    setCriteria,
    showMore,
    sync,
    toggleContainer,
    toggleLocation,
    visibleLocation,
  }
}

function positiveInteger(value: number | undefined, fallback: number) {
  return Number.isSafeInteger(value) && value !== undefined && value > 0 ? value : fallback
}

function nonnegativeInteger(value: number | undefined, fallback: number) {
  return Number.isSafeInteger(value) && value !== undefined && value >= 0 ? value : fallback
}
