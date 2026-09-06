type AssetLocationType = 'station' | 'solar_system' | 'item' | 'other'
type AssetEnrichmentStatus = 'complete' | 'partial' | 'unavailable'
export type AssetHierarchyIssue = 'duplicate' | 'missing-parent' | 'self-link' | 'cycle'
export type AssetGroupPlacement = 'location' | 'unresolved-container' | 'broken-cycle'
type AssetToggleFilter = 'all' | 'yes' | 'no'
export type AssetBlueprintFilter = 'all' | 'copy' | 'original' | 'unknown'
type AssetResourcePhase =
  | 'loading'
  | 'ready'
  | 'access-required'
  | 'authorization-rejected'
  | 'cooldown'
  | 'unavailable'

export interface AssetRecord {
  itemId: number
  typeId: number
  typeName: string
  groupId: number | null
  groupName: string | null
  categoryId: number | null
  categoryName: string | null
  unitVolume: number | null
  totalVolume: number | null
  quantity: number
  isSingleton: boolean
  isBlueprintCopy: boolean | null
  customName: string | null
  locationId: number
  locationType: AssetLocationType
  locationName: string | null
  locationFlag: string
  parentItemId: number | null
}

interface AssetEnrichment {
  types: AssetEnrichmentStatus
  names: AssetEnrichmentStatus
  locations: AssetEnrichmentStatus
}

export interface AssetCollection {
  assets: AssetRecord[]
  enrichment: AssetEnrichment
  stale: boolean
  validatedAt: string
  refreshFailureClass: string | null
  retryAt: string | null
}

export interface AssetHierarchyRow {
  asset: AssetRecord
  children: AssetHierarchyRow[]
  issues: AssetHierarchyIssue[]
}

export interface AssetLocationGroup {
  key: string
  label: string
  locationId: number | null
  locationType: Exclude<AssetLocationType, 'item'> | null
  placement: AssetGroupPlacement
  rows: AssetHierarchyRow[]
  assetCount: number
}

export interface AssetFilterState {
  search: string
  typeIds: readonly number[]
  groupIds: readonly number[]
  categoryIds: readonly number[]
  locationKeys: readonly string[]
  locationTypes: readonly Exclude<AssetLocationType, 'item'>[]
  flags: readonly string[]
  singleton: AssetToggleFilter
  blueprint: AssetBlueprintFilter
}

export interface AssetFilterResult {
  groups: AssetLocationGroup[]
  matchCount: number
  sourceCount: number
}

export interface AssetVisibleRow {
  row: AssetHierarchyRow
  depth: number
}

export interface AssetVisibleLocation {
  rows: AssetVisibleRow[]
  totalVisibleRows: number
  hasMore: boolean
}

export interface AssetResourceAction {
  href: string
  label: string
}

export interface AssetResourceState {
  phase: AssetResourcePhase
  initialLoading: boolean
  refreshing: boolean
  refreshFailed: boolean
  stale: boolean
  message: string | null
  statusLabel: string | null
  canRetry: boolean
  retryAt: string | null
  action: AssetResourceAction | null
}
