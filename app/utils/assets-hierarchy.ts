import type {
  AssetGroupPlacement,
  AssetHierarchyIssue,
  AssetHierarchyRow,
  AssetLocationGroup,
  AssetRecord,
} from '../types/assets'

type VisitState = 'visiting' | 'complete'

interface RootPlacement {
  placement: Exclude<AssetGroupPlacement, 'location'>
}

export function buildAssetHierarchy(source: readonly AssetRecord[]): AssetLocationGroup[] {
  const { assets, duplicateIds } = deduplicateAssets(source)
  const { parentById, rootPlacements, issuesById } = indexAssetRelationships(assets, duplicateIds)

  breakCycles(assets, parentById, rootPlacements, issuesById)
  const rowsById = buildHierarchyRows(assets, parentById, issuesById)
  return groupHierarchyRoots(assets, parentById, rootPlacements, rowsById)
}

// ESI only sets is_blueprint_copy for copies, so originals arrive unset and must be recognised
// from the static category instead.
const blueprintCategoryId = 9
const skinCategoryId = 91

export function isBlueprintAsset(asset: AssetRecord) {
  return asset.categoryId === blueprintCategoryId || asset.categoryName === 'Blueprint'
}

export function isSkinAsset(asset: AssetRecord) {
  return asset.categoryId === skinCategoryId || asset.categoryName === 'SKINs'
}

// Blueprints serve only the bp/bpc image variations; the icon variation does not exist for them.
export function assetImageKind(asset: AssetRecord) {
  if (!isBlueprintAsset(asset)) return 'type-icon' as const
  return asset.isBlueprintCopy === true ? ('type-bpc' as const) : ('type-bp' as const)
}

export function assetBlueprintLabel(asset: AssetRecord) {
  if (!isBlueprintAsset(asset)) return null
  return asset.isBlueprintCopy === true ? 'BPC' : 'BPO'
}

const placementOverrides: Record<string, string> = { Cargo: 'Cargo Hold' }

export function assetPlacementLabel(flag: string) {
  if (!flag) return 'Unknown'
  return (
    placementOverrides[flag] ??
    flag
      .replace(/([a-z\d])([A-Z])/g, '$1 $2')
      .replace(/([A-Z])(?=[A-Z][a-z])/g, '$1 ')
      .replace(/([A-Za-z])(\d)/g, '$1 $2')
  )
}

export function assetLocationLabel(asset: AssetRecord) {
  if (asset.locationName) return asset.locationName
  if (asset.locationType === 'station') return `Station ${asset.locationId}`
  if (asset.locationType === 'solar_system') return `Solar system ${asset.locationId}`
  return `Location ${asset.locationId}`
}

export function flattenAssetRows(
  rows: readonly AssetHierarchyRow[],
  expanded: ReadonlySet<number> | 'all',
) {
  const flattened: Array<{ row: AssetHierarchyRow; depth: number }> = []
  const pending = rows.toReversed().map((row) => ({ row, depth: 0 }))
  while (pending.length > 0) {
    const current = pending.pop()!
    flattened.push(current)
    if (expanded !== 'all' && !expanded.has(current.row.asset.itemId)) continue
    for (let index = current.row.children.length - 1; index >= 0; index -= 1) {
      pending.push({ row: current.row.children[index]!, depth: current.depth + 1 })
    }
  }
  return flattened
}

function deduplicateAssets(source: readonly AssetRecord[]) {
  const sorted = source.toSorted(compareDuplicateCandidates)
  const assets: AssetRecord[] = []
  const duplicateIds = new Set<number>()
  for (const asset of sorted) {
    if (assets.at(-1)?.itemId === asset.itemId) {
      duplicateIds.add(asset.itemId)
    } else {
      assets.push(asset)
    }
  }
  return { assets, duplicateIds }
}

