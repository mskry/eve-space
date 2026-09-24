import { type PlatformModuleCompilationAuthorities } from '@eve-space/platform-module-contract/compiler'
import { platformCoreEsiOperationCatalog } from '@eve-space/platform-module-contract/esi'
import { platformReservedModuleIds } from '@eve-space/platform-module-contract/identifiers'
import { platformCoreNavigation } from '@eve-space/platform-module-contract/nuxt'
import { CORE_DATA_PRODUCT_CONTRACTS } from '../../packages/core-data-contract/src/index.js'
import { memberAuditModulePolicy } from './member-audit-policy.js'

export const coreNavigationDefaults = platformCoreNavigation.map(
  ({ ownerId, navigationId, placement, order }) => ({
    navigationId,
    order,
    ownerId,
    placement,
  }),
)

export const coreModuleValidationAuthorities = {
  coreDataProductContracts: CORE_DATA_PRODUCT_CONTRACTS,
  esiOperationIds: platformCoreEsiOperationCatalog.operationIds,
  navigationIds: coreNavigationDefaults.map(({ navigationId }) => navigationId),
  policies: [memberAuditModulePolicy],
  reservedModuleIds: platformReservedModuleIds,
} as const satisfies PlatformModuleCompilationAuthorities
