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

interface UnvalidatedCoreDataProduct {
  readonly id?: unknown
  readonly method?: unknown
  readonly adapter?: unknown
  readonly sourceAuthority?: unknown
  readonly audience?: unknown
  readonly sensitivity?: unknown
  readonly dtoVersion?: unknown
  readonly requestBound?: unknown
  readonly revisionStrategy?: unknown
  readonly availabilityBehavior?: unknown
  readonly permittedContexts?: unknown
  readonly networkAllowed?: unknown
}

const productIds: ReadonlySet<string> = new Set(CORE_DATA_PRODUCT_IDS)
const contributionContexts: ReadonlySet<string> = new Set(CORE_DATA_CONTRIBUTION_CONTEXTS)

export const coreDataProductCatalog = [
  {
    adapter: loadPublishedTypeGroupsProduct,
    audience: 'installed-module',
    availabilityBehavior: 'fail-closed',
    dtoVersion: 1,
    id: 'published-type-groups',
    method: 'publishedTypeGroups',
    networkAllowed: false,
    permittedContexts: ['route', 'resource-projection'],
    requestBound: 500,
    revisionStrategy: 'committed-sde-projection',
    sensitivity: 'public',
    sourceAuthority: 'official-sde',
  },
  {
    adapter: loadPublishedSkillCatalogueProduct,
    audience: 'installed-module',
    availabilityBehavior: 'fail-closed',
    dtoVersion: 1,
    id: 'published-skill-catalogue',
    method: 'publishedSkillCatalogue',
    networkAllowed: false,
    permittedContexts: ['route', 'resource-projection'],
    requestBound: 10_000,
    revisionStrategy: 'committed-sde-projection',
    sensitivity: 'public',
    sourceAuthority: 'official-sde',
  },
  {
    adapter: loadPublishedTypeDetailsProduct,
    audience: 'installed-module',
    availabilityBehavior: 'fail-closed',
    dtoVersion: 1,
    id: 'published-type-details',
    method: 'publishedTypeDetails',
    networkAllowed: false,
    permittedContexts: ['route', 'resource-projection'],
    requestBound: 500,
    revisionStrategy: 'committed-sde-projection',
    sensitivity: 'public',
    sourceAuthority: 'official-sde',
  },
  {
    adapter: loadStaticLocationLabelsProduct,
    audience: 'installed-module',
    availabilityBehavior: 'fail-closed',
    dtoVersion: 1,
    id: 'static-location-labels',
    method: 'staticLocationLabels',
    networkAllowed: false,
    permittedContexts: ['route', 'resource-projection'],
    requestBound: 500,
    revisionStrategy: 'committed-sde-projection',
    sensitivity: 'public',
    sourceAuthority: 'official-sde',
  },
] as const satisfies readonly AnyExecutableCoreDataProduct[]

export function assertCoreDataProductCatalogConfiguration(
  catalog: readonly unknown[] = coreDataProductCatalog,
): void {
  const seen = new Set<string>()
  for (const candidate of catalog) {
    if (!isCatalogEntry(candidate)) {
      throw new Error('Core-data catalog entries must be objects')
    }
    const id = candidate.id
    if (typeof id !== 'string' || !isCoreDataProductId(id)) {
      throw new Error(`Unknown core-data product identity: ${String(id)}`)
    }
    if (seen.has(id)) {
      throw new Error(`Duplicate core-data product identity: ${id}`)
    }
    seen.add(id)
    validateDefinition(candidate, id)
  }

  for (const id of CORE_DATA_PRODUCT_IDS) {
    if (!seen.has(id)) {
      throw new Error(`Missing core-data product adapter: ${id}`)
    }
  }
}

export function getCoreDataProductDefinition<ProductId extends CoreDataProductId>(
  productId: ProductId,
): Extract<(typeof coreDataProductCatalog)[number], { id: ProductId }> {
  const definition = coreDataProductCatalog.find(
    (candidate): candidate is Extract<(typeof coreDataProductCatalog)[number], { id: ProductId }> =>
      candidate.id === productId,
  )
  if (!definition) {
    throw new Error(`Unknown core-data product identity: ${productId}`)
  }
  return definition
}

function validateDefinition(candidate: UnvalidatedCoreDataProduct, id: CoreDataProductId) {
  const contract = CORE_DATA_PRODUCT_CONTRACTS[id]
  if (typeof candidate.adapter !== 'function') {
    throw new TypeError(`Missing core-data product adapter: ${id}`)
  }
  if (candidate.method !== contract.method) {
    throw new Error(`Core-data method drift for product: ${id}`)
  }
  if (candidate.audience !== contract.audience || candidate.sensitivity !== contract.sensitivity) {
    throw new Error(`Core-data audience drift for product: ${id}`)
  }
  if (candidate.dtoVersion !== contract.dtoVersion) {
    throw new Error(`Core-data DTO version drift for product: ${id}`)
  }
  if (candidate.requestBound !== contract.requestBound) {
    throw new Error(`Core-data request bound drift for product: ${id}`)
  }
  if (candidate.sourceAuthority !== 'official-sde') {
    throw new Error(`Invalid core-data source authority for product: ${id}`)
  }
  if (candidate.revisionStrategy !== 'committed-sde-projection') {
    throw new Error(`Invalid core-data revision strategy for product: ${id}`)
  }
  if (candidate.availabilityBehavior !== 'fail-closed') {
    throw new Error(`Invalid core-data availability behavior for product: ${id}`)
  }
  if (!sameContexts(candidate.permittedContexts, contract.permittedContexts)) {
    throw new Error(`Core-data context policy drift for product: ${id}`)
  }
  if (
    contract.permittedContexts.includes('resource-projection') &&
    candidate.networkAllowed !== false
  ) {
    throw new Error(`Resource-projection core-data product cannot allow network access: ${id}`)
  }
}

function sameContexts(
  candidate: unknown,
  expected: readonly CoreDataContributionContext[],
): boolean {
  if (!Array.isArray(candidate) || candidate.some((value) => !isCoreDataContext(value))) {
    return false
  }
  return (
    candidate.length === expected.length && expected.every((value) => candidate.includes(value))
  )
}

export function isCoreDataProductId(value: string): value is CoreDataProductId {
  return productIds.has(value)
}

function isCoreDataContext(value: unknown): value is CoreDataContributionContext {
  return typeof value === 'string' && contributionContexts.has(value)
}

function isCatalogEntry(value: unknown): value is UnvalidatedCoreDataProduct {
  return typeof value === 'object' && value !== null
}
