import type { EsiResponse } from '@evespace/esi-client'
import type {
  OperationExecutionDescriptor,
  OperationRequestArguments,
} from '@evespace/esi-client/operations'
import type { CharacterMutationEsiOperation, EsiOperation } from './catalog.js'

const representationBrand: unique symbol = Symbol('EsiRepresentation')

type EsiRepresentationAuthorization = 'public' | 'character'
type EsiRepresentationExecution = 'read' | 'mutation'
type EsiRepresentationRequest<Arguments extends OperationRequestArguments> = Omit<
  Arguments,
  'headers'
> & {
  readonly headers?: never
}

interface EsiRepresentationOptions<
  Operation extends EsiOperation,
  Input,
  Arguments extends OperationRequestArguments,
  WireResult,
  Result,
> {
  operation: Operation
  name: string
  descriptor: OperationExecutionDescriptor<Arguments, WireResult>
  encodeRequest: (input: Input) => EsiRepresentationRequest<Arguments>
  map: (response: EsiResponse<WireResult>, input: Input) => Result | Promise<Result>
}

/** Opaque registered binding between an application representation and one SDK operation. */
export interface EsiRepresentation<
  Authorization extends EsiRepresentationAuthorization,
  Operation extends EsiOperation,
  Input,
  Arguments extends OperationRequestArguments,
  WireResult,
  Result,
  Execution extends EsiRepresentationExecution = 'read',
> {
  readonly [representationBrand]: true
  readonly operation: Operation
  readonly name: string
  readonly authorization: Authorization
  readonly execution: Execution
  readonly descriptor: OperationExecutionDescriptor<Arguments, WireResult>
  encodeRequest(input: Input): EsiRepresentationRequest<Arguments>
  map(response: EsiResponse<WireResult>, input: Input): Result | Promise<Result>
}

export type EsiCharacterRepresentation<
  Operation extends EsiOperation,
  Input,
  Arguments extends OperationRequestArguments,
  WireResult,
  Result,
> = EsiRepresentation<'character', Operation, Input, Arguments, WireResult, Result>

export type EsiCharacterMutation<
  Operation extends CharacterMutationEsiOperation,
  Input,
  Arguments extends OperationRequestArguments,
  WireResult,
  Result,
> = EsiRepresentation<'character', Operation, Input, Arguments, WireResult, Result, 'mutation'>

export type EsiPublicRepresentation<
  Operation extends EsiOperation,
  Input,
  Arguments extends OperationRequestArguments,
  WireResult,
  Result,
> = EsiRepresentation<'public', Operation, Input, Arguments, WireResult, Result>

export function defineCharacterEsiRepresentation<
  Operation extends EsiOperation,
  Input,
  Arguments extends OperationRequestArguments,
  WireResult,
  Result,
>(
  options: EsiRepresentationOptions<Operation, Input, Arguments, WireResult, Result>,
): EsiCharacterRepresentation<Operation, Input, Arguments, WireResult, Result> {
  return defineEsiRepresentation('read', 'character', options)
}

export function defineCharacterEsiMutation<
  Operation extends CharacterMutationEsiOperation,
  Input,
  Arguments extends OperationRequestArguments,
  WireResult,
  Result,
>(
  options: EsiRepresentationOptions<Operation, Input, Arguments, WireResult, Result>,
): EsiCharacterMutation<Operation, Input, Arguments, WireResult, Result> {
  return defineEsiRepresentation('mutation', 'character', options)
}

export function definePublicEsiRepresentation<
  Operation extends EsiOperation,
  Input,
  Arguments extends OperationRequestArguments,
  WireResult,
  Result,
>(
  options: EsiRepresentationOptions<Operation, Input, Arguments, WireResult, Result>,
): EsiPublicRepresentation<Operation, Input, Arguments, WireResult, Result> {
  return defineEsiRepresentation('read', 'public', options)
}

function defineEsiRepresentation<
  Execution extends EsiRepresentationExecution,
  Authorization extends EsiRepresentationAuthorization,
  Operation extends EsiOperation,
  Input,
  Arguments extends OperationRequestArguments,
  WireResult,
  Result,
>(
  execution: Execution,
  authorization: Authorization,
  options: EsiRepresentationOptions<Operation, Input, Arguments, WireResult, Result>,
): EsiRepresentation<Authorization, Operation, Input, Arguments, WireResult, Result, Execution> {
  return {
    [representationBrand]: true,
    operation: options.operation,
    name: options.name,
    authorization,
    execution,
    descriptor: options.descriptor,
    encodeRequest: options.encodeRequest,
    map: options.map,
  }
}
