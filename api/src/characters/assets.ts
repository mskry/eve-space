import {
  projectAsset,
  projectAssetSnapshot,
  type AssetLocationProjection,
  type AssetSnapshot,
  type AssetTypeProjection,
  type ProjectedAsset,
} from '@eve-space/core-eve-projections/assets'
import { operationRegistry } from '@evespace/esi-client/operations'
import { eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { sdeCategories, sdeGroups, sdeTypes } from '../db/schema.js'
import {
  combineEsiReadResultMetadata,
  createCharacterEsiRead,
  toEsiReadResultMetadata,
  type EsiReadResult,
  type EsiReadResultMetadata,
} from '../esi-gateway/feature-execution.js'
import { isPositiveSafeInteger } from '../type-guards.js'
import { resolveUniverseNamesBestEffort } from '../universe/names.js'
import { getStaticLocations } from '../universe/static-locations.js'

// A sanity bound on the advertised page count, not a product limit: the fan-out allocates an array
// of page numbers, so a corrupt X-Pages must not reach it. 1,000 pages is ~1,000,000 assets.
const maximumCharacterAssetPages = 1000
const characterAssetNameBatchSize = 1000
const characterAssetWorkerConcurrency = 4

type EnrichmentStatus = 'complete' | 'partial' | 'unavailable'
type CharacterAssetSnapshot = AssetSnapshot

interface CharacterAssetPageSnapshot {
  page: number
  totalPages: number
  assets: CharacterAssetSnapshot[]
}

type CharacterAssetTypeData = AssetTypeProjection

type CharacterAssetLocationData = AssetLocationProjection

interface CharacterAssetNameSnapshot {
  itemId: number
  name: string
}

interface CharacterAssetsPageRepresentationInput {
  characterId: number
  page: number
  subjectLifecycleId: string
}

const characterAssetCacheSchema = z.object({
  isBlueprintCopy: z.boolean().nullable(),
  isSingleton: z.boolean(),
  itemId: z.number(),
  locationFlag: z.string(),
  locationId: z.number(),
  locationType: z.enum(['station', 'solar_system', 'item', 'other']),
  parentItemId: z.number().nullable(),
  quantity: z.number(),
  typeId: z.number(),
})
const characterAssetPageCacheSchema = z.object({
  assets: z.array(characterAssetCacheSchema),
  page: z.number(),
  totalPages: z.number(),
})
const characterAssetNamesCacheSchema = z.array(z.object({ itemId: z.number(), name: z.string() }))

const characterAssetsPageRead = createCharacterEsiRead({
  cacheSchema: characterAssetPageCacheSchema,
  descriptor: operationRegistry.GetCharactersCharacterIdAssets.transport,
  encodeRequest: (input: CharacterAssetsPageRepresentationInput) => ({
    path: { character_id: input.characterId },
    query: { page: input.page },
  }),
  map: (response, input): CharacterAssetPageSnapshot => ({
    page: input.page,
    totalPages: validatePageCount(response.meta.pagination?.pages),
    assets: response.data.map(projectAssetSnapshot),
  }),
  name: 'character-assets-page-core',
  operation: 'character-assets-page',
})

const characterAssetNamesRead = createCharacterEsiRead({
  cacheSchema: characterAssetNamesCacheSchema,
  descriptor: operationRegistry.PostCharactersCharacterIdAssetsNames.transport,
  encodeRequest: (input: {
    path: { character_id: number }
    body: number[]
    subjectLifecycleId: string
  }) => ({ path: input.path, body: input.body }),
  map: ({ data }): CharacterAssetNameSnapshot[] =>
    data.map(({ item_id: itemId, name }) => ({ itemId, name })),
  name: 'character-asset-names-core',
  operation: 'character-asset-names',
})

export const characterAssetsScope = characterAssetsPageRead.requiredScope

type CharacterAssetDto = ProjectedAsset

interface CharacterAssetsResult extends EsiReadResultMetadata {
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

export async function getCharacterAssets(
  characterId: number,
  subjectLifecycleId: string,
): Promise<CharacterAssetsResult> {
  const firstPage = await loadCharacterAssetPage(characterId, subjectLifecycleId, 1)
  const pageNumbers = Array.from({ length: firstPage.data.totalPages - 1 }, (_, index) => index + 2)
  const remainingPages = await mapBounded(pageNumbers, (page) =>
    loadCharacterAssetPage(characterId, subjectLifecycleId, page),
  )
  const pages = [firstPage, ...remainingPages]
  if (pages.some((page) => page.data.totalPages !== firstPage.data.totalPages)) {
    throw new CharacterAssetsPaginationError()
  }

  const assets = deduplicateAssets(pages)
  const [types, names, locations] = await Promise.all([
    loadAssetTypes(assets),
    loadAssetNames(characterId, subjectLifecycleId, assets),
    loadAssetLocations(assets),
  ])
  const metadata = combineEsiReadResultMetadata(pages.map(toEsiReadResultMetadata))
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
    enrichedAssets.push(
      projectAsset(
        asset,
        types.values.get(asset.typeId),
        names.values.get(asset.itemId),
        locations.values.get(asset.locationId),
      ),
    )
  }

  return {
    assets: enrichedAssets,
    characterId,
    enrichment: {
      locations: locations.status,
      names: names.status,
      types: types.status,
    },
    ...metadata,
    ...(retryAt ? { retryAt } : {}),
  }
}

async function loadCharacterAssetPage(
  characterId: number,
  subjectLifecycleId: string,
  page: number,
) {
  return characterAssetsPageRead.execute({ characterId, page, subjectLifecycleId })
}

function validatePageCount(value: unknown) {
  if (!isPositiveSafeInteger(value) || Number(value) > maximumCharacterAssetPages) {
    throw new CharacterAssetsPaginationError()
  }
  return Number(value)
}

function deduplicateAssets(pages: readonly EsiReadResult<CharacterAssetPageSnapshot>[]) {
  const assets = new Map<number, CharacterAssetSnapshot>()
  for (const page of pages) {
    for (const asset of page.data.assets)
      if (!assets.has(asset.itemId)) assets.set(asset.itemId, asset)
  }
  return [...assets.values()]
}

async function loadAssetTypes(assets: readonly CharacterAssetSnapshot[]) {
  const typeIds = [...new Set(assets.map((asset) => asset.typeId))].toSorted(
    (left, right) => left - right,
  )
  if (typeIds.length === 0) {
    return { status: 'complete' as const, values: new Map<number, CharacterAssetTypeData>() }
  }

  try {
    const rows = await db
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
      .limit(typeIds.length)
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
    return { status: 'unavailable' as const, values: new Map<number, CharacterAssetTypeData>() }
  }
}

async function loadAssetNames(
  characterId: number,
  subjectLifecycleId: string,
  assets: readonly CharacterAssetSnapshot[],
) {
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
  const results = await mapBoundedSettled(batches, (itemIds) =>
    loadCharacterAssetNameBatch(characterId, subjectLifecycleId, itemIds),
  )
  const values = new Map<number, string>()
  const candidateSet = new Set(candidates)
  let successfulBatches = 0
  for (const result of results) {
    if (result.status === 'rejected') {
      continue
    }
    successfulBatches += 1
    for (const entry of result.value) {
      if (candidateSet.has(entry.itemId) && !values.has(entry.itemId))
        values.set(entry.itemId, entry.name)
    }
  }
  return {
    status: enrichmentStatus(
      successfulBatches === batches.length && values.size === candidates.length,
      successfulBatches > 0,
    ),
    values,
  }
}

function loadCharacterAssetNameBatch(
  characterId: number,
  subjectLifecycleId: string,
  itemIds: readonly number[],
) {
  const normalizedItemIds = normalizeCharacterAssetNameBatch(itemIds)
  return characterAssetNamesRead
    .execute({
      body: normalizedItemIds,
      path: { character_id: characterId },
      subjectLifecycleId,
    })
    .then((result) => result.data)
}

function normalizeCharacterAssetNameBatch(itemIds: readonly number[]) {
  if (itemIds.length === 0 || itemIds.length > characterAssetNameBatchSize) {
    throw new Error(
      `Character asset name batch must contain between 1 and ${characterAssetNameBatchSize} item IDs`,
    )
  }
  const seen = new Set<number>()
  for (const itemId of itemIds) {
    if (!isPositiveSafeInteger(itemId)) {
      throw new Error('Character asset name batch item IDs must be positive safe integers')
    }
    if (seen.has(itemId)) {
      throw new Error('Character asset name batch item IDs must be unique')
    }
    seen.add(itemId)
  }
  return [...itemIds].toSorted((left, right) => left - right)
}

async function loadAssetLocations(assets: readonly CharacterAssetSnapshot[]) {
  const expected = new Map<number, Set<'station' | 'solar_system'>>()
  for (const asset of assets) {
    if (asset.locationType !== 'station' && asset.locationType !== 'solar_system') {
      continue
    }
    const types = expected.get(asset.locationId) ?? new Set<'station' | 'solar_system'>()
    types.add(asset.locationType)
    expected.set(asset.locationId, types)
  }
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
    resolveUniverseNamesBestEffort(ids).catch(() => ({ complete: false, names: new Map() })),
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
  return { status: enrichmentStatus(complete, usable), values }
}

function enrichmentStatus(complete: boolean, partial: boolean): EnrichmentStatus {
  if (complete) {
    return 'complete'
  }
  if (partial) {
    return 'partial'
  }
  return 'unavailable'
}

async function mapBounded<Item, Result>(
  items: readonly Item[],
  load: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results = await mapBoundedSettled(items, load)
  const failure = results.find((result) => result.status === 'rejected')
  if (failure) {
    throw failure.reason
  }
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
          results[index] = { reason, status: 'rejected' }
        }
      }
    },
  )
  await Promise.all(workers)
  return results
}