function compareDuplicateCandidates(left: AssetRecord, right: AssetRecord) {
  return (
    left.itemId - right.itemId ||
    assetFingerprint(left).localeCompare(assetFingerprint(right), 'en')
  )
}

function assetFingerprint(asset: AssetRecord) {
  return JSON.stringify([
    asset.customName,
    asset.typeId,
    asset.typeName,
    asset.groupId,
    asset.groupName,
    asset.categoryId,
    asset.categoryName,
    asset.unitVolume,
    asset.totalVolume,
    asset.quantity,
    asset.isSingleton,
    asset.isBlueprintCopy,
    asset.locationId,
    asset.locationType,
    asset.locationName,
    asset.locationFlag,
    asset.parentItemId,
  ])
}

function indexAssetRelationships(
  assets: readonly AssetRecord[],
  duplicateIds: ReadonlySet<number>,
) {
  const assetsById = new Map(assets.map((asset) => [asset.itemId, asset]))
  const parentById = new Map<number, number>()
  const rootPlacements = new Map<number, RootPlacement>()
  const issuesById = new Map<number, Set<AssetHierarchyIssue>>()

  for (const asset of assets) {
    if (duplicateIds.has(asset.itemId)) addIssue(issuesById, asset.itemId, 'duplicate')
    if (asset.locationType !== 'item') continue

    const parentId = asset.parentItemId
    if (parentId === asset.itemId) {
      rootPlacements.set(asset.itemId, { placement: 'broken-cycle' })
      addIssue(issuesById, asset.itemId, 'self-link')
    } else if (parentId === null || !assetsById.has(parentId)) {
      rootPlacements.set(asset.itemId, { placement: 'unresolved-container' })
      addIssue(issuesById, asset.itemId, 'missing-parent')
    } else {
      parentById.set(asset.itemId, parentId)
    }
  }
  return { parentById, rootPlacements, issuesById }
}

function buildHierarchyRows(
  assets: readonly AssetRecord[],
  parentById: ReadonlyMap<number, number>,
  issuesById: ReadonlyMap<number, ReadonlySet<AssetHierarchyIssue>>,
) {
  const rowsById = new Map<number, AssetHierarchyRow>()
  for (const asset of assets) {
    rowsById.set(asset.itemId, {
      asset,
      children: [],
      issues: [...(issuesById.get(asset.itemId) ?? [])].toSorted((left, right) =>
        left.localeCompare(right, 'en'),
      ),
    })
  }
  for (const [childId, parentId] of parentById) {
    rowsById.get(parentId)?.children.push(rowsById.get(childId)!)
  }
  for (const row of rowsById.values()) row.children.sort(compareRows)
  return rowsById
}

function groupHierarchyRoots(
  assets: readonly AssetRecord[],
  parentById: ReadonlyMap<number, number>,
  rootPlacements: ReadonlyMap<number, RootPlacement>,
  rowsById: ReadonlyMap<number, AssetHierarchyRow>,
) {
  const groupsByKey = new Map<string, AssetLocationGroup>()
  for (const asset of assets) {
    if (parentById.has(asset.itemId)) continue
    const row = rowsById.get(asset.itemId)!
    const rootPlacement = rootPlacements.get(asset.itemId)
    const group = rootPlacement ? exceptionalGroup(rootPlacement.placement) : locationGroup(asset)
    const existing = groupsByKey.get(group.key)
    if (existing) existing.rows.push(row)
    else {
      groupsByKey.set(group.key, group)
      group.rows.push(row)
    }
  }

  const groups = [...groupsByKey.values()]
  for (const group of groups) {
    group.rows.sort(compareRows)
    group.assetCount = countRows(group.rows)
  }
  return groups.toSorted(compareGroups)
}

