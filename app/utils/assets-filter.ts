import Fuse from 'fuse.js'
import type {
  AssetBlueprintFilter,
  AssetFilterResult,
  AssetFilterState,
  AssetHierarchyRow,
  AssetLocationGroup,
  AssetRecord,
} from '../types/assets'
import { isBlueprintAsset, isSkinAsset } from './assets-hierarchy'

const searchableTextByAsset = new WeakMap<AssetRecord, Map<string, string>>()
const searchIndexByHierarchy = new WeakMap<
  readonly AssetLocationGroup[],
  Fuse<AssetSearchDocument>
>()
const skinSearchTerms = new Set(['skin', 'skins'])

interface AssetSearchDocument {
  itemId: number
  text: string
}

interface FlattenedAssetRow {
  row: AssetHierarchyRow
  parentId: number | null
}

export const EMPTY_ASSET_FILTERS: AssetFilterState = {
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

export function filterAssetHierarchy(
  groups: readonly AssetLocationGroup[],
  filters: AssetFilterState,
): AssetFilterResult {
  const sourceCount = groups.reduce((sum, group) => sum + group.assetCount, 0)
  if (!hasActiveAssetFilters(filters)) {
    return { groups: [...groups], matchCount: sourceCount, sourceCount }
  }

  const searchTerms = normalizeAssetSearch(filters.search).split(' ').filter(Boolean)
  const searchMatches = searchTerms.length > 0 ? fuzzySearchMatches(groups, searchTerms) : null
  const filteredGroups: AssetLocationGroup[] = []
  let matchCount = 0
  for (const group of groups) {
    const result = filterAssetGroup(group, filters, searchMatches)
    if (!result) continue
    filteredGroups.push(result.group)
    matchCount += result.matchCount
  }

  return { groups: filteredGroups, matchCount, sourceCount }
}

export function normalizeAssetSearch(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLocaleLowerCase('en')
    .trim()
    .replace(/\s+/g, ' ')
}

export function hasActiveAssetFilters(filters: AssetFilterState) {
  return (
    normalizeAssetSearch(filters.search) !== '' ||
    filters.typeIds.length > 0 ||
    filters.groupIds.length > 0 ||
    filters.categoryIds.length > 0 ||
    filters.locationKeys.length > 0 ||
    filters.locationTypes.length > 0 ||
    filters.flags.length > 0 ||
    filters.singleton !== 'all' ||
    filters.blueprint !== 'all'
  )
}

export function assetFilterSignature(filters: AssetFilterState) {
  return JSON.stringify({
    search: normalizeAssetSearch(filters.search),
    typeIds: [...new Set(filters.typeIds)].toSorted((left, right) => left - right),
    groupIds: [...new Set(filters.groupIds)].toSorted((left, right) => left - right),
    categoryIds: [...new Set(filters.categoryIds)].toSorted((left, right) => left - right),
    locationKeys: [...new Set(filters.locationKeys)].toSorted(compareText),
    locationTypes: [...new Set(filters.locationTypes)].toSorted(compareText),
    flags: [...new Set(filters.flags)].toSorted(compareText),
    singleton: filters.singleton,
    blueprint: filters.blueprint,
  })
}

function filterAssetGroup(
  group: AssetLocationGroup,
  filters: AssetFilterState,
  searchMatches: ReadonlySet<number> | null,
) {
  const rows = flattenRows(group.rows)
  const directMatches = matchingAssetIds(rows, group, filters, searchMatches)
  if (directMatches.size === 0) return null

  const included = includeAncestors(rows, directMatches)
  return {
    group: {
      ...group,
      rows: cloneIncludedRows(rows, included),
      assetCount: included.size,
    },
    matchCount: directMatches.size,
  }
}

function matchingAssetIds(
  rows: readonly { row: AssetHierarchyRow }[],
  group: AssetLocationGroup,
  filters: AssetFilterState,
  searchMatches: ReadonlySet<number> | null,
) {
  const matches = new Set<number>()
  for (const { row } of rows) {
    if (matchesAsset(row.asset, group, filters, searchMatches)) matches.add(row.asset.itemId)
  }
  return matches
}

function includeAncestors(rows: readonly FlattenedAssetRow[], directMatches: ReadonlySet<number>) {
  const included = new Set(directMatches)
  const parentById = new Map<number, number>()
  for (const { row, parentId } of rows) {
    if (parentId !== null) parentById.set(row.asset.itemId, parentId)
  }
  for (const itemId of directMatches) {
    let parentId = parentById.get(itemId)
    while (parentId !== undefined && !included.has(parentId)) {
      included.add(parentId)
      parentId = parentById.get(parentId)
    }
  }
  return included
}

function matchesAsset(
  asset: AssetRecord,
  group: AssetLocationGroup,
  filters: AssetFilterState,
  searchMatches: ReadonlySet<number> | null,
) {
  return (
    (searchMatches === null || searchMatches.has(asset.itemId)) &&
    includesOrEmpty(filters.typeIds, asset.typeId) &&
    includesNullableOrEmpty(filters.groupIds, asset.groupId) &&
    includesNullableOrEmpty(filters.categoryIds, asset.categoryId) &&
    includesOrEmpty(filters.locationKeys, group.key) &&
    (filters.locationTypes.length === 0 ||
      (group.locationType !== null && filters.locationTypes.includes(group.locationType))) &&
    includesOrEmpty(filters.flags, asset.locationFlag) &&
    (filters.singleton === 'all' || asset.isSingleton === (filters.singleton === 'yes')) &&
    matchesBlueprint(filters.blueprint, asset)
  )
}

function fuzzySearchMatches(groups: readonly AssetLocationGroup[], terms: readonly string[]) {
  let index = searchIndexByHierarchy.get(groups)
  if (!index) {
    const documents = groups.flatMap((group) =>
      flattenRows(group.rows).map(({ row }) => ({
        itemId: row.asset.itemId,
        text: searchableAssetText(row.asset, group),
      })),
    )
    index = new Fuse(documents, {
      keys: ['text'],
      threshold: 0.35,
      ignoreLocation: true,
      minMatchCharLength: 1,
    })
    searchIndexByHierarchy.set(groups, index)
  }

  let matches: Set<number> | null = null
  for (const term of terms) {
    const hits = searchTermMatches(groups, index, term)
    if (matches === null) matches = hits
    else {
      const previous: Set<number> = matches
      matches = new Set([...previous].filter((itemId) => hits.has(itemId)))
    }
    if (matches.size === 0) break
  }
  return matches ?? new Set<number>()
}

function searchTermMatches(
  groups: readonly AssetLocationGroup[],
  index: Fuse<AssetSearchDocument>,
  term: string,
) {
  if (skinSearchTerms.has(term)) return skinAssetMatches(groups)
  return textAssetMatches(groups, index, term)
}

function textAssetMatches(
  groups: readonly AssetLocationGroup[],
  index: Fuse<AssetSearchDocument>,
  term: string,
) {
  const matches = new Set(index.search(term).map(({ item }) => item.itemId))
  for (const group of groups) {
    for (const { row } of flattenRows(group.rows)) {
      if (searchableAssetText(row.asset, group).includes(term)) matches.add(row.asset.itemId)
    }
  }
  return matches
}

function skinAssetMatches(groups: readonly AssetLocationGroup[]) {
  return new Set(
    groups.flatMap((group) =>
      flattenRows(group.rows).flatMap(({ row }) =>
        isSkinAsset(row.asset) ? [row.asset.itemId] : [],
      ),
    ),
  )
}

function searchableAssetText(asset: AssetRecord, group: AssetLocationGroup) {
  const cachedByLocation = searchableTextByAsset.get(asset) ?? new Map<string, string>()
  const cached = cachedByLocation.get(group.key)
  if (cached !== undefined) return cached

  const searchable = normalizeAssetSearch(
    [
      asset.typeName,
      asset.typeId,
      asset.customName,
      group.label,
      group.locationId,
      asset.groupName,
      asset.groupId,
      asset.categoryName,
      asset.categoryId,
      asset.locationFlag,
      asset.isSingleton ? 'singleton' : 'stack',
      blueprintSearchText(asset),
    ]
      .filter((value) => value !== null)
      .join(' '),
  )
  cachedByLocation.set(group.key, searchable)
  searchableTextByAsset.set(asset, cachedByLocation)
  return searchable
}

// Only a blueprint may contribute blueprint terms; ESI leaves is_blueprint_copy unset on nearly
// every asset, so indexing it unconditionally made "blueprint" match the whole inventory.
function blueprintSearchText(asset: AssetRecord) {
  if (!isBlueprintAsset(asset)) return null
  return asset.isBlueprintCopy === true ? 'blueprint copy bpc' : 'blueprint original bpo'
}

function matchesBlueprint(filter: AssetBlueprintFilter, asset: AssetRecord) {
  if (filter === 'all') return true
  if (filter === 'copy') return asset.isBlueprintCopy === true
  if (filter === 'original') return isBlueprintAsset(asset) && asset.isBlueprintCopy !== true
  return !isBlueprintAsset(asset)
}

function includesOrEmpty<T>(values: readonly T[], value: T) {
  return values.length === 0 || values.includes(value)
}

function includesNullableOrEmpty(values: readonly number[], value: number | null) {
  return values.length === 0 || (value !== null && values.includes(value))
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, 'en')
}

