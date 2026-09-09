import { getEsiOperationContract } from './catalog-access.js'
import type { EsiOperation } from './catalog.js'
import { assertConsistentEsiRepresentationRegistration } from './catalog-validation.js'
import type { EsiCharacterRepresentation } from './representations.js'

const representationsByName = new Map<
  string,
  EsiCharacterRepresentation<EsiOperation, unknown, unknown>
>()
const representationNamesByOperation = new Map<EsiOperation, Set<string>>()

export function registerCharacterEsiRepresentation<Operation extends EsiOperation, Input, Result>(
  representation: EsiCharacterRepresentation<Operation, Input, Result>,
): EsiCharacterRepresentation<Operation, Input, Result> {
  assertConsistentEsiRepresentationRegistration(
    {
      name: representation.name,
      operation: representation.operation,
      authorization: representation.authorization,
    },
    {
      duplicateName: representationsByName.has(representation.name),
      contract: getEsiOperationContract(representation.operation),
    },
  )
  representationsByName.set(
    representation.name,
    representation as EsiCharacterRepresentation<EsiOperation, unknown, unknown>,
  )
  const namesForOperation =
    representationNamesByOperation.get(representation.operation) ?? new Set()
  namesForOperation.add(representation.name)
  representationNamesByOperation.set(representation.operation, namesForOperation)
  return representation
}

/** Guards against calling `execute` with a representation object that skipped registration. */
export function isRegisteredEsiRepresentation(
  representation: EsiCharacterRepresentation<EsiOperation, unknown, unknown>,
) {
  return representationsByName.get(representation.name) === representation
}

/**
 * Cache identity is keyed per representation, not per operation, so once a second representation
 * of one operation is registered this must become a per-call lookup instead of a per-operation one.
 */
export function getSoleRegisteredEsiRepresentationName(
  operation: EsiOperation,
): string | undefined {
  const names = representationNamesByOperation.get(operation)
  if (!names || names.size === 0) return undefined
  if (names.size > 1)
    throw new Error(
      `ESI operation ${operation} has multiple registered representations; the shared execution layer cannot disambiguate cache identity per call`,
    )
  const [name] = names
  return name
}
