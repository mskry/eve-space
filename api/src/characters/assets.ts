import { operationRegistry } from '@evespace/esi-client/operations'
import type { GetCharactersCharacterIdAssetsResponse } from '@evespace/esi-client/types'
import { eq, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { sdeCategories, sdeGroups, sdeTypes } from '../db/schema.js'
import { getCharacterEsiScope } from '../esi-resilience/catalog-access.js'
import { execute } from '../esi-resilience/execute.js'
import { registerEsiRepresentation } from '../esi-resilience/representation-registry.js'
import { defineCharacterEsiRepresentation } from '../esi-resilience/representations.js'
import { combineEsiResultMetadata, toEsiResultMetadata } from '../esi-resilience/result-metadata.js'
import type { EsiCachedResult, EsiResultMetadata } from '../esi-resilience/types.js'
import { isPositiveSafeInteger } from '../type-guards.js'
import { resolveUniverseNamesBestEffort } from '../universe/names.js'
import { getStaticLocations } from '../universe/static-locations.js'

export const characterAssetsScope = getCharacterEsiScope('character-assets-page')
// A sanity bound on the advertised page count, not a product limit: the fan-out allocates an array
// of page numbers, so a corrupt X-Pages must not reach it. 1,000 pages is ~1,000,000 assets.
export const maximumCharacterAssetPages = 1_000
export const characterAssetNameBatchSize = 1_000
export const characterAssetWorkerConcurrency = 4

type AssetLocationType = 'station' | 'solar_system' | 'item' | 'other'
type EnrichmentStatus = 'complete' | 'partial' | 'unavailable'
type EsiAsset = GetCharactersCharacterIdAssetsResponse[number]

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

interface CharacterAssetLocationData {
  name: string | null
  solarSystemId: number | null
  solarSystemSecurityStatus: number | null
}

interface CharacterAssetNameSnapshot {
  itemId: number
  name: string
}

interface CharacterAssetsPageRepresentationInput {
  characterId: number
  page: number
}

const characterAssetsPageRepresentation = registerEsiRepresentation(
  defineCharacterEsiRepresentation({
    operation: 'character-assets-page',
    name: 'character-assets-page-core',
    descriptor: operationRegistry.GetCharactersCharacterIdAssets.transport,
    encodeRequest: (input: CharacterAssetsPageRepresentationInput) => ({
      path: { character_id: input.characterId },
      query: { page: input.page },
    }),
    map: (response, input): CharacterAssetPageSnapshot => ({
      page: input.page,
      totalPages: validatePageCount(response.meta.pagination?.pages),
      assets: response.data.map(mapAssetSnapshot),
    }),
  }),
)

const characterAssetNamesRepresentation = registerEsiRepresentation(
  defineCharacterEsiRepresentation({
    operation: 'character-asset-names',
    name: 'character-asset-names-core',
    descriptor: operationRegistry.PostCharactersCharacterIdAssetsNames.transport,
    encodeRequest: (input: { path: { character_id: number }; body: number[] }) => input,
    map: ({ data }): CharacterAssetNameSnapshot[] =>
      data.map(({ item_id: itemId, name }) => ({ itemId, name })),
  }),
)

export interface CharacterAssetDto extends CharacterAssetSnapshot, CharacterAssetTypeData {
  totalVolume: number | null
  customName: string | null
  locationName: string | null
  solarSystemId: number | null
  solarSystemSecurityStatus: number | null
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
    enrichedAssets.push({
      ...asset,
      ...type,
      totalVolume: totalVolume(type.unitVolume, asset.quantity),
      customName: names.values.get(asset.itemId) ?? null,
      locationName: location?.name ?? null,
      solarSystemId: location?.solarSystemId ?? null,
      solarSystemSecurityStatus: location?.solarSystemSecurityStatus ?? null,
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
  return execute(characterAssetsPageRepresentation, { characterId, page })
}

function validatePageCount(value: unknown) {
  if (!isPositiveSafeInteger(value) || Number(value) > maximumCharacterAssetPages)
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
      if (candidateSet.has(entry.itemId) && !values.has(entry.itemId))
        values.set(entry.itemId, entry.name)
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
  return execute(characterAssetNamesRepresentation, {
    path: { character_id: characterId },
    body: normalizedItemIds,
  }).then((result) => result.data)
}

export function normalizeCharacterAssetNameBatch(itemIds: readonly number[]) {
  if (itemIds.length === 0 || itemIds.length > characterAssetNameBatchSize)
    throw new Error(
      `Character asset name batch must contain between 1 and ${characterAssetNameBatchSize} item IDs`,
    )
  const seen = new Set<number>()
  for (const itemId of itemIds) {
    if (!isPositiveSafeInteger(itemId))
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
    return {
      values: new Map<number, CharacterAssetLocationData>(),
      status: 'complete' as const,
    }

  const locations = [...expected]
    .filter(([, types]) => types.size === 1)
    .map(([id, types]) => ({ id, type: [...types][0]! }))
  const ids = [...expected.keys()].toSorted((left, right) => left - right)
  const [names, details] = await Promise.all([
    resolveUniverseNamesBestEffort(ids).catch(() => ({ names: new Map(), complete: false })),
    getStaticLocations(locations).catch(() => []),
  ])
  const staticLocations = new Map(details.map((location) => [location.id, location]))

  const values = new Map<number, CharacterAssetLocationData>()
  for (const location of locations) {
    const resolvedName = names.names.get(location.id)
    const detail = staticLocations.get(location.id)
    const matchedDetail = detail?.type === location.type ? detail : undefined
    const securityStatus = matchedDetail?.solarSystemSecurityStatus
    values.set(location.id, {
      name:
        (resolvedName?.category === location.type ? resolvedName.name : null) ??
        matchedDetail?.name ??
        null,
      solarSystemId: matchedDetail?.solarSystemId ?? null,
      solarSystemSecurityStatus:
        securityStatus != null && Number.isFinite(securityStatus) ? securityStatus : null,
    })
  }

  const complete =
    values.size === expected.size &&
    [...values.values()].every(
      (value) =>
        value.name !== null &&
        value.solarSystemId !== null &&
        value.solarSystemSecurityStatus !== null,
    )
  const usable = [...values.values()].some(
    (value) =>
      value.name !== null ||
      value.solarSystemId !== null ||
      value.solarSystemSecurityStatus !== null,
  )
  return { values, status: enrichmentStatus(complete, usable) }
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
