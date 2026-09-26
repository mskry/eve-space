import {
  resolveOperationRolePredicate,
  type PlatformCoreEsiOperationId,
  type PlatformEsiOperationContract,
  type platformCoreEsiOperationSdkIdentities,
} from '@eve-space/platform-module-contract/esi'
import type { PlatformResourceOperationContract } from '@eve-space/platform-module-contract/resources'
import {
  operationRegistry,
  type CallOperationArguments,
  type ExecutableOperationRegistryEntry,
  type StableOperationId,
  type CallOperationResult,
} from '@evespace/esi-client/operations'

export * from './cursor.js'
export * from './errors.js'
export * from './persistence.js'
export * from './validation.js'

export type PlatformEsiOperationData<Operation extends StableOperationId> =
  CallOperationResult<Operation>

export type PlatformEsiOperationInput<Operation extends StableOperationId> = Omit<
  CallOperationArguments<Operation>,
  'headers'
>

export type PlatformEsiOperationIdentities = Readonly<Record<string, StableOperationId>>

export type PlatformEsiOperationProtocol<
  Identities extends PlatformEsiOperationIdentities,
  Operations extends keyof Identities & string,
> = {
  readonly [Operation in Operations]: PlatformResourceOperationContract<
    PlatformEsiOperationInput<Identities[Operation]>,
    PlatformEsiOperationData<Identities[Operation]>
  >
}

export type PlatformCoreEsiOperationProtocol<Operations extends PlatformCoreEsiOperationId> =
  PlatformEsiOperationProtocol<typeof platformCoreEsiOperationSdkIdentities, Operations>

export type PlatformExecutableEsiOperationIdentities<
  Definitions extends Readonly<Record<string, PlatformExecutableEsiOperationDefinition>>,
> = {
  readonly [Operation in keyof Definitions]: Definitions[Operation]['sdkOperationId']
}

export type PlatformExecutableEsiOperationProtocol<
  Definitions extends Readonly<Record<string, PlatformExecutableEsiOperationDefinition>>,
  Operations extends keyof Definitions & string,
> = PlatformEsiOperationProtocol<PlatformExecutableEsiOperationIdentities<Definitions>, Operations>

export type PlatformEsiOperationPolicy = Pick<
  PlatformEsiOperationContract,
  'identity' | 'retry' | 'representationVersion'
> & {
  readonly cache:
    | Omit<
        Extract<PlatformEsiOperationContract['cache'], { readonly kind: 'shared' }>,
        'revalidate'
      >
    | { readonly kind: 'none' }
  readonly audit: Omit<PlatformEsiOperationContract['audit'], 'esiOperationId'>
  readonly freshness?: { readonly kind: 'runtime-only' }
}

export interface PlatformExecutableEsiOperationDefinition<
  SdkOperation extends StableOperationId = StableOperationId,
  Contract extends PlatformEsiOperationContract = PlatformEsiOperationContract,
> {
  readonly sdkOperationId: SdkOperation
  readonly descriptor: ExecutableOperationRegistryEntry
  readonly contract: Contract
}

export const definePlatformExecutableEsiOperation = <
  const SdkOperation extends StableOperationId,
  const Policy extends PlatformEsiOperationPolicy,
>(definition: {
  readonly sdkOperationId: SdkOperation
  readonly policy: Policy & {
    readonly authorization?: never
    readonly rateGroup?: never
    readonly compatibility?: never
    readonly responseValidation?: never
  }
}): PlatformExecutableEsiOperationDefinition<
  SdkOperation,
  PlatformEsiOperationContract & {
    readonly audit: Policy['audit'] & { readonly esiOperationId: SdkOperation }
  }
> => {
  const descriptor = operationRegistry[definition.sdkOperationId]
  if (!descriptor) {
    throw new Error(`Unknown ESI SDK operation identity: ${definition.sdkOperationId}`)
  }
  const transport = descriptor.transport
  const allowedPolicyKeys = new Set([
    'audit',
    'cache',
    'freshness',
    'identity',
    'representationVersion',
    'retry',
  ])
  if (Object.keys(definition.policy).some((key) => !allowedPolicyKeys.has(key))) {
    throw new Error(`Module cannot override generated ESI policy: ${definition.sdkOperationId}`)
  }
  const scopes = transport.authentication?.scopes ?? []
  if (scopes.length > 1 || (transport.authentication !== null && scopes.length !== 1)) {
    throw new Error(`Unsupported generated OAuth scopes: ${definition.sdkOperationId}`)
  }
  const requiredRolePredicate = resolveOperationRolePredicate(transport.requiredRoles)
  if (transport.authentication === null && transport.requiredRoles.length > 0) {
    throw new Error(
      `Public operation has generated role requirements: ${definition.sdkOperationId}`,
    )
  }
  if (!transport.minimumCompatibilityDate) {
    throw new Error(`Missing generated compatibility date: ${definition.sdkOperationId}`)
  }
  const cacheAge = transport.protocol.cache.extensions['x-cache-age']
  const freshness =
    definition.policy.freshness ??
    (cacheAge === undefined
      ? { kind: 'none' as const }
      : { kind: 'relative' as const, seconds: cacheAge })
  return {
    contract: {
      ...definition.policy,
      authorization:
        scopes.length === 0
          ? {
              kind: 'public',
              subjectBindings: transport.requestSubjectBindings,
              requiredRolePredicate: null,
            }
          : {
              kind: 'oauth',
              scope: scopes[0]!,
              subjectBindings: transport.requestSubjectBindings,
              requiredRolePredicate,
            },
      cache:
        definition.policy.cache.kind === 'shared'
          ? {
              ...definition.policy.cache,
              revalidate: transport.protocol.conditionalRequestValidators.length > 0,
            }
          : definition.policy.cache,
      compatibility: { minimumDate: transport.minimumCompatibilityDate },
      freshness,
      rateGroup: transport.protocol.rateLimit,
      responseValidation: { kind: 'enabled' },
      audit: {
        ...definition.policy.audit,
        esiOperationId: definition.sdkOperationId,
      },
    },
    descriptor,
    sdkOperationId: definition.sdkOperationId,
  }
}
