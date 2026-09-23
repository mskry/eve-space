import type { PlatformActivityProviderCapabilities } from '@eve-space/platform-module-contract/activity'
import type {
  PlatformModuleResourceMaterializationCapabilities,
  PlatformBoundedCollectionResourceImplementation,
  PlatformResourceImplementationForProducts,
  PlatformResourceCollectionContext,
  PlatformCharacterResourceSubject,
  PlatformResourceOperationContract,
} from '@eve-space/platform-module-contract/resources'
import type { PlatformModuleRouteCapabilities } from '@eve-space/platform-module-contract/server'

interface RoutePersistence {
  readSnapshot(): Promise<unknown>
}

declare const routeWithProduct: PlatformModuleRouteCapabilities<
  RoutePersistence,
  readonly ['published-type-groups']
>
declare const routeWithoutProducts: PlatformModuleRouteCapabilities<RoutePersistence>
type OperationProtocol = { readonly operation: PlatformResourceOperationContract }

declare const resourceWithProduct: PlatformResourceCollectionContext<
  PlatformCharacterResourceSubject,
  OperationProtocol,
  readonly ['published-type-groups']
>
declare const providerWithoutProducts: PlatformActivityProviderCapabilities<RoutePersistence>
declare const materialization: PlatformModuleResourceMaterializationCapabilities
declare const resourceImplementationWithProduct: PlatformBoundedCollectionResourceImplementation<
  'operation',
  OperationProtocol,
  unknown,
  string,
  unknown,
  PlatformCharacterResourceSubject,
  readonly ['published-type-groups']
>

void routeWithProduct.coreData.publishedTypeGroups({ typeIds: [34] })
void routeWithProduct.persistence.readSnapshot()
void resourceWithProduct.capabilities.coreData.publishedTypeGroups({ typeIds: [34] })

// @ts-expect-error contributions that omit products receive no product methods
void routeWithoutProducts.coreData.publishedTypeGroups({ typeIds: [34] })
// @ts-expect-error provider declarations do not inherit route products
void providerWithoutProducts.coreData.publishedTypeGroups({ typeIds: [34] })
// @ts-expect-error materialization cannot read core data after persistence begins
void materialization.coreData
void (resourceImplementationWithProduct satisfies PlatformResourceImplementationForProducts<
  typeof resourceImplementationWithProduct,
  readonly ['published-type-groups']
>)
// @ts-expect-error generated resource descriptors reject manifest/implementation product drift
void (resourceImplementationWithProduct satisfies PlatformResourceImplementationForProducts<
  typeof resourceImplementationWithProduct,
  readonly []
>)
