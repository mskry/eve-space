import type {
  PlatformCoreEsiOperationId,
  PlatformEsiOperationContract,
  platformCoreEsiOperationSdkIdentities,
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

export type PlatformEsiOperationPolicy = Omit<PlatformEsiOperationContract, 'audit'> & {
  readonly audit: Omit<PlatformEsiOperationContract['audit'], 'esiOperationId'>
}

export interface PlatformExecutableEsiOperationDefinition<
  SdkOperation extends StableOperationId = StableOperationId,
  Contract extends PlatformEsiOperationContract = PlatformEsiOperationContract,
> {
  readonly sdkOperationId: SdkOperation
  readonly descriptor: ExecutableOperationRegistryEntry
  readonly contract: Contract
}

export function definePlatformExecutableEsiOperation<
  const SdkOperation extends StableOperationId,
  const Policy extends PlatformEsiOperationPolicy,
>(definition: {
  readonly sdkOperationId: SdkOperation
  readonly policy: Policy
}): PlatformExecutableEsiOperationDefinition<
  SdkOperation,
  Policy & { readonly audit: Policy['audit'] & { readonly esiOperationId: SdkOperation } }
> {
  const descriptor = operationRegistry[definition.sdkOperationId]
  if (!descriptor)
    throw new Error(`Unknown ESI SDK operation identity: ${definition.sdkOperationId}`)
  return {
    sdkOperationId: definition.sdkOperationId,
    descriptor,
    contract: {
      ...definition.policy,
      audit: {
        ...definition.policy.audit,
        esiOperationId: definition.sdkOperationId,
      },
    },
  }
}
