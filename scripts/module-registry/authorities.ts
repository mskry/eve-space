import {
  platformCoreNavigation,
  platformReservedModuleIds,
  type PlatformModuleValidationAuthorities,
} from '../../packages/platform-module-contract/src/index.js'
import { esiOperationMetadata } from '../../api/src/esi-resilience/operation-metadata.js'

export const coreNavigationDefaults = platformCoreNavigation.map(
  ({ ownerId, navigationId, placement, order }) => ({
    ownerId,
    navigationId,
    placement,
    order,
  }),
)

export const coreModuleValidationAuthorities = {
  reservedModuleIds: platformReservedModuleIds,
  navigationIds: coreNavigationDefaults.map(({ navigationId }) => navigationId),
  esiOperationIds: Object.keys(esiOperationMetadata),
} as const satisfies PlatformModuleValidationAuthorities
