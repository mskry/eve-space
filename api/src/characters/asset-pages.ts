import { projectAssetSnapshot, type AssetSnapshot } from '@eve-space/core-eve-projections/assets'
import { operationRegistry } from '@evespace/esi-client/operations'
import { z } from 'zod'
import { createCharacterEsiRead } from '../esi-gateway/feature-execution.js'
import { isPositiveSafeInteger } from '../type-guards.js'

const maximumCharacterAssetPages = 1000
const characterAssetNameBatchSize = 1000
const isSupportedAssetPageCount = (value: number | undefined): value is number =>
  value !== undefined &&
  Number.isSafeInteger(value) &&
  value > 0 &&
  value <= maximumCharacterAssetPages

export interface CharacterAssetPageSnapshot {
  page: number
  totalPages: number
  assets: AssetSnapshot[]
}

interface CharacterAssetNameSnapshot {
  itemId: number
  name: string
}

interface CharacterAssetsPageRepresentationInput {
  signal?: AbortSignal
  characterId: number
  page: number
  subjectLifecycleId: string
}

export class CharacterAssetsPaginationError extends Error {
  constructor() {
    super('ESI returned invalid character asset pagination metadata')
    this.name = 'CharacterAssetsPaginationError'
  }
}

const validatePageCount = (value: number | undefined) => {
  if (!isSupportedAssetPageCount(value)) throw new CharacterAssetsPaginationError()
  return value
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
const characterAssetPageCacheSchema = z
  .object({
    assets: z.array(characterAssetCacheSchema),
    page: z.number().refine(isPositiveSafeInteger),
    totalPages: z.number().refine(isSupportedAssetPageCount),
  })
  .refine(({ page, totalPages }) => page <= totalPages)
const characterAssetNamesCacheSchema = z.array(z.object({ itemId: z.number(), name: z.string() }))

const characterAssetsPageRead = createCharacterEsiRead({
  cacheSchema: characterAssetPageCacheSchema,
  cacheSchemaForInput: (input: CharacterAssetsPageRepresentationInput) =>
    characterAssetPageCacheSchema.refine(({ page }) => page === input.page),
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
    signal?: AbortSignal
  }) => ({ path: input.path, body: input.body }),
  map: ({ data }): CharacterAssetNameSnapshot[] =>
    data.map(({ item_id: itemId, name }) => ({ itemId, name })),
  name: 'character-asset-names-core',
  operation: 'character-asset-names',
})

export const characterAssetsScope = characterAssetsPageRead.requiredScope

export const loadCharacterAssetPage = async (
  characterId: number,
  subjectLifecycleId: string,
  page: number,
  signal?: AbortSignal,
) => {
  signal?.throwIfAborted()
  const result = await characterAssetsPageRead.execute({
    characterId,
    page,
    subjectLifecycleId,
    ...(signal && { signal }),
  })
  if (result.data.page !== page) {
    throw new CharacterAssetsPaginationError()
  }
  return result
}

export const normalizeCharacterAssetNameBatch = (itemIds: readonly number[]) => {
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

export const loadCharacterAssetNameBatch = (
  characterId: number,
  subjectLifecycleId: string,
  itemIds: readonly number[],
  signal?: AbortSignal,
) => {
  signal?.throwIfAborted()
  const normalizedItemIds = normalizeCharacterAssetNameBatch(itemIds)
  return characterAssetNamesRead
    .execute({
      body: normalizedItemIds,
      path: { character_id: characterId },
      subjectLifecycleId,
      ...(signal && { signal }),
    })
    .then((result) => result.data)
}
