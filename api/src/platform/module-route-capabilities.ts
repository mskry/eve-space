import type { CoreDataProductId } from '@eve-space/core-data-contract'
import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract'
import { createCoreDataCapability } from '../core-data/capabilities.js'
import { createPlatformModuleLogger } from './module-logging.js'
import {
  createPlatformModuleRoutePersistence,
  createPlatformResourceProjectionPersistence,
} from './module-persistence-capabilities.js'

export function createPlatformModuleRouteCapabilities<
  const ModuleId extends string,
  const RouteId extends string,
  const ProductIds extends readonly CoreDataProductId[] = readonly [],
>(moduleId: ModuleId, routeId: RouteId, productIds: ProductIds = [] as unknown as ProductIds) {
  return {
    coreData: createCoreDataCapability(productIds, 'route'),
    logger: createPlatformModuleLogger(moduleId),
    persistence: createPlatformModuleRoutePersistence(moduleId, routeId),
  }
}

export function createPlatformResourceReadCapabilities<
  const Resource extends PlatformInstalledResourceDescriptor,
>(resource: Resource, signal?: AbortSignal) {
  const moduleId = resource.moduleId
  const productIds = (resource.coreDataProducts ?? []) as ResourceProductIds<Resource>
  return {
    coreData: createCoreDataCapability(productIds, 'resource-projection'),
    logger: createPlatformModuleLogger(moduleId),
    persistence: createPlatformResourceProjectionPersistence(moduleId, resource.resourceId, signal),
  }
}

type ResourceProductIds<Resource extends PlatformInstalledResourceDescriptor> =
  NonNullable<Resource['coreDataProducts']> extends readonly CoreDataProductId[]
    ? NonNullable<Resource['coreDataProducts']>
    : readonly []