function breakCycles(
  assets: readonly AssetRecord[],
  parentById: Map<number, number>,
  rootPlacements: Map<number, RootPlacement>,
  issuesById: Map<number, Set<AssetHierarchyIssue>>,
) {
  const states = new Map<number, VisitState>()
  for (const asset of assets) {
    if (states.get(asset.itemId) === 'complete') continue
    const { path, cycleIds } = traceParentPath(asset.itemId, parentById, states)
    if (cycleIds) breakCycle(cycleIds, parentById, rootPlacements, issuesById)
    for (const itemId of path) states.set(itemId, 'complete')
  }
}

function traceParentPath(
  startId: number,
  parentById: ReadonlyMap<number, number>,
  states: Map<number, VisitState>,
) {
  const path: number[] = []
  const positions = new Map<number, number>()
  let currentId: number | undefined = startId
  while (currentId !== undefined && states.get(currentId) !== 'complete') {
    const cycleStart = positions.get(currentId)
    if (cycleStart !== undefined) return { path, cycleIds: path.slice(cycleStart) }

    positions.set(currentId, path.length)
    path.push(currentId)
    states.set(currentId, 'visiting')
    currentId = parentById.get(currentId)
  }
  return { path, cycleIds: null }
}

function breakCycle(
  cycleIds: readonly number[],
  parentById: Map<number, number>,
  rootPlacements: Map<number, RootPlacement>,
  issuesById: Map<number, Set<AssetHierarchyIssue>>,
) {
  let breakId = cycleIds[0]!
  for (const cycleId of cycleIds) breakId = Math.min(breakId, cycleId)
  parentById.delete(breakId)
  rootPlacements.set(breakId, { placement: 'broken-cycle' })
  for (const cycleId of cycleIds) addIssue(issuesById, cycleId, 'cycle')
}

function addIssue(
  issuesById: Map<number, Set<AssetHierarchyIssue>>,
  itemId: number,
  issue: AssetHierarchyIssue,
) {
  const issues = issuesById.get(itemId) ?? new Set<AssetHierarchyIssue>()
  issues.add(issue)
  issuesById.set(itemId, issues)
}

function locationGroup(asset: AssetRecord): AssetLocationGroup {
  if (asset.locationType === 'item') return exceptionalGroup('unresolved-container')
  return {
    key: `location:${asset.locationType}:${asset.locationId}`,
    label: assetLocationLabel(asset),
    locationId: asset.locationId,
    locationType: asset.locationType,
    placement: 'location',
    rows: [],
    assetCount: 0,
  }
}

function exceptionalGroup(placement: Exclude<AssetGroupPlacement, 'location'>): AssetLocationGroup {
  return {
    key: placement,
    // An absent parent means an Upwell structure this authorization cannot resolve.
    label: placement === 'broken-cycle' ? 'Broken container cycle' : 'Restricted structure',
    locationId: null,
    locationType: null,
    placement,
    rows: [],
    assetCount: 0,
  }
}

function compareRows(left: AssetHierarchyRow, right: AssetHierarchyRow) {
  return (
    compareNullableText(left.asset.customName, right.asset.customName) ||
    left.asset.typeName.localeCompare(right.asset.typeName, 'en') ||
    left.asset.itemId - right.asset.itemId
  )
}

function compareNullableText(left: string | null, right: string | null) {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return left.localeCompare(right, 'en')
}

function compareGroups(left: AssetLocationGroup, right: AssetLocationGroup) {
  return (
    groupRank(left) - groupRank(right) ||
    left.label.localeCompare(right.label, 'en') ||
    (left.locationId ?? Number.MAX_SAFE_INTEGER) - (right.locationId ?? Number.MAX_SAFE_INTEGER) ||
    left.key.localeCompare(right.key, 'en')
  )
}

function groupRank(group: AssetLocationGroup) {
  return group.placement === 'location' ? 0 : 1
}

function countRows(rows: readonly AssetHierarchyRow[]) {
  let count = 0
  const pending = [...rows]
  while (pending.length > 0) {
    const row = pending.pop()!
    count += 1
    for (const child of row.children) pending.push(child)
  }
  return count
}
