import { createAssetsClient } from '@evespace/esi-client/domains/assets'
import type {
  GetCharactersCharacterIdAssetsOutput,
  PostCharactersCharacterIdAssetsNamesOutput,
} from '@evespace/esi-client/schemas'
import { eq, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { sdeCategories, sdeGroups, sdeTypes } from '../db/schema.js'
import { getCharacterEsiScope } from '../esi-resilience/catalog.js'
import { combineEsiResultMetadata, toEsiResultMetadata } from '../esi-resilience/public-metadata.js'
import { getEsiResilienceLayer } from '../esi-resilience/resilience.js'
import { createEsiTransport } from '../esi-resilience/transport.js'
import type { EsiCachedResult, EsiResultMetadata } from '../esi-resilience/types.js'
import { resolveUniverseNamesBestEffort, type UniverseName } from '../universe/names.js'

export const characterAssetsScope = getCharacterEsiScope('character-assets-page')
// A sanity bound on the advertised page count, not a product limit: the fan-out allocates an array
// of page numbers, so a corrupt X-Pages must not reach it. 1,000 pages is ~1,000,000 assets.
export const maximumCharacterAssetPages = 1_000
export const characterAssetNameBatchSize = 1_000
export const characterAssetWorkerConcurrency = 4

type AssetLocationType = 'station' | 'solar_system' | 'item' | 'other'
type EnrichmentStatus = 'complete' | 'partial' | 'unavailable'
type EsiAsset = GetCharactersCharacterIdAssetsOutput[number]

interface CharacterAssetSnapshot {
  itemId: number
  typeId: number
  quantity: number
  isSingleton: boolean
  isBlueprintCopy: boolean | null
  locationId: number
  locationType: AssetLocationType
  locationFlag: string
  parentItemId: number | null
}

interface CharacterAssetPageSnapshot {
  page: number
  totalPages: number
  assets: CharacterAssetSnapshot[]
}

interface CharacterAssetTypeData {
  typeName: string
  groupId: number | null
  groupName: string | null
  categoryId: number | null
  categoryName: string | null
  unitVolume: number | null
}

export interface CharacterAssetDto extends CharacterAssetSnapshot, CharacterAssetTypeData {
  totalVolume: number | null
  customName: string | null
  locationName: string | null
}

export interface CharacterAssetsResult extends EsiResultMetadata {
  characterId: number
  assets: CharacterAssetDto[]
  enrichment: {
    types: EnrichmentStatus
    names: EnrichmentStatus
    locations: EnrichmentStatus
  }
  retryAt?: string
}

export class CharacterAssetsPaginationError extends Error {
  constructor() {
    super('ESI returned invalid character asset pagination metadata')
    this.name = 'CharacterAssetsPaginationError'
  }
}

export async function getCharacterAssets(characterId: number): Promise<CharacterAssetsResult> {
  const firstPage = await loadCharacterAssetPage(characterId, 1)
  const pageNumbers = Array.from({ length: firstPage.data.totalPages - 1 }, (_, index) => index + 2)
  const remainingPages = await mapBounded(pageNumbers, (page) =>
    loadCharacterAssetPage(characterId, page),
  )
  const pages = [firstPage, ...remainingPages]
  if (pages.some((page) => page.data.totalPages !== firstPage.data.totalPages))
    throw new CharacterAssetsPaginationError()

  const assets = deduplicateAssets(pages)
  const [types, names, locations] = await Promise.all([
    loadAssetTypes(assets),
    loadAssetNames(characterId, assets),
    loadAssetLocations(assets),
  ])
  const metadata = combineEsiResultMetadata(pages.map(toEsiResultMetadata))
  const retryAt =
    metadata.refreshFailureClass === 'esi-cooldown'
      ? pages
          .flatMap((page) =>
            page.refreshFailureClass === 'esi-cooldown' && page.retryAt ? [page.retryAt] : [],
          )
          .toSorted((left, right) => left.localeCompare(right, 'en'))
          .at(-1)
      : undefined
  const enrichedAssets: CharacterAssetDto[] = []
  for (const asset of assets) {
    const type = types.values.get(asset.typeId) ?? unknownType(asset.typeId)
    const location = locations.values.get(asset.locationId)
    const locationName =
      location?.category === asset.locationType &&
      (asset.locationType === 'station' || asset.locationType === 'solar_system')
        ? location.name
        : null
    enrichedAssets.push({
      ...asset,
      ...type,
      totalVolume: totalVolume(type.unitVolume, asset.quantity),
      customName: names.values.get(asset.itemId) ?? null,
      locationName,
    })
  }

  return {
    characterId,
    assets: enrichedAssets,
    enrichment: {
      types: types.status,
      names: names.status,
      locations: locations.status,
    },
    ...metadata,
    ...(retryAt ? { retryAt } : {}),
  }
}

async function loadCharacterAssetPage(characterId: number, page: number) {
  return getEsiResilienceLayer().getCharacter<CharacterAssetPageSnapshot>({
    operation: 'character-assets-page',
    inputs: { characterId, page },
    load: async (authority, revalidation) => {
      const response = await createAssetsClient({
        fetch: createEsiTransport('character-assets-page', authority.principal),
        token: authority.accessToken,
      })
        .withMetadata()
        .listCharacterAssets(characterId, { page, ...revalidation })
      return {
        data: {
          page,
          totalPages: validatePageCount(response.meta.pagination?.pages),
          assets: response.data.map(mapAssetSnapshot),
        },
        meta: response.meta,
      }
    },
  })
}

function validatePageCount(value: unknown) {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) <= 0 ||
    Number(value) > maximumCharacterAssetPages
  )
    throw new CharacterAssetsPaginationError()
  return Number(value)
}

