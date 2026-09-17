import {
  CORE_DATA_CONTRIBUTION_CONTEXTS,
  CORE_DATA_PRODUCT_CONTRACTS,
  CORE_DATA_PRODUCT_IDS,
  type CoreDataContributionContext,
  type CoreDataProductId,
  type CoreDataProductRequest,
  type CoreDataProductResult,
} from '@eve-space/core-data-contract'
import { loadPublishedTypeGroupsProduct } from './published-type-groups-adapter.js'
import { loadPublishedSkillCatalogueProduct } from './published-skill-catalogue-adapter.js'
import { loadPublishedTypeDetailsProduct } from './published-type-details-adapter.js'
import { loadStaticLocationLabelsProduct } from './static-location-labels-adapter.js'

type CoreDataProductAdapter<ProductId extends CoreDataProductId> = (
  request: CoreDataProductRequest<ProductId>,
) => Promise<CoreDataProductResult<ProductId>>

interface ExecutableCoreDataProduct<ProductId extends CoreDataProductId = CoreDataProductId> {
  id: ProductId
  method: (typeof CORE_DATA_PRODUCT_CONTRACTS)[ProductId]['method']
  adapter: CoreDataProductAdapter<ProductId>
  sourceAuthority: 'official-sde'
  audience: 'installed-module'
  sensitivity: 'public'
  dtoVersion: number
  requestBound: number
  revisionStrategy: 'committed-sde-projection'
  availabilityBehavior: 'fail-closed'
  permittedContexts: readonly CoreDataContributionContext[]
  networkAllowed: false
}

type AnyExecutableCoreDataProduct = {
  [ProductId in CoreDataProductId]: ExecutableCoreDataProduct<ProductId>
}[CoreDataProductId]

export const coreDataProductCatalog = [
  {
    id: 'published-type-groups',
    method: 'publishedTypeGroups',
    adapter: loadPublishedTypeGroupsProduct,
    sourceAuthority: 'official-sde',
    audience: 'installed-module',
    sensitivity: 'public',
    dtoVersion: 1,
    requestBound: 500,
    revisionStrategy: 'committed-sde-projection',
    availabilityBehavior: 'fail-closed',
    permittedContexts: ['route', 'resource-projection'],
    networkAllowed: false,
  },
  {
    id: 'published-skill-catalogue',
    method: 'publishedSkillCatalogue',
    adapter: loadPublishedSkillCatalogueProduct,
    sourceAuthority: 'official-sde',
    audience: 'installed-module',
    sensitivity: 'public',
    dtoVersion: 1,
    requestBound: 10_000,
    revisionStrategy: 'committed-sde-projection',
    availabilityBehavior: 'fail-closed',
    permittedContexts: ['route', 'resource-projection'],
    networkAllowed: false,
  },
  {
    id: 'published-type-details',
    method: 'publishedTypeDetails',
    adapter: loadPublishedTypeDetailsProduct,
    sourceAuthority: 'official-sde',
    audience: 'installed-module',
    sensitivity: 'public',
    dtoVersion: 1,
    requestBound: 500,
    revisionStrategy: 'committed-sde-projection',
    availabilityBehavior: 'fail-closed',
    permittedContexts: ['route', 'resource-projection'],
    networkAllowed: false,
  },
  {
    id: 'static-location-labels',
    method: 'staticLocationLabels',
    adapter: loadStaticLocationLabelsProduct,
    sourceAuthority: 'official-sde',
    audience: 'installed-module',
    sensitivity: 'public',
    dtoVersion: 1,
    requestBound: 500,
    revisionStrategy: 'committed-sde-projection',
    availabilityBehavior: 'fail-closed',
    permittedContexts: ['route', 'resource-projection'],
    networkAllowed: false,
  },
] as const satisfies readonly AnyExecutableCoreDataProduct[]

export function assertCoreDataProductCatalogConfiguration(
  catalog: readonly unknown[] = coreDataProductCatalog,
): void {
  const seen = new Set<string>()
  for (const candidate of catalog) {
    if (!isRecord(candidate)) throw new Error('Core-data catalog entries must be objects')
    const id = candidate.id
    if (typeof id !== 'string' || !isCoreDataProductId(id))
      throw new Error(`Unknown core-data product identity: ${String(id)}`)
    if (seen.has(id)) throw new Error(`Duplicate core-data product identity: ${id}`)
    seen.add(id)
    validateDefinition(candidate, id)
  }

  for (const id of CORE_DATA_PRODUCT_IDS) {
    if (!seen.has(id)) throw new Error(`Missing core-data product adapter: ${id}`)
  }
}

export function getCoreDataProductDefinition<ProductId extends CoreDataProductId>(
  productId: ProductId,
): Extract<(typeof coreDataProductCatalog)[number], { id: ProductId }> {
  const definition = coreDataProductCatalog.find(({ id }) => id === productId)
  if (!definition) throw new Error(`Unknown core-data product identity: ${productId}`)
  return definition as Extract<(typeof coreDataProductCatalog)[number], { id: ProductId }>
}

function validateDefinition(candidate: Record<string, unknown>, id: CoreDataProductId) {
  const contract = CORE_DATA_PRODUCT_CONTRACTS[id]
  if (typeof candidate.adapter !== 'function')
    throw new Error(`Missing core-data product adapter: ${id}`)
  if (candidate.method !== contract.method)
    throw new Error(`Core-data method drift for product: ${id}`)
  if (candidate.audience !== contract.audience || candidate.sensitivity !== contract.sensitivity)
    throw new Error(`Core-data audience drift for product: ${id}`)
  if (candidate.dtoVersion !== contract.dtoVersion)
    throw new Error(`Core-data DTO version drift for product: ${id}`)
  if (candidate.requestBound !== contract.requestBound)
    throw new Error(`Core-data request bound drift for product: ${id}`)
  if (candidate.sourceAuthority !== 'official-sde')
    throw new Error(`Invalid core-data source authority for product: ${id}`)
  if (candidate.revisionStrategy !== 'committed-sde-projection')
    throw new Error(`Invalid core-data revision strategy for product: ${id}`)
  if (candidate.availabilityBehavior !== 'fail-closed')
    throw new Error(`Invalid core-data availability behavior for product: ${id}`)
  if (!sameContexts(candidate.permittedContexts, contract.permittedContexts))
    throw new Error(`Core-data context policy drift for product: ${id}`)
  if (
    contract.permittedContexts.includes('resource-projection') &&
    candidate.networkAllowed !== false
  )
    throw new Error(`Resource-projection core-data product cannot allow network access: ${id}`)
}

function sameContexts(
  candidate: unknown,
  expected: readonly CoreDataContributionContext[],
): boolean {
  if (!Array.isArray(candidate) || candidate.some((value) => !isCoreDataContext(value)))
    return false
  return (
    candidate.length === expected.length && expected.every((value) => candidate.includes(value))
  )
}

function isCoreDataProductId(value: string): value is CoreDataProductId {
  return (CORE_DATA_PRODUCT_IDS as readonly string[]).includes(value)
}

function isCoreDataContext(value: unknown): value is CoreDataContributionContext {
  return (
    typeof value === 'string' &&
    (CORE_DATA_CONTRIBUTION_CONTEXTS as readonly string[]).includes(value)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
