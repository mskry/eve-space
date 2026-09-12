import type { EsiResponse } from '@evespace/esi-client'
import type {
  OperationExecutionDescriptor,
  OperationRequestArguments,
} from '@evespace/esi-client/operations'
import { getEsiOperationContract } from './internal/catalog-access.js'
import type { CharacterMutationEsiOperation, EsiOperation } from './internal/catalog.js'
import { getProductionEsiExecutionRuntime } from './internal/production-runtime.js'
import { registerCallableEsiRepresentation } from './internal/representation-registry.js'
import { combineEsiResultMetadata } from './internal/result-metadata.js'
import {
  defineCharacterEsiMutation,
  defineCharacterEsiRepresentation,
  definePublicEsiRepresentation,
} from './internal/representations.js'
import type { EsiCachedResult, EsiLoadResult } from './internal/types.js'

declare const registeredEsiCallableBrand: unique symbol

type ReadEsiOperation = Exclude<EsiOperation, CharacterMutationEsiOperation>
type EsiFeatureRequest<Arguments extends OperationRequestArguments> = Omit<Arguments, 'headers'> & {
  readonly headers?: never
}

interface EsiReadDefinition<
  Operation extends ReadEsiOperation,
  Input,
  Arguments extends OperationRequestArguments,
  WireResult,
  Result,
> {
  readonly operation: Operation
  readonly name: string
  readonly descriptor: OperationExecutionDescriptor<Arguments, WireResult>
  readonly encodeRequest: (input: Input) => EsiFeatureRequest<Arguments>
  readonly map: (response: EsiResponse<WireResult>, input: Input) => Result | Promise<Result>
  readonly recover?: (error: unknown, input: Input) => EsiLoadResult<Result> | undefined
}

export interface EsiPublicReadDefinition<
  Operation extends ReadEsiOperation,
  Input,
  Arguments extends OperationRequestArguments,
  WireResult,
  Result,
> extends EsiReadDefinition<Operation, Input, Arguments, WireResult, Result> {}

export interface EsiCharacterExecutionInput {
  readonly subjectLifecycleId: string
  readonly signal?: AbortSignal
}

export interface EsiCharacterReadDefinition<
  Operation extends ReadEsiOperation,
  Input extends EsiCharacterExecutionInput,
  Arguments extends OperationRequestArguments,
  WireResult,
  Result,
> extends EsiReadDefinition<Operation, Input, Arguments, WireResult, Result> {}

export interface EsiCharacterMutationDefinition<
  Operation extends CharacterMutationEsiOperation,
  Input extends EsiCharacterExecutionInput,
  Arguments extends OperationRequestArguments,
  WireResult,
  Result,
> {
  readonly operation: Operation
  readonly name: string
  readonly descriptor: OperationExecutionDescriptor<Arguments, WireResult>
  readonly encodeRequest: (input: Input) => EsiFeatureRequest<Arguments>
  readonly map: (response: EsiResponse<WireResult>, input: Input) => Result | Promise<Result>
}

/** @public */
export interface EsiReadQuota {
  readonly group?: string
  readonly limit?: string
  readonly remaining?: number
  readonly used?: number
  readonly errorRemaining?: number
  readonly errorResetSeconds?: number
}

export interface EsiReadResultMetadata {
  readonly validatedAt: string
  readonly cachedUntil: string
  readonly stale: boolean
  readonly retryAt?: string
  readonly refreshFailureClass?: 'esi-cooldown' | 'esi-unavailable' | 'response-invalid' | 'unknown'
}

export interface EsiReadResult<Data> extends EsiReadResultMetadata {
  readonly data: Data
  readonly source: 'esi' | 'cache' | 'not-modified'
  readonly quota: EsiReadQuota
}

export interface RegisteredPublicEsiRead<Operation extends ReadEsiOperation, Input, Result> {
  readonly [registeredEsiCallableBrand]: true
  readonly operation: Operation
  readonly requiredScope: null
  execute(input: Input): Promise<EsiReadResult<Result>>
}

export interface RegisteredCharacterEsiRead<
  Operation extends ReadEsiOperation,
  Input extends EsiCharacterExecutionInput,
  Result,
> {
  readonly [registeredEsiCallableBrand]: true
  readonly operation: Operation
  readonly requiredScope: string
  execute(input: Input): Promise<EsiReadResult<Result>>
}

export interface RegisteredCharacterEsiMutation<
  Operation extends CharacterMutationEsiOperation,
  Input extends EsiCharacterExecutionInput,
  Result,
> {
  readonly [registeredEsiCallableBrand]: true
  readonly operation: Operation
  readonly requiredScope: string
  execute(input: Input): Promise<Result>
}

