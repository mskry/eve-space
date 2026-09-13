import type {
  CoreDataContributionContext,
  CoreDataMethods,
  CoreDataMethodsFor,
  CoreDataProductId,
} from '@eve-space/core-data-contract'
import { CORE_DATA_PRODUCT_IDS } from '@eve-space/core-data-contract'
import { getCoreDataProductDefinition } from './product-catalog.js'

export function createCoreDataCapability<const ProductIds extends readonly CoreDataProductId[]>(
  productIds: ProductIds,
  context: CoreDataContributionContext,
): CoreDataMethodsFor<ProductIds> {
  assertCoreDataProductDeclarations(productIds, context)
  const methods: Partial<CoreDataMethods> = {}
  for (const productId of productIds) {
    const definition = getCoreDataProductDefinition(productId)
    if (productId === 'published-type-groups') methods.publishedTypeGroups = definition.adapter
  }
  return methods as CoreDataMethodsFor<ProductIds>
}

export function assertCoreDataProductDeclarations(
  productIds: unknown,
  context: CoreDataContributionContext,
): asserts productIds is readonly CoreDataProductId[] {
  if (!Array.isArray(productIds)) throw new Error('Core-data product declarations must be an array')
  const seen = new Set<string>()
  for (const productId of productIds) {
    if (
      typeof productId !== 'string' ||
      !(CORE_DATA_PRODUCT_IDS as readonly string[]).includes(productId)
    )
      throw new Error(`Unknown core-data product identity: ${String(productId)}`)
    if (seen.has(productId)) throw new Error(`Duplicate core-data product identity: ${productId}`)
    seen.add(productId)
    const definition = getCoreDataProductDefinition(productId as CoreDataProductId)
    if (!(definition.permittedContexts as readonly CoreDataContributionContext[]).includes(context))
      throw new Error(`Core-data product ${productId} is not permitted in ${context}`)
    if (context === 'resource-projection' && definition.networkAllowed !== false)
      throw new Error(`Core-data product ${productId} is not safe for resource projection`)
  }
}
