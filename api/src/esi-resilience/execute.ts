import { EsiClient, type EsiResponse } from '@evespace/esi-client'
import type { OperationRequestArguments, StableOperationId } from '@evespace/esi-client/operations'
import { isRecord } from '../type-guards.js'
import { dispatchApprovedEsiMutation } from './approved-mutation-adapter.js'
import { getEsiOperationContract } from './catalog-access.js'
import type { CharacterMutationEsiOperation, EsiOperation } from './catalog.js'
import {
  getEsiResilienceLayer,
  type CharacterEsiOperation,
  type CharacterEsiResource,
  type PublicEsiOperation,
  type ResilientEsiResource,
} from './layer.js'
import { isRegisteredEsiRepresentation } from './representation-registry.js'
import type { EsiCharacterMutation, EsiRepresentation } from './representations.js'
import { assertNoCallerEsiRevalidationHeaders, withEsiRevalidation } from './revalidation.js'
import { createEsiTransport } from './request-transport.js'
import type { EsiCachedResult, EsiRevalidation } from './types.js'

export async function execute<
  Authorization extends 'public' | 'character',
  Operation extends EsiOperation,
  Input,
  Arguments extends OperationRequestArguments,
  WireResult,
  Result,
>(
  representation: EsiRepresentation<Authorization, Operation, Input, Arguments, WireResult, Result>,
  input: Input,
): Promise<EsiCachedResult<Result>> {
  if (!isRegisteredEsiRepresentation(representation))
    throw new Error(`ESI representation ${representation.name} was not registered`)

  const request = representation.encodeRequest(input)
  assertNoCallerEsiRevalidationHeaders(request)
  const load = async (
    revalidation: EsiRevalidation,
    authorization?: { readonly accessToken: string; readonly principal: string },
  ) => {
    const policy = getEsiOperationContract(representation.operation)
    const client = new EsiClient({
      fetch: createEsiTransport(representation.operation, authorization?.principal),
      ...(authorization ? { token: authorization.accessToken } : {}),
      validateResponses: policy.responseValidation.kind === 'enabled',
    })
    let response: EsiResponse<WireResult>
    try {
      response = (await client.callOperation(
        representation.descriptor.operationId as StableOperationId,
        withEsiRevalidation(request, revalidation) as never,
      )) as unknown as EsiResponse<WireResult>
    } catch (error) {
      const recovered = representation.recover?.(error, input)
      if (!recovered) throw error
      return recovered
    }
    return { data: await representation.map(response, input), meta: response.meta }
  }
  const resilience = getEsiResilienceLayer()
  if (representation.authorization === 'public') {
    const resource: ResilientEsiResource<PublicEsiOperation, Result> = {
      operation: representation.operation as PublicEsiOperation,
      inputs: request,
      load: (revalidation) => load(revalidation),
    }
    return resilience.executePublicRepresentation(representation, resource)
  }
  const resource: CharacterEsiResource<Result> = {
    operation: representation.operation as CharacterEsiOperation,
    characterId: characterIdFromRequest(request),
    inputs: request,
    load: (authorization, revalidation) => load(revalidation, authorization),
  }
  return resilience.executeCharacterRepresentation(representation, resource)
}

export async function executeMutation<
  Operation extends CharacterMutationEsiOperation,
  Input,
  Arguments extends OperationRequestArguments,
  WireResult,
  Result,
>(
  representation: EsiCharacterMutation<Operation, Input, Arguments, WireResult, Result>,
  input: Input,
): Promise<Result> {
  if (!isRegisteredEsiRepresentation(representation))
    throw new Error(`ESI representation ${representation.name} was not registered`)

  const policy = getEsiOperationContract(representation.operation)
  if (!policy.mutation)
    throw new Error(`ESI operation ${representation.operation} is not a catalog-declared mutation`)
  const request = representation.encodeRequest(input)
  assertNoCallerEsiRevalidationHeaders(request)
  const resilience = getEsiResilienceLayer()
  const result = await resilience.executeCharacterMutationRepresentation(representation, {
    operation: representation.operation,
    characterId: characterIdFromRequest(request),
    load: (authorization) =>
      dispatchApprovedEsiMutation(representation, request, input, authorization),
  })
  return result.data
}

function characterIdFromRequest(request: OperationRequestArguments) {
  const characterId = isRecord(request.path) ? request.path.character_id : undefined
  if (!Number.isSafeInteger(characterId)) throw new Error('Character ESI identity is invalid')
  return Number(characterId)
}
