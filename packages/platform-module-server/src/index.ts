import type { PlatformEsiOperationContract } from '@eve-space/platform-module-contract'
import {
  operationRegistry,
  type ExecutableOperationRegistryEntry,
  type StableOperationId,
} from '@evespace/esi-client/operations'

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
