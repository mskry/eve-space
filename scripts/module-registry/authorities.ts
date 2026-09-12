import {
  platformCoreNavigation,
  platformReservedModuleIds,
  type PlatformModuleValidationAuthorities,
} from '../../packages/platform-module-contract/src/index.js'
import { coreEsiOperationIds } from '../../api/src/esi-gateway/catalog-interface.js'

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
  esiOperationIds: coreEsiOperationIds,
} as const satisfies PlatformModuleValidationAuthorities
