import {
  projectAsset,
  projectAssetSnapshot,
  type AssetLocationProjection,
  type AssetSourceRecord,
  type AssetTypeProjection,
} from '@eve-space/core-eve-projections/assets'
import type {
  PlatformBoundedCollectionResourceImplementation,
  PlatformCharacterResourceSubject,
} from '@eve-space/platform-module-contract/resources'
import type { PlatformCoreEsiOperationProtocol } from '@eve-space/platform-module-server'
import { z } from 'zod'
import {
  materializeEvidenceObservation,
  startEvidenceCollection,
  type EvidenceCollectionContext,
  type EvidenceObservation,
  type StagedEvidenceRecord,
} from './evidence-collection.js'
import { maintainEvidence } from './evidence-maintenance.js'
import { requireEsiPageCount } from './page-count.js'
import type {
  EvidenceCollectionPersistence,
  EvidenceMaintenancePersistence,
  EvidenceMaterializationPersistence,
} from './persistence.js'
import { resolveUniverseNamesBestEffort } from './universe-name-resolution.js'

const pageSize = 1_000
const projectionBatchSize = 500
const maximumPages = 10
const assetSchema = z.strictObject({
  item_id: z.number().int().positive(),
  type_id: z.number().int().positive(),
  quantity: z.number().int(),
  is_singleton: z.boolean(),
  is_blueprint_copy: z.boolean().optional(),
  location_id: z.number().int().positive(),
  location_type: z.enum(['station', 'solar_system', 'item', 'other']),
  location_flag: z.string().min(1).max(100),
})
const assetPageSchema = z.array(assetSchema).max(pageSize)
const assetNamesSchema = z.array(
  z.strictObject({ item_id: z.number().int().positive(), name: z.string().max(500) }),
)
const checkpointSchema = z.object({
  page: z.number().int().min(1).max(maximumPages).default(1),
})

type AssetObservation = Extract<EvidenceObservation, { resourceId: 'assets' }>
type AssetProducts = readonly ['published-type-details', 'static-location-labels']
type AssetProtocol = PlatformCoreEsiOperationProtocol<
  'character-assets-page' | 'character-asset-names' | 'universe-resolve-names'
>
type AssetCollectionContext = EvidenceCollectionContext<AssetProtocol, AssetProducts>

export const assetsResource: PlatformBoundedCollectionResourceImplementation<
  'character-assets-page',
  AssetProtocol,
  AssetObservation,
  string,
  unknown,
  PlatformCharacterResourceSubject,
  AssetProducts,
  EvidenceCollectionPersistence,
  EvidenceMaterializationPersistence,
  EvidenceMaintenancePersistence
> = {
  mode: 'bounded-collection',
  operation: 'character-assets-page',
  async collect(context) {
    const collection = await startEvidenceCollection(
      { sectionId: 'assets', resourceId: 'assets' },
      context,
    )
    const checkpoint = checkpointSchema.parse(collection.checkpoint)
    const result = await context.operations['character-assets-page']({
      path: { character_id: context.subject.characterId },
      query: { page: checkpoint.page },
    })
    const page = assetPageSchema.parse(result.data)
    const totalPages = requireEsiPageCount(
      result.pagination,
      checkpoint.page,
      maximumPages,
      'Character asset',
    )
    const records = await projectAssetPage(page, result.validatedAt, context)
    const complete = checkpoint.page === totalPages
    return {
      complete,
      data: {
        sectionId: 'assets',
        resourceId: 'assets',
        observationId: collection.observationId,
        expectedRevision: collection.expectedRevision,
        checkpoint: complete
          ? { complete: true, page: checkpoint.page }
          : { complete: false, page: checkpoint.page + 1 },
        records,
      },
    }
  },
  materialize(context) {
    return materializeEvidenceObservation(context)
  },
  maintain(context) {
    return maintainEvidence('assets', context, false)
  },
}

async function projectAssetPage(
  source: readonly AssetSourceRecord[],
  validatedAt: string,
  context: AssetCollectionContext,
) {
  const batches = Array.from(
    { length: Math.ceil(source.length / projectionBatchSize) },
    (_, index) => source.slice(index * projectionBatchSize, (index + 1) * projectionBatchSize),
  )
  return (
    await Promise.all(batches.map((batch) => projectAssets(batch, validatedAt, context)))
  ).flat()
}

async function projectAssets(
  source: readonly AssetSourceRecord[],
  validatedAt: string,
  context: AssetCollectionContext,
): Promise<StagedEvidenceRecord<'asset'>[]> {
  const snapshots = source.map(projectAssetSnapshot)
  const typeIds = unique(snapshots.map((asset) => asset.typeId))
  const locationIds = unique(
    snapshots
      .filter((asset) => asset.locationType === 'station' || asset.locationType === 'solar_system')
      .map((asset) => asset.locationId),
  )
  const namedItemIds = unique(
    snapshots.filter((asset) => asset.isSingleton).map((asset) => asset.itemId),
  )
  const [types, locations, names, universeNames] = await Promise.all([
    context.capabilities.coreData.publishedTypeDetails({ typeIds }),
    context.capabilities.coreData.staticLocationLabels({ locationIds }),
    namedItemIds.length === 0
      ? { data: [] }
      : context.operations['character-asset-names']({
          path: { character_id: context.subject.characterId },
          body: namedItemIds,
        }),
    resolveUniverseNamesBestEffort(locationIds, context),
  ])
  const typesById = new Map<number, AssetTypeProjection>(
    types.rows.map((type) => [
      type.typeId,
      {
        typeName: type.typeName,
        groupId: type.groupId,
        groupName: type.groupName,
        categoryId: type.categoryId,
        categoryName: type.categoryName,
        unitVolume: type.packagedVolume,
      },
    ]),
  )
  const customNames = new Map(
    assetNamesSchema.parse(names.data).map((name) => [name.item_id, name.name]),
  )
  const locationsById = new Map<number, AssetLocationProjection>(
    locations.rows.map((location) => [
      location.locationId,
      {
        name: location.name,
        solarSystemId: location.solarSystemId,
        solarSystemSecurityStatus: null,
      },
    ]),
  )
  for (const locationId of locationIds) {
    if (locationsById.has(locationId)) continue
    locationsById.set(locationId, {
      name: universeNames.get(locationId)?.name ?? null,
      solarSystemId: null,
      solarSystemSecurityStatus: null,
    })
  }
  return snapshots.map((snapshot) => ({
    recordKind: 'asset',
    sourceId: String(snapshot.itemId),
    sourceTimestamp: null,
    evidence: {
      ...projectAsset(
        snapshot,
        typesById.get(snapshot.typeId),
        customNames.get(snapshot.itemId),
        locationsById.get(snapshot.locationId),
      ),
    },
    validatedAt,
  }))
}

function unique(values: readonly number[]) {
  return [...new Set(values)]
}