export function createPublicEsiRead<
  Operation extends ReadEsiOperation,
  Input,
  Arguments extends OperationRequestArguments,
  WireResult,
  Result,
>(
  definition: EsiPublicReadDefinition<Operation, Input, Arguments, WireResult, Result>,
): RegisteredPublicEsiRead<Operation, Input, Result> {
  const representation = registerCallableEsiRepresentation(
    definePublicEsiRepresentation(definition),
  )
  return Object.freeze({
    operation: representation.operation,
    requiredScope: null,
    execute: async (input: Input) => {
      const signal = publicExecutionSignal(input)
      return toEsiReadResult(
        await (
          await getProductionEsiExecutionRuntime()
        ).executeRepresentation(representation, input, signal ? { signal } : undefined),
      )
    },
  }) as RegisteredPublicEsiRead<Operation, Input, Result>
}

export { combineEsiResultMetadata }
export type { EsiResultMetadata } from './internal/types.js'

export function toEsiReadResultMetadata(result: EsiReadResult<unknown>): EsiReadResultMetadata {
  return {
    validatedAt: result.validatedAt,
    cachedUntil: result.cachedUntil,
    stale: result.stale,
    ...(result.retryAt ? { retryAt: result.retryAt } : {}),
    ...(result.refreshFailureClass ? { refreshFailureClass: result.refreshFailureClass } : {}),
  }
}

export function combineEsiReadResultMetadata(
  results: readonly EsiReadResultMetadata[],
): EsiReadResultMetadata {
  return combineEsiResultMetadata(results)
}

export function createCharacterEsiRead<
  Operation extends ReadEsiOperation,
  Input extends EsiCharacterExecutionInput,
  Arguments extends OperationRequestArguments,
  WireResult,
  Result,
>(
  definition: EsiCharacterReadDefinition<Operation, Input, Arguments, WireResult, Result>,
): RegisteredCharacterEsiRead<Operation, Input, Result> {
  const requiredScope = getRequiredCharacterScope(definition.operation)
  const representation = registerCallableEsiRepresentation(
    defineCharacterEsiRepresentation(definition),
  )
  return Object.freeze({
    operation: representation.operation,
    requiredScope,
    execute: async (input: Input) =>
      toEsiReadResult(
        await (
          await getProductionEsiExecutionRuntime()
        ).executeRepresentation(representation, input, {
          subjectLifecycleId: input.subjectLifecycleId,
          ...(input.signal ? { signal: input.signal } : {}),
        }),
      ),
  }) as RegisteredCharacterEsiRead<Operation, Input, Result>
}

export function createCharacterEsiMutation<
  Operation extends CharacterMutationEsiOperation,
  Input extends EsiCharacterExecutionInput,
  Arguments extends OperationRequestArguments,
  WireResult,
  Result,
>(
  definition: EsiCharacterMutationDefinition<Operation, Input, Arguments, WireResult, Result>,
): RegisteredCharacterEsiMutation<Operation, Input, Result> {
  const requiredScope = getRequiredCharacterScope(definition.operation)
  const representation = registerCallableEsiRepresentation(defineCharacterEsiMutation(definition))
  return Object.freeze({
    operation: representation.operation,
    requiredScope,
    execute: (input: Input) =>
      getProductionEsiExecutionRuntime().then((runtime) =>
        runtime.executeMutationRepresentation(representation, input, {
          subjectLifecycleId: input.subjectLifecycleId,
          ...(input.signal ? { signal: input.signal } : {}),
        }),
      ),
  }) as RegisteredCharacterEsiMutation<Operation, Input, Result>
}

function getRequiredCharacterScope(operation: EsiOperation) {
  const authorization = getEsiOperationContract(operation)?.authorization
  if (authorization?.kind !== 'character')
    throw new Error(`ESI operation ${operation} does not declare character authorization`)
  return authorization.scope
}

function publicExecutionSignal(input: unknown) {
  if (typeof input !== 'object' || input === null || !('signal' in input)) return undefined
  return (input as { readonly signal?: AbortSignal }).signal
}

function toEsiReadResult<Data>(result: EsiCachedResult<Data>): EsiReadResult<Data> {
  return {
    data: result.data,
    source: result.source,
    validatedAt: result.validatedAt,
    cachedUntil: result.cachedUntil,
    stale: result.stale,
    ...(result.retryAt ? { retryAt: result.retryAt } : {}),
    ...(result.refreshFailureClass ? { refreshFailureClass: result.refreshFailureClass } : {}),
    quota: { ...result.quota },
  }
}
