import type {
  EsiOperationAuthorization,
  EsiSetOperationConfiguration,
} from '../../src/esi-gateway/catalog-interface.js'
import type { EsiFailure, EsiQuotaRequest } from '../../src/esi-gateway/failures.js'
import type { EsiStatusTelemetry } from '../../src/esi-gateway/status-interface.js'

type AssertNever<Value extends never> = Value

type FailureExports = keyof typeof import('../../src/esi-gateway/failures.js')
type RuntimeLifecycleExports = keyof typeof import('../../src/esi-gateway/runtime-lifecycle.js')
type StatusExports = keyof typeof import('../../src/esi-gateway/status-interface.js')
type CatalogExports = keyof typeof import('../../src/esi-gateway/catalog-interface.js')

type _FailureModuleHidesImplementation = AssertNever<
  Extract<
    FailureExports,
    | 'createRawEsiTransport'
    | 'acquireEsiRequestPermit'
    | 'getCoordinationConnection'
    | 'getCharacterAuthorizationForLifecycle'
    | 'EsiTransportError'
    | 'EsiHttpError'
  >
>
type _LifecycleModuleHidesRuntime = AssertNever<
  Extract<
    RuntimeLifecycleExports,
    | 'getProductionEsiExecutionRuntime'
    | 'createEsiExecutionRuntime'
    | 'createEsiExecutionRuntimeOwner'
  >
>
type _StatusModuleHidesStorage = AssertNever<
  Extract<
    StatusExports,
    | 'getSharedCacheRedisConnection'
    | 'createCoordinationRedisProbe'
    | 'readEsiRateMeasurement'
    | 'probeEsiResilienceTelemetry'
  >
>
type _CatalogModuleHidesRegistries = AssertNever<
  Extract<
    CatalogExports,
    | 'esiOperationCatalog'
    | 'operationRegistry'
    | 'registerCallableEsiRepresentation'
    | 'getEsiOperationContract'
  >
>

type _FailureHidesRawErrors = AssertNever<
  Extract<keyof EsiFailure, 'cause' | 'metadata' | 'headers' | 'dependencyError'>
>
type _QuotaRequestHidesPrincipal = AssertNever<
  Extract<keyof EsiQuotaRequest, 'principal' | 'connection' | 'redisUrl'>
>
type _CatalogAuthorizationHidesPolicy = AssertNever<
  Extract<keyof EsiOperationAuthorization, 'cache' | 'retry' | 'descriptor' | 'metadata'>
>
type _SetConfigurationHidesPolicy = AssertNever<
  Extract<keyof EsiSetOperationConfiguration, 'cache' | 'revalidation' | 'descriptor'>
>
type _StatusHidesSensitiveRoots = AssertNever<
  Extract<
    keyof EsiStatusTelemetry,
    'credentials' | 'principal' | 'redis' | 'redisUrl' | 'cachePayload' | 'envelope'
  >
>

export type EsiPurposeInterfaceSecrecyAssertions =
  | _FailureModuleHidesImplementation
  | _LifecycleModuleHidesRuntime
  | _StatusModuleHidesStorage
  | _CatalogModuleHidesRegistries
  | _FailureHidesRawErrors
  | _QuotaRequestHidesPrincipal
  | _CatalogAuthorizationHidesPolicy
  | _SetConfigurationHidesPolicy
  | _StatusHidesSensitiveRoots
