import type {
  PlatformActivityProviderCapabilities,
  PlatformModuleResourceMaterializationCapabilities,
  PlatformModuleRouteCapabilities,
  PlatformResourceImplementationForProducts,
  PlatformResourceOperationImplementation,
  PlatformResourceCollectionContext,
  PlatformCharacterResourceSubject,
} from '@eve-space/platform-module-contract'

interface RoutePersistence {
  readSnapshot(): Promise<unknown>
}

declare const routeWithProduct: PlatformModuleRouteCapabilities<
  RoutePersistence,
  readonly ['published-type-groups']
>
declare const routeWithoutProducts: PlatformModuleRouteCapabilities<RoutePersistence>
declare const resourceWithProduct: PlatformResourceCollectionContext<
  import('@eve-space/platform-module-contract').PlatformCharacterResourceSubject,
  readonly ['published-type-groups']
>
declare const providerWithoutProducts: PlatformActivityProviderCapabilities<RoutePersistence>
declare const materialization: PlatformModuleResourceMaterializationCapabilities
declare const resourceImplementationWithProduct: PlatformResourceOperationImplementation<
  'operation',
  unknown,
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
