import type { CoreDataProductId } from '@eve-space/core-data-contract'
import type { PlatformActivityProviderContext } from '@eve-space/platform-module-contract/activity'
import { platformActivityProviderTimeoutMilliseconds } from '@eve-space/platform-module-contract/activity'
import { createCoreDataCapability } from '../core-data/capabilities.js'
import { createPlatformModuleCollectionStatusReads } from './module-collection-status-capabilities.js'
import { createPlatformModuleLogger } from './module-logging.js'
import { createPlatformModuleActivityProviderPersistence } from './module-persistence-capabilities.js'

export function createPlatformModuleActivityProviderCapabilities<
  const ModuleId extends string,
  const ProviderId extends string,
  const ProductIds extends readonly CoreDataProductId[] = readonly [],
>(
  moduleId: ModuleId,
  providerId: ProviderId,
  context: PlatformActivityProviderContext,
  productIds?: ProductIds,
  sectionId?: string,
) {
  return {
    collectionStatus: createPlatformModuleCollectionStatusReads({
      characters: context.characters,
      moduleId,
      organizationVersion: context.organizationVersion,
      sectionId,
      signal: context.signal,
    }),
    coreData: createCoreDataCapability(productIds ?? [], 'activity-provider'),
    logger: createPlatformModuleLogger(moduleId),
    persistence: createPlatformModuleActivityProviderPersistence(
      moduleId,
      providerId,
      context.signal,
      platformActivityProviderTimeoutMilliseconds,
    ),
  }
}