function flattenRows(rows: readonly AssetHierarchyRow[]) {
  const flattened: FlattenedAssetRow[] = []
  const pending: FlattenedAssetRow[] = rows.toReversed().map((row) => ({ row, parentId: null }))
  while (pending.length > 0) {
    const current = pending.pop()!
    flattened.push(current)
    for (let index = current.row.children.length - 1; index >= 0; index -= 1) {
      pending.push({
        row: current.row.children[index]!,
        parentId: current.row.asset.itemId,
      })
    }
  }
  return flattened
}

function cloneIncludedRows(rows: readonly FlattenedAssetRow[], included: ReadonlySet<number>) {
  const clones = cloneIncludedRowsById(rows, included)
  return assembleClonedRows(rows, clones)
}

function cloneIncludedRowsById(rows: readonly FlattenedAssetRow[], included: ReadonlySet<number>) {
  const clones = new Map<number, AssetHierarchyRow>()
  for (const { row } of rows) {
    if (!included.has(row.asset.itemId)) continue
    clones.set(row.asset.itemId, { ...row, children: [] })
  }
  return clones
}

function assembleClonedRows(
  rows: readonly FlattenedAssetRow[],
  clones: ReadonlyMap<number, AssetHierarchyRow>,
) {
  const roots: AssetHierarchyRow[] = []
  for (const { row, parentId } of rows) {
    const clone = clones.get(row.asset.itemId)
    if (!clone) continue
    const parent = parentId === null ? undefined : clones.get(parentId)
    if (!parent) {
      roots.push(clone)
      continue
    }
    parent.children.push(clone)
  }
  return roots
}
