import type { OperationRequestArguments } from '@evespace/esi-client/operations'
import type { CharacterMutationEsiOperation, EsiOperation } from './catalog.js'
import { esiExecutionLayer } from './layer.js'
import type { EsiCharacterMutation, EsiRepresentation } from './representations.js'
import type { EsiCachedResult } from './types.js'

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
  return esiExecutionLayer.executeRepresentation(representation, input)
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
  return esiExecutionLayer.executeMutationRepresentation(representation, input)
}
