import { EsiClient, type EsiResponse } from '@evespace/esi-client'
import type { OperationRequestArguments, StableOperationId } from '@evespace/esi-client/operations'
import { assertRegisteredEsiOperation, getEsiOperationContract } from './catalog-access.js'
import type { CharacterMutationEsiOperation } from './catalog.js'
import type { EsiCharacterMutation } from './representations.js'
import { createEsiTransport } from './request-transport.js'
import type { EsiLoadResult } from './types.js'

export async function dispatchApprovedEsiMutation<
  Operation extends CharacterMutationEsiOperation,
  Input,
  Arguments extends OperationRequestArguments,
  WireResult,
  Result,
>(
  representation: EsiCharacterMutation<Operation, Input, Arguments, WireResult, Result>,
  request: OperationRequestArguments,
  input: Input,
  authorization: { readonly accessToken: string; readonly principal: string },
): Promise<EsiLoadResult<Result>> {
  assertRegisteredEsiOperation(representation.operation)
  const policy = getEsiOperationContract(representation.operation)
  if (!policy.mutation)
    throw new Error(`ESI operation ${representation.operation} is not a catalog-declared mutation`)

  const client = new EsiClient({
    fetch: createEsiTransport(representation.operation, authorization.principal),
    token: authorization.accessToken,
    validateResponses: policy.responseValidation.kind === 'enabled',
    allowGenericMutations: true,
  })
  const response = (await client.callOperation(
    representation.descriptor.operationId as StableOperationId,
    request as never,
    { confirmMutation: true },
  )) as unknown as EsiResponse<WireResult>
  return { data: await representation.map(response, input), meta: response.meta }
}
