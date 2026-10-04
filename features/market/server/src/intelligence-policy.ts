import type { PlatformPublicRouteCapabilities } from '@eve-space/platform-module-contract/server'
import { z } from 'zod'
import { globalPlexMarketRegionId, plexMarketTypeId } from './market-bounds.js'
import type { MarketPublicProfileInput } from './profiles.js'

export const marketIntelligenceBounds = {
  maximumIgnoredGroups: 256,
  maximumGroups: 4_000,
  maximumTypes: 32_000,
  maximumStagingTypes: 1_000,
  maximumDerivationTypes: 100,
  maximumDerivationPages: 64,
  minimumGenerationIntervalMs: 300_000,
  retainedHistoryDays: 365,
} as const

const defaultMarketIntelligenceIgnoredGroupIds = [
  150, 1954, 3630, 204, 209, 1041, 1338, 2157, 2158, 1663, 20, 22, 23, 2801, 1846, 492, 614, 751,
  754, 1109, 2480, 1396,
] as const

type CatalogueResult = Awaited<
  ReturnType<
    PlatformPublicRouteCapabilities<readonly ['market-catalogue']>['coreData']['marketCatalogue']
  >
>
type CatalogueTree = Extract<CatalogueResult, { kind: 'tree' }>
type CatalogueIndex = Extract<CatalogueResult, { kind: 'search-index' }>
type CatalogueGroup = CatalogueTree['groups'][number]
type ProfileScope = Pick<MarketPublicProfileInput, 'mode' | 'regionId' | 'watchedTypeIds'>

export interface MarketIntelligencePolicyInput {
  readonly enabled: boolean
  readonly ignoredGroupIds: readonly number[]
}

export interface MarketIntelligenceTarget {
  readonly typeId: number
  readonly groupId: number
  readonly name: string
  readonly groupIds: readonly number[]
}

export interface MarketIntelligenceUniverse {
  readonly revision: CatalogueTree['revision']
  readonly excludedGroupIds: readonly number[]
  readonly excludedTypeCount: number
  readonly ignoredTypeIds: readonly number[]
  readonly targets: readonly MarketIntelligenceTarget[]
  readonly excludedTargets: readonly MarketIntelligenceTarget[]
}

export const defaultMarketIntelligencePolicy = (): MarketIntelligencePolicyInput => ({
  enabled: false,
  ignoredGroupIds: [...defaultMarketIntelligenceIgnoredGroupIds],
})

const positiveId = (id: number) => Number.isSafeInteger(id) && id > 0

const catalogueGroups = (tree: CatalogueTree) => {
  if (tree.complete !== true || tree.groups.length > marketIntelligenceBounds.maximumGroups) {
    throw new RangeError('Market intelligence requires a complete bounded group tree')
  }
  const groups = new Map<number, CatalogueGroup>()
  for (const group of tree.groups) {
    if (!positiveId(group.id) || groups.has(group.id)) {
      throw new TypeError('Market catalogue has invalid or duplicate group IDs')
    }
    groups.set(group.id, group)
  }
  return groups
}

const groupAncestors = (id: number, groups: ReadonlyMap<number, CatalogueGroup>) => {
  const ancestors: number[] = []
  const visited = new Set<number>()
  let current: number | null = id
  while (current !== null) {
    const group = groups.get(current)
    if (!group || visited.has(current)) {
      throw new TypeError('Market catalogue group hierarchy is incomplete or cyclic')
    }
    visited.add(current)
    ancestors.push(current)
    current = group.parentId
  }
  return ancestors
}

const ignoredGroups = (ids: readonly number[], groups: ReadonlyMap<number, CatalogueGroup>) => {
  if (ids.length > marketIntelligenceBounds.maximumIgnoredGroups) {
    throw new RangeError('Market intelligence policy exceeds its ignored-group bound')
  }
  const ignored = new Set(ids)
  if (ignored.size !== ids.length) throw new TypeError('Ignored Market groups cannot repeat an ID')
  for (const id of ignored) {
    if (!positiveId(id) || !groups.has(id)) throw new TypeError('Unknown ignored Market group')
  }
  return ignored
}

