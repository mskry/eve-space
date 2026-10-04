import {
  excludeInventoryConflicts,
  sumInventoryQuantities,
  type NormalizedInventoryItem,
} from '@eve-space/core-eve-projections/asset-inventory'
import {
  emptyInventoryCoverageCounts,
  type PlatformInventoryCoverage,
  type PlatformInventoryCoverageState,
  type PlatformInventoryFilters,
  type PlatformInventoryGroup,
  type PlatformInventoryHolder,
} from '@eve-space/platform-module-contract/inventory'
import type { PersonalInventoryBinding } from '../auth/inventory-admission.js'
import { inventoryFingerprint, inventoryGroupMatchesFilters } from '../inventory-policy.js'
import type { InventoryEnrichment } from './inventory-enrichment.js'
import {
  assertPersonalInventorySourceCurrent,
  InventorySourceRestartError,
  type PersonalInventorySource,
} from './inventory-source.js'

export interface PersonalInventoryReduction {
  readonly scope: 'personal'
  readonly fingerprint: string
  readonly traversalComplete: true
  readonly sourcesComplete: boolean
  readonly expectedSubjects: number
  readonly coverageCounts: Readonly<Record<PlatformInventoryCoverageState, number>>
  readonly groups: readonly PlatformInventoryGroup[]
  readonly holders: readonly PlatformInventoryHolder[]
  readonly coverage: readonly PlatformInventoryCoverage[]
}

const groupForItem = (
  item: NormalizedInventoryItem,
  enrichment: InventoryEnrichment,
): PlatformInventoryGroup => {
  const type = enrichment.types.get(item.typeId)
  const blueprint =
    item.blueprint === 'none' && type?.categoryId === 9 ? 'original' : item.blueprint
  return {
    key: JSON.stringify([item.typeId, blueprint, item.root.key]),
    typeId: item.typeId,
    typeName: type?.typeName ?? `Unknown type ${item.typeId}`,
    groupId: type?.groupId ?? null,
    categoryId: type?.categoryId ?? null,
    blueprint,
    location: enrichment.locations.get(item.root.key) ?? {
      key: item.root.key,
      id: item.root.id?.toString() ?? null,
      name: null,
      state: item.root.state === 'known' ? 'unknown' : item.root.state,
    },
    currentQuantity: '0',
    staleQuantity: '0',
  }
}

const addQuantity = <
  Row extends { readonly currentQuantity: `${bigint}`; readonly staleQuantity: `${bigint}` },
>(
  row: Row,
  item: NormalizedInventoryItem,
  stale: boolean,
): Row => {
  const field = stale ? 'staleQuantity' : 'currentQuantity'
  return { ...row, [field]: sumInventoryQuantities([row[field], item.quantity]) }
}

const verifySources = (
  binding: PersonalInventoryBinding,
  sources: readonly PersonalInventorySource[],
) => {
  const expected = binding.evidenceSubjects.map((subject) => subject.characterId)
  const actual = sources.map((source) => source.characterId)
  if (
    new Set(actual).size !== actual.length ||
    actual.length !== expected.length ||
    actual.some((id) => !expected.includes(id))
  )
    throw new InventorySourceRestartError()
  if (sources.some((value) => value.source === null && value.items.length > 0))
    throw new InventorySourceRestartError()
  if (
    sources.some(
      (value) =>
        value.items.length > 0 &&
        value.state !== 'included-current' &&
        value.state !== 'included-stale',
    )
  )
    throw new InventorySourceRestartError()
  assertPersonalInventorySourceCurrent(sources)
}

const reduceGroups = (
  binding: PersonalInventoryBinding,
  sources: ReadonlyMap<number, PersonalInventorySource>,
  observations: ReturnType<typeof excludeInventoryConflicts>['observations'],
  enrichment: InventoryEnrichment,
) => {
  const groups = new Map<string, PlatformInventoryGroup>()
  const holders = new Map<string, PlatformInventoryHolder>()
  const subjects = new Map(
    binding.evidenceSubjects.map((subject) => [subject.characterId, subject]),
  )
  for (const observation of observations) {
    const source = sources.get(observation.characterId)!
    const subject = subjects.get(observation.characterId)!
    if (!source.source) continue
    for (const item of observation.items) {
      const group = groupForItem(item, enrichment)
      const holderKey = JSON.stringify([group.key, subject.characterId])
      const stale = source.state === 'included-stale'
      groups.set(group.key, addQuantity(groups.get(group.key) ?? group, item, stale))
      const holder = holders.get(holderKey) ?? {
        characterId: subject.characterId,
        userId: subject.userId,
        characterName: subject.characterName,
        groupKey: group.key,
        currentQuantity: '0',
        staleQuantity: '0',
        source: source.source,
      }
      holders.set(holderKey, addQuantity(holder, item, stale))
    }
  }
  return { groups: [...groups.values()], holders: [...holders.values()] }
}

export const reducePersonalInventory = (
  binding: PersonalInventoryBinding,
  sources: readonly PersonalInventorySource[],
  enrichment: InventoryEnrichment,
  filters: PlatformInventoryFilters = {},
): PersonalInventoryReduction => {
  verifySources(binding, sources)
  const clean = excludeInventoryConflicts(
    sources.map((source) => ({ characterId: source.characterId, items: source.items })),
  )
  const byCharacter = new Map(sources.map((source) => [source.characterId, source]))
  const reduced = reduceGroups(binding, byCharacter, clean.observations, enrichment)
  const groups = reduced.groups
    .filter((group) => inventoryGroupMatchesFilters(group, filters))
    .toSorted(
      (left, right) =>
        left.typeId - right.typeId ||
        left.blueprint.localeCompare(right.blueprint) ||
        left.location.key.localeCompare(right.location.key),
    )
  const groupKeys = new Set(groups.map((group) => group.key))
  const holders = reduced.holders
    .filter((holder) => groupKeys.has(holder.groupKey))
    .toSorted(
      (left, right) =>
        left.groupKey.localeCompare(right.groupKey) || left.characterId - right.characterId,
    )
  const coverage: PlatformInventoryCoverage[] = binding.subjects.map((subject) => {
    const source = byCharacter.get(subject.characterId)
    const state = clean.conflictingCharacters.has(subject.characterId)
      ? 'conflicting-source'
      : (subject.coverage ?? source?.state ?? 'unavailable')
    return {
      characterId: subject.characterId,
      characterName: subject.characterName,
      state,
      source: source?.source ?? null,
    }
  })
  const coverageCounts = emptyInventoryCoverageCounts()
  for (const row of coverage) coverageCounts[row.state] += 1
  return {
    scope: 'personal',
    fingerprint: inventoryFingerprint({
      authority: binding.fingerprint,
      sources,
      enrichment: {
        types: [...enrichment.types].toSorted(([left], [right]) => left - right),
        locations: [...enrichment.locations].toSorted(([left], [right]) =>
          left.localeCompare(right),
        ),
      },
    }),
    traversalComplete: true,
    sourcesComplete: coverage.every(
      (row) => row.state === 'included-current' || row.state === 'included-stale',
    ),
    expectedSubjects: binding.subjects.length,
    coverageCounts,
    groups,
    holders,
    coverage,
  }
}
