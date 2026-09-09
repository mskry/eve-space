import type { EsiOperation } from './catalog.js'
import {
  getEsiResilienceLayer,
  type CharacterEsiOperation,
  type CharacterEsiResource,
} from './layer.js'
import { isRegisteredEsiRepresentation } from './representation-registry.js'
import type { EsiCharacterRepresentation } from './representations.js'
import type { EsiCachedResult } from './types.js'

/**
 * Feature code's only ESI entry point: it supplies a registered representation and typed input,
 * never a raw transport, cache policy, or layer method. This calls the existing layer machinery
 * rather than reimplementing caching, retry, collapse, fencing, or cooldowns.
 */
export async function execute<Operation extends CharacterEsiOperation, Input, Result>(
  representation: EsiCharacterRepresentation<Operation, Input, Result>,
  input: Input,
): Promise<EsiCachedResult<Result>> {
  if (
    !isRegisteredEsiRepresentation(
      representation as EsiCharacterRepresentation<EsiOperation, unknown, unknown>,
    )
  )
    throw new Error(`ESI representation ${representation.name} was not registered`)

  const resource: CharacterEsiResource<Result> = {
    operation: representation.operation,
    inputs: representation.encodeIdentity(input),
    load: (authority, revalidation) => representation.load(input, authority, revalidation),
  }
  return getEsiResilienceLayer().getCharacter(resource)
}
