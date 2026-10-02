import type {
  CoreDataContributionContext,
  CoreDataMethods,
  CoreDataMethodsFor,
  CoreDataProductId,
} from '@eve-space/core-data-contract'
import { getCoreDataProductDefinition, isCoreDataProductId } from './product-catalog.js'

const bindReadSignal = <Request extends { readonly signal?: AbortSignal }, Result>(
  read: (request: Request) => Promise<Result>,
  signal?: AbortSignal,
) => (signal ? (request: Request) => read({ ...request, signal }) : read)

export const createCoreDataCapability = <const ProductIds extends readonly CoreDataProductId[]>(
  productIds: ProductIds,
  context: CoreDataContributionContext,
  signal?: AbortSignal,
): CoreDataMethodsFor<ProductIds> => {
  assertCoreDataProductDeclarations(productIds, context)
  const methods: Partial<CoreDataMethods> = {}
  for (const productId of productIds) {
    if (productId === 'public-character-profile') {
      methods.publicCharacterProfile = getCoreDataProductDefinition(
        'public-character-profile',
      ).adapter
    }
    if (productId === 'market-catalogue') {
      methods.marketCatalogue = bindReadSignal(
        getCoreDataProductDefinition('market-catalogue').adapter,
        signal,
      )
    }
    if (productId === 'market-station-regions') {
      methods.marketStationRegions = getCoreDataProductDefinition('market-station-regions').adapter
    }
    if (productId === 'published-type-groups') {
      methods.publishedTypeGroups = getCoreDataProductDefinition('published-type-groups').adapter
    }
    if (productId === 'published-skill-catalogue') {
      methods.publishedSkillCatalogue = getCoreDataProductDefinition(
        'published-skill-catalogue',
      ).adapter
    }
    if (productId === 'published-type-details') {
      methods.publishedTypeDetails = getCoreDataProductDefinition('published-type-details').adapter
    }
    if (productId === 'static-location-labels') {
      methods.staticLocationLabels = bindReadSignal(
        getCoreDataProductDefinition('static-location-labels').adapter,
        signal,
      )
    }
  }
  return methods as CoreDataMethodsFor<ProductIds>
}

export function assertCoreDataProductDeclarations(
  productIds: readonly CoreDataProductId[],
  context: CoreDataContributionContext,
): void {
  if (!Array.isArray(productIds)) {
    throw new TypeError('Core-data product declarations must be an array')
  }
  const seen = new Set<string>()
  for (const productId of productIds) {
    if (typeof productId !== 'string' || !isCoreDataProductId(productId)) {
      throw new Error(`Unknown core-data product identity: ${String(productId)}`)
    }
    if (seen.has(productId)) {
      throw new Error(`Duplicate core-data product identity: ${productId}`)
    }
    seen.add(productId)
    const definition = getCoreDataProductDefinition(productId)
    const permittedContexts: readonly CoreDataContributionContext[] = definition.permittedContexts
    if (!permittedContexts.includes(context)) {
      throw new Error(`Core-data product ${productId} is not permitted in ${context}`)
    }
    if (context === 'resource-projection' && definition.networkAllowed !== false) {
      throw new Error(`Core-data product ${productId} is not safe for resource projection`)
    }
  }
}