function mapAssetSnapshot(asset: EsiAsset): CharacterAssetSnapshot {
  return {
    itemId: asset.item_id,
    typeId: asset.type_id,
    quantity: asset.quantity,
    isSingleton: asset.is_singleton,
    isBlueprintCopy: asset.is_blueprint_copy ?? null,
    locationId: asset.location_id,
    locationType: asset.location_type,
    locationFlag: asset.location_flag,
    parentItemId: asset.location_type === 'item' ? asset.location_id : null,
  }
}

function deduplicateAssets(pages: readonly EsiCachedResult<CharacterAssetPageSnapshot>[]) {
  const assets = new Map<number, CharacterAssetSnapshot>()
  for (const page of pages)
    for (const asset of page.data.assets)
      if (!assets.has(asset.itemId)) assets.set(asset.itemId, asset)
  return [...assets.values()]
}

async function loadAssetTypes(assets: readonly CharacterAssetSnapshot[]) {
  const typeIds = [...new Set(assets.map((asset) => asset.typeId))].toSorted(
    (left, right) => left - right,
  )
  if (typeIds.length === 0)
    return { values: new Map<number, CharacterAssetTypeData>(), status: 'complete' as const }

  try {
    const rows = await db
      .select({
        typeId: sdeTypes.typeId,
        typeName: sdeTypes.name,
        groupId: sdeTypes.groupId,
        groupName: sdeGroups.name,
        categoryId: sdeCategories.categoryId,
        categoryName: sdeCategories.name,
        unitVolume: sdeTypes.volume,
      })
      .from(sdeTypes)
      .leftJoin(sdeGroups, eq(sdeGroups.groupId, sdeTypes.groupId))
      .leftJoin(sdeCategories, eq(sdeCategories.categoryId, sdeGroups.categoryId))
      .where(inArray(sdeTypes.typeId, typeIds))
      .limit(typeIds.length)
    const values = new Map<number, CharacterAssetTypeData>()
    for (const row of rows)
      values.set(row.typeId, {
        typeName: row.typeName,
        groupId: row.groupId,
        groupName: row.groupName,
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        unitVolume:
          row.unitVolume !== null && Number.isFinite(row.unitVolume) && row.unitVolume >= 0
            ? row.unitVolume
            : null,
      })
    const complete =
      values.size === typeIds.length &&
      [...values.values()].every(
        (value) =>
          value.groupId !== null &&
          value.groupName !== null &&
          value.categoryId !== null &&
          value.categoryName !== null,
      )
    return { values, status: complete ? ('complete' as const) : ('partial' as const) }
  } catch {
    return { values: new Map<number, CharacterAssetTypeData>(), status: 'unavailable' as const }
  }
}

async function loadAssetNames(characterId: number, assets: readonly CharacterAssetSnapshot[]) {
  const candidates = [
    ...new Set(assets.filter((asset) => asset.isSingleton).map((asset) => asset.itemId)),
  ].toSorted((left, right) => left - right)
  if (candidates.length === 0)
    return { values: new Map<number, string>(), status: 'complete' as const }

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
  const results = await mapBoundedSettled(batches, (itemIds) =>
    loadCharacterAssetNameBatch(characterId, itemIds),
  )
  const values = new Map<number, string>()
  const candidateSet = new Set(candidates)
  let successfulBatches = 0
  for (const result of results) {
    if (result.status === 'rejected') continue
    successfulBatches += 1
    for (const entry of result.value)
      if (candidateSet.has(entry.item_id) && !values.has(entry.item_id))
        values.set(entry.item_id, entry.name)
  }
  return {
    values,
    status: enrichmentStatus(
      successfulBatches === batches.length && values.size === candidates.length,
      successfulBatches > 0,
    ),
  }
}