export const validateMarketIntelligencePolicy = (
  input: MarketIntelligencePolicyInput,
  profile: Pick<MarketPublicProfileInput, 'enabled' | 'mode' | 'regionId'>,
  tree: CatalogueTree,
): MarketIntelligencePolicyInput => {
  if (
    input.enabled &&
    (!profile.enabled || profile.mode !== 'region' || profile.regionId === globalPlexMarketRegionId)
  ) {
    throw new TypeError('Broad Market intelligence requires an enabled full-region profile')
  }
  if (!z.boolean().safeParse(input.enabled).success)
    throw new TypeError('Market intelligence enabled must be a boolean')
  const groups = catalogueGroups(tree)
  const ignored = ignoredGroups(input.ignoredGroupIds, groups)
  for (const group of groups.values()) groupAncestors(group.id, groups)
  return {
    enabled: input.enabled,
    ignoredGroupIds: [...ignored].toSorted((left, right) => left - right),
  }
}

const assertMatchingCatalogue = (tree: CatalogueTree, index: CatalogueIndex) => {
  const left = tree.revision
  const right = index.revision
  if (
    left.buildNumber !== right.buildNumber ||
    left.ingestVersion !== right.ingestVersion ||
    left.ingestedAt !== right.ingestedAt
  ) {
    throw new TypeError('Market intelligence catalogue revisions do not match')
  }
  if (index.complete !== true || index.types.length > marketIntelligenceBounds.maximumTypes) {
    throw new RangeError('Market intelligence requires a complete bounded type index')
  }
}

const catalogueTargets = (
  index: CatalogueIndex,
  ancestors: ReadonlyMap<number, readonly number[]>,
  excluded: ReadonlySet<number>,
  profile: ProfileScope,
) => {
  const watched = profile.mode === 'watched-types' ? new Set(profile.watchedTypeIds) : null
  const seen = new Set<number>()
  const targets: MarketIntelligenceTarget[] = []
  const excludedTargets: MarketIntelligenceTarget[] = []
  for (const type of index.types) {
    const groupIds = ancestors.get(type.groupId)
    if (
      !positiveId(type.id) ||
      seen.has(type.id) ||
      !groupIds ||
      !type.name ||
      type.name.length > 500
    ) {
      throw new TypeError('Market catalogue has invalid or duplicate types')
    }
    seen.add(type.id)
    if (watched && !watched.has(type.id)) continue
    if (excluded.has(type.groupId)) {
      excludedTargets.push({ typeId: type.id, groupId: type.groupId, name: type.name, groupIds })
      continue
    }
    if ((type.id === plexMarketTypeId) !== (profile.regionId === globalPlexMarketRegionId)) continue
    targets.push({ typeId: type.id, groupId: type.groupId, name: type.name, groupIds })
  }
  const sortedExcludedTargets = excludedTargets.toSorted(
    (left, right) => left.typeId - right.typeId,
  )
  return {
    excludedTypeCount: sortedExcludedTargets.length,
    ignoredTypeIds: sortedExcludedTargets.map(({ typeId }) => typeId),
    targets: targets.toSorted((left, right) => left.typeId - right.typeId),
    excludedTargets: sortedExcludedTargets,
  }
}

export const buildMarketIntelligenceUniverse = (
  tree: CatalogueTree,
  index: CatalogueIndex,
  policy: MarketIntelligencePolicyInput,
  profile: ProfileScope,
): MarketIntelligenceUniverse => {
  assertMatchingCatalogue(tree, index)
  const groups = catalogueGroups(tree)
  const ignored = ignoredGroups(policy.ignoredGroupIds, groups)
  const ancestors = new Map([...groups.keys()].map((id) => [id, groupAncestors(id, groups)]))
  const excluded = new Set(
    [...ancestors].filter(([, ids]) => ids.some((id) => ignored.has(id))).map(([id]) => id),
  )
  return {
    revision: { ...tree.revision },
    excludedGroupIds: [...excluded].toSorted((left, right) => left - right),
    ...catalogueTargets(index, ancestors, excluded, profile),
  }
}
