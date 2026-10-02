import type { CoreDataProductId } from '@eve-space/core-data-contract'
import type { ReadAdmissionWork } from '../auth/read-work.js'
import type { PlatformInstalledReviewerContributionDescriptor } from '@eve-space/platform-module-contract/installed'
import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract/resources'
import { createCoreDataCapability } from '../core-data/capabilities.js'
import { createPlatformModuleLogger } from './module-logging.js'
import {
  createPlatformModuleReadPersistence,
  createPlatformModuleRoutePersistence,
  createPlatformResourceProjectionPersistence,
  type ModuleReadPersistenceDeclaration,
} from './module-persistence-capabilities.js'
import { guardReadCapabilities, type ReadCapabilityGuard } from './guarded-read-capabilities.js'

export const createPlatformModuleReadCapabilities = <
  const ProductIds extends readonly CoreDataProductId[],
>(
  declaration: ModuleReadPersistenceDeclaration,
  productIds: ProductIds,
  guard: ReadCapabilityGuard,
  signal?: AbortSignal,
  work?: ReadAdmissionWork,
) =>
  Object.freeze({
    coreData: guardReadCapabilities(
      createCoreDataCapability(
        productIds,
        declaration.grant === 'graphqlReads' ? 'graphql-read' : 'route',
        signal,
      ),
      guard,
      work,
    ),
    persistence: guardReadCapabilities(
      createPlatformModuleReadPersistence(declaration, signal),
      guard,
      work,
    ),
  })

export const createPlatformPublicRouteCapabilities = <
  const ModuleId extends string,
  const RouteId extends string,
  const ProductIds extends readonly CoreDataProductId[] = readonly [],
>(
  moduleId: ModuleId,
  routeId: RouteId,
  productIds?: ProductIds,
) => ({
  coreData: createCoreDataCapability(productIds ?? [], 'route'),
  logger: createPlatformModuleLogger(moduleId),
  persistence: createPlatformModuleRoutePersistence(moduleId, routeId),
})

export function createPlatformModuleRouteCapabilities<
  const ModuleId extends string,
  const RouteId extends string,
  const ProductIds extends readonly CoreDataProductId[] = readonly [],
>(moduleId: ModuleId, routeId: RouteId, productIds?: ProductIds) {
  return {
    coreData: createCoreDataCapability(productIds ?? [], 'route'),
    logger: createPlatformModuleLogger(moduleId),
    persistence: createPlatformModuleRoutePersistence(moduleId, routeId),
  }
}

export function createPlatformReviewerContributionRouteCapabilities<
  const Descriptor extends Pick<PlatformInstalledReviewerContributionDescriptor, 'moduleId'>,
  const ProductIds extends readonly CoreDataProductId[] = readonly [],
>(descriptor: Descriptor, productIds?: ProductIds) {
  return {
    coreData: createCoreDataCapability(productIds ?? [], 'route'),
    logger: createPlatformModuleLogger(descriptor.moduleId),
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

export function createPlatformResourceMappingCapabilities<
  const Resource extends PlatformInstalledResourceDescriptor,
>(resource: Resource) {
  const productIds = (resource.coreDataProducts ?? []) as ResourceProductIds<Resource>
  return {
    coreData: createCoreDataCapability(productIds, 'resource-projection'),
  }
}

type ResourceProductIds<Resource extends PlatformInstalledResourceDescriptor> =
  NonNullable<Resource['coreDataProducts']> extends readonly CoreDataProductId[]
    ? NonNullable<Resource['coreDataProducts']>
    : readonly []
