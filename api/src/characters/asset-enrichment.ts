import {
  projectAsset,
  type AssetSnapshot,
  type AssetTypeProjection,
  type AssetLocationProjection,
} from '@eve-space/core-eve-projections/assets'
import { eq, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { sdeCategories, sdeGroups, sdeTypes } from '../db/schema.js'
import { resolveUniverseNamesBestEffort, type UniverseName } from '../universe/names.js'
import { getStaticLocations, type StaticLocationRequest } from '../universe/static-locations.js'
import { loadCharacterAssetNameBatch, normalizeCharacterAssetNameBatch } from './asset-pages.js'
import { mapAssetBatchesSettled } from './asset-batches.js'
import { immediateAssetWork, type CharacterAssetWindowWork } from './asset-work.js'

const characterAssetNameBatchSize = 1000

type EnrichmentStatus = 'complete' | 'partial' | 'unavailable'
type CharacterAssetSnapshot = AssetSnapshot
type CharacterAssetTypeData = AssetTypeProjection
type CharacterAssetLocationData = AssetLocationProjection
type AssetLocationKinds = Map<number, Set<StaticLocationRequest['type']>>
type StaticAssetLocation = Awaited<ReturnType<typeof getStaticLocations>>[number]
type CharacterAssetNameSnapshot = Awaited<ReturnType<typeof loadCharacterAssetNameBatch>>[number]

const enrichmentStatus = (complete: boolean, partial: boolean): EnrichmentStatus => {
  if (complete) {
    return 'complete'
  }
  if (partial) {
    return 'partial'
  }
  return 'unavailable'
}

const loadAssetTypes = async (
  assets: readonly CharacterAssetSnapshot[],
  work: CharacterAssetWindowWork,
) => {
  work.signal.throwIfAborted()
  const typeIds = [...new Set(assets.map((asset) => asset.typeId))].toSorted(
    (left, right) => left - right,
  )
  if (typeIds.length === 0) {
    return { status: 'complete' as const, values: new Map<number, CharacterAssetTypeData>() }
  }

  try {
    const rows = await work.run(() =>
      db
        .select({
          categoryId: sdeCategories.categoryId,
          categoryName: sdeCategories.name,
          groupId: sdeTypes.groupId,
          groupName: sdeGroups.name,
          typeId: sdeTypes.typeId,
          typeName: sdeTypes.name,
          unitVolume: sdeTypes.volume,
        })
        .from(sdeTypes)
        .leftJoin(sdeGroups, eq(sdeGroups.groupId, sdeTypes.groupId))
        .leftJoin(sdeCategories, eq(sdeCategories.categoryId, sdeGroups.categoryId))
        .where(inArray(sdeTypes.typeId, typeIds))
        .limit(typeIds.length),
    )
    work.signal.throwIfAborted()
    const values = new Map<number, CharacterAssetTypeData>()
    for (const row of rows) {
      values.set(row.typeId, {
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        groupId: row.groupId,
        groupName: row.groupName,
        typeName: row.typeName,
        unitVolume:
          row.unitVolume !== null && Number.isFinite(row.unitVolume) && row.unitVolume >= 0
            ? row.unitVolume
            : null,
      })
    }
    const complete =
      values.size === typeIds.length &&
      [...values.values()].every(
        (value) =>
          value.groupId !== null &&
          value.groupName !== null &&
          value.categoryId !== null &&
          value.categoryName !== null,
      )
    return { status: complete ? ('complete' as const) : ('partial' as const), values }
  } catch {
    work.signal.throwIfAborted()
    return { status: 'unavailable' as const, values: new Map<number, CharacterAssetTypeData>() }
  }
}

const collectAssetNames = (
  candidates: readonly number[],
  results: readonly PromiseSettledResult<CharacterAssetNameSnapshot[]>[],
) => {
  const values = new Map<number, string>()
  const candidateSet = new Set(candidates)
  let successfulBatches = 0
  for (const result of results) {
    if (result.status === 'rejected') continue
    successfulBatches += 1
    for (const entry of result.value) {
      if (candidateSet.has(entry.itemId) && !values.has(entry.itemId))
        values.set(entry.itemId, entry.name)
    }
  }
  return { values, successfulBatches }
}

const loadAssetNames = async (
  characterId: number,
  subjectLifecycleId: string,
  assets: readonly CharacterAssetSnapshot[],
  work: CharacterAssetWindowWork,
) => {
  work.signal.throwIfAborted()
  const candidates = [
    ...new Set(assets.filter((asset) => asset.isSingleton).map((asset) => asset.itemId)),
  ].toSorted((left, right) => left - right)
  if (candidates.length === 0) {
    return { status: 'complete' as const, values: new Map<number, string>() }
  }

  const batches = Array.from(
    { length: Math.ceil(candidates.length / characterAssetNameBatchSize) },
    (_, index) =>
      normalizeCharacterAssetNameBatch(
        candidates.slice(
          index * characterAssetNameBatchSize,
          (index + 1) * characterAssetNameBatchSize,
        ),
      ),
  )
  const results = await mapAssetBatchesSettled(batches, (itemIds) =>
    work.run(() =>
      loadCharacterAssetNameBatch(characterId, subjectLifecycleId, itemIds, work.signal),
    ),
  )
  work.signal.throwIfAborted()
  const { values, successfulBatches } = collectAssetNames(candidates, results)
  return {
    status: enrichmentStatus(
      successfulBatches === batches.length && values.size === candidates.length,
      successfulBatches > 0,
    ),
    values,
  }
}

const assetLocationKinds = (assets: readonly CharacterAssetSnapshot[]): AssetLocationKinds => {
  const expected: AssetLocationKinds = new Map()
  for (const asset of assets) {
    if (asset.locationType !== 'station' && asset.locationType !== 'solar_system') {
      continue
    }
    const types = expected.get(asset.locationId) ?? new Set<StaticLocationRequest['type']>()
    types.add(asset.locationType)
    expected.set(asset.locationId, types)
  }
  return expected
}

const projectAssetLocation = (
  location: StaticLocationRequest,
  resolvedName: UniverseName | undefined,
  detail: StaticAssetLocation | undefined,
): CharacterAssetLocationData => {
  const matchedDetail = detail?.type === location.type ? detail : undefined
  const securityStatus = matchedDetail?.solarSystemSecurityStatus
  return {
    name:
      (resolvedName?.category === location.type ? resolvedName.name : null) ??
      matchedDetail?.name ??
      null,
    solarSystemId: matchedDetail?.solarSystemId ?? null,
    solarSystemSecurityStatus:
      securityStatus != null && Number.isFinite(securityStatus) ? securityStatus : null,
  }
}

const completeAssetLocation = (value: CharacterAssetLocationData) =>
  value.name !== null && value.solarSystemId !== null && value.solarSystemSecurityStatus !== null
const usableAssetLocation = (value: CharacterAssetLocationData) =>
  value.name !== null || value.solarSystemId !== null || value.solarSystemSecurityStatus !== null

const loadAssetLocations = async (
  assets: readonly CharacterAssetSnapshot[],
  work: CharacterAssetWindowWork,
) => {
  work.signal.throwIfAborted()
  const expected = assetLocationKinds(assets)
  if (expected.size === 0) {
    return {
      status: 'complete' as const,
      values: new Map<number, CharacterAssetLocationData>(),
    }
  }

  const locations = [...expected]
    .filter(([, types]) => types.size === 1)
    .map(([id, types]) => ({ id, type: [...types][0]! }))
  const ids = [...expected.keys()].toSorted((left, right) => left - right)
  const [names, details] = await Promise.all([
    resolveUniverseNamesBestEffort(ids, { signal: work.signal, work }).catch(() => ({
      complete: false,
      names: new Map<number, UniverseName>(),
    })),
    work.run(() => getStaticLocations(locations, { signal: work.signal })).catch(() => []),
  ])
  work.signal.throwIfAborted()
  const staticLocations = new Map(details.map((location) => [location.id, location]))

  const values = new Map<number, CharacterAssetLocationData>()
  for (const location of locations) {
    values.set(
      location.id,
      projectAssetLocation(
        location,
        names.names.get(location.id),
        staticLocations.get(location.id),
      ),
    )
  }

  const complete =
    values.size === expected.size && [...values.values()].every(completeAssetLocation)
  const usable = [...values.values()].some(usableAssetLocation)
  return { status: enrichmentStatus(complete, usable), values }
}

export const enrichCharacterAssetWindow = async (
  characterId: number,
  subjectLifecycleId: string,
  assets: readonly CharacterAssetSnapshot[],
  work: CharacterAssetWindowWork = immediateAssetWork(),
) => {
  work.signal.throwIfAborted()
  const [types, names, locations] = await Promise.all([
    loadAssetTypes(assets, work),
    loadAssetNames(characterId, subjectLifecycleId, assets, work),
    loadAssetLocations(assets, work),
  ])
  work.signal.throwIfAborted()
  return {
    assets: assets.map((asset) =>
      projectAsset(
        asset,
        types.values.get(asset.typeId),
        names.values.get(asset.itemId),
        locations.values.get(asset.locationId),
      ),
    ),
    enrichment: { types: types.status, names: names.status, locations: locations.status },
  }
}
