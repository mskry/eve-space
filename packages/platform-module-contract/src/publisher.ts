import { CORE_DATA_PRODUCT_CONTRACTS } from '@eve-space/core-data-contract'
import {
  compilePlatformModules,
  readCompiledPlatformModules,
  type PlatformModuleCompilationAuthorities,
} from './compiler.js'
import { platformCoreEsiOperationCatalog } from './esi.js'
import { platformReservedModuleIds } from './identifiers.js'
import type { PlatformModuleManifest } from './manifest.js'
import { platformCoreNavigation } from './nuxt.js'

export const platformModulePublisherAuthorities = {
  coreDataProductContracts: CORE_DATA_PRODUCT_CONTRACTS,
  esiOperationIds: platformCoreEsiOperationCatalog.operationIds,
  navigationIds: platformCoreNavigation.map(({ navigationId }) => navigationId),
  policies: [],
  reservedModuleIds: platformReservedModuleIds,
} as const satisfies PlatformModuleCompilationAuthorities

export function canonicalizePlatformModuleManifest(
  declaration: PlatformModuleManifest,
  authorities: PlatformModuleCompilationAuthorities = platformModulePublisherAuthorities,
) {
  const expectedModuleId = typeof declaration?.id === 'string' ? declaration.id : 'unknown'
  const expectedPublisherPackage =
    typeof declaration?.release?.publisherPackage === 'string'
      ? declaration.release.publisherPackage
      : undefined
  const compiled = compilePlatformModules(
    [
      {
        declaration,
        expectedModuleId,
        expectedPublisherPackage,
      },
    ],
    authorities,
  )
  return `${JSON.stringify(readCompiledPlatformModules(compiled)[0], null, 2)}\n`
}