function loadCharacterAssetNameBatch(characterId: number, itemIds: readonly number[]) {
  const normalizedItemIds = normalizeCharacterAssetNameBatch(itemIds)
  return getEsiResilienceLayer()
    .getCharacter<PostCharactersCharacterIdAssetsNamesOutput>({
      operation: 'character-asset-names',
      inputs: { characterId, itemIds: normalizedItemIds },
      load: (authority, revalidation) =>
        createAssetsClient({
          fetch: createEsiTransport('character-asset-names', authority.principal),
          token: authority.accessToken,
        })
          .withMetadata()
          .lookupCharacterNames(characterId, { body: normalizedItemIds, ...revalidation }),
    })
    .then((result) => result.data)
}

export function normalizeCharacterAssetNameBatch(itemIds: readonly number[]) {
  if (itemIds.length === 0 || itemIds.length > characterAssetNameBatchSize)
    throw new Error(
      `Character asset name batch must contain between 1 and ${characterAssetNameBatchSize} item IDs`,
    )
  const seen = new Set<number>()
  for (const itemId of itemIds) {
    if (!Number.isSafeInteger(itemId) || itemId <= 0)
      throw new Error('Character asset name batch item IDs must be positive safe integers')
    if (seen.has(itemId)) throw new Error('Character asset name batch item IDs must be unique')
    seen.add(itemId)
  }
  return [...itemIds].toSorted((left, right) => left - right)
}

async function loadAssetLocations(assets: readonly CharacterAssetSnapshot[]) {
  const expected = new Map<number, Set<'station' | 'solar_system'>>()
  for (const asset of assets) {
    if (asset.locationType !== 'station' && asset.locationType !== 'solar_system') continue
    const types = expected.get(asset.locationId) ?? new Set<'station' | 'solar_system'>()
    types.add(asset.locationType)
    expected.set(asset.locationId, types)
  }
  if (expected.size === 0)
    return { values: new Map<number, UniverseName>(), status: 'complete' as const }

  try {
    const ids = [...expected.keys()].toSorted((left, right) => left - right)
    const resolution = await resolveUniverseNamesBestEffort(ids)
    const values = resolution.names
    const complete = [...expected].every(([id, types]) => {
      const resolved = values.get(id)
      return (
        resolved !== undefined &&
        (resolved.category === 'station' || resolved.category === 'solar_system') &&
        types.size === 1 &&
        types.has(resolved.category)
      )
    })
    const usableCount = [...expected].filter(([id, types]) => {
      const resolved = values.get(id)
      return (
        resolved !== undefined &&
        (resolved.category === 'station' || resolved.category === 'solar_system') &&
        types.size === 1 &&
        types.has(resolved.category)
      )
    }).length
    return {
      values,
      status: enrichmentStatus(resolution.complete && complete, usableCount > 0),
    }
  } catch {
    return { values: new Map<number, UniverseName>(), status: 'unavailable' as const }
  }
}

function enrichmentStatus(complete: boolean, partial: boolean): EnrichmentStatus {
  if (complete) return 'complete'
  if (partial) return 'partial'
  return 'unavailable'
}

function unknownType(typeId: number): CharacterAssetTypeData {
  return {
    typeName: `Unknown type ${typeId}`,
    groupId: null,
    groupName: null,
    categoryId: null,
    categoryName: null,
    unitVolume: null,
  }
}

function totalVolume(unitVolume: number | null, quantity: number) {
  if (unitVolume === null || !Number.isFinite(quantity) || quantity <= 0) return null
  const total = unitVolume * quantity
  return Number.isFinite(total) ? total : null
}

async function mapBounded<Item, Result>(
  items: readonly Item[],
  load: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results = await mapBoundedSettled(items, load)
  const failure = results.find((result) => result.status === 'rejected')
  if (failure) throw failure.reason
  return results.map((result) => (result as PromiseFulfilledResult<Result>).value)
}

async function mapBoundedSettled<Item, Result>(
  items: readonly Item[],
  load: (item: Item) => Promise<Result>,
) {
  const results = Array.from({ length: items.length }) as PromiseSettledResult<Result>[]
  let nextIndex = 0
  const workers = Array.from(
    { length: Math.min(characterAssetWorkerConcurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex
        nextIndex += 1
        try {
          // oxlint-disable-next-line no-await-in-loop
          results[index] = { status: 'fulfilled', value: await load(items[index]!) }
        } catch (reason) {
          results[index] = { status: 'rejected', reason }
        }
      }
    },
  )
  await Promise.all(workers)
  return results
}
