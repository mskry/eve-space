import type { CoreDataProductId } from '@eve-space/core-data-contract'
import type {
  PlatformInstalledResourceDescriptor,
  PlatformModuleResourceCapabilities,
  PlatformModuleResourceTransaction,
  PlatformModuleRouteCapabilities,
} from '@eve-space/platform-module-contract'
import { createCoreDataCapability } from '../core-data/capabilities.js'
import { withModuleQueryTransaction } from '../db/module-query-transaction.js'
import { sql } from '../db/client.js'
import { createModulePersistenceCapability } from '../db/module-persistence.js'
import { createPlatformModuleLogger } from './module-logging.js'

export function createPlatformModuleRouteCapabilities<
  const ProductIds extends readonly CoreDataProductId[] = readonly [],
>(
  moduleId: string,
  productIds: ProductIds = [] as unknown as ProductIds,
): PlatformModuleRouteCapabilities<PlatformModuleResourceTransaction, ProductIds> {
  const persistence = createModulePersistenceCapability(sql, moduleId)
  return {
    coreData: createCoreDataCapability(productIds, 'route'),
    logger: createPlatformModuleLogger(moduleId),
    persistence: {
      transaction: (operation) =>
        persistence.transaction((transaction) =>
          withModuleQueryTransaction(transaction, operation),
        ),
    },
  }
}

export function createPlatformResourceReadCapabilities<
  const ProductIds extends readonly CoreDataProductId[],
>(
  resource: PlatformInstalledResourceDescriptor<unknown, ProductIds>,
): PlatformModuleResourceCapabilities<ProductIds> {
  const moduleId = resource.moduleId
  const persistence = createModulePersistenceCapability(sql, moduleId, {
    readOnly: true,
    statementTimeoutMilliseconds: 2_000,
  })
  return {
    coreData: createCoreDataCapability(
      resource.coreDataProducts ?? ([] as unknown as ProductIds),
      'resource-projection',
    ),
    logger: createPlatformModuleLogger(moduleId),
    persistence: {
      transaction: (operation) =>
        persistence.transaction((transaction) =>
          withModuleQueryTransaction(transaction, operation),
        ),
    },
  }
}
