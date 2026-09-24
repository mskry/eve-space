import { operationRegistry, type OperationRequestArguments } from '@evespace/esi-client/operations'
import { getEsiOperationContract } from './catalog-access.js'
import type { EsiOperation } from './catalog.js'
import { assertConsistentEsiRepresentationRegistration } from './catalog-validation.js'
import type { EsiRepresentation } from './representations.js'

const representationsByName = new Map<string, object>()

export function registerCallableEsiRepresentation<
  Execution extends 'read' | 'mutation',
  Authorization extends 'public' | 'character',
  Operation extends EsiOperation,
  Input,
  Arguments extends OperationRequestArguments,
  WireResult,
  Result,
  Representation extends EsiRepresentation<
    Authorization,
    Operation,
    Input,
    Arguments,
    WireResult,
    Result,
    Execution
  >,
>(representation: Representation): Representation {
  const sdkOperation = Object.values(operationRegistry).find(
    ({ transport }) => transport === representation.descriptor,
  )
  assertConsistentEsiRepresentationRegistration(
    {
      authorization: representation.authorization,
      descriptorOperationId: representation.descriptor.operationId,
      execution: representation.execution,
      name: representation.name,
      operation: representation.operation,
    },
    {
      contract: getEsiOperationContract(representation.operation),
      descriptorClassification: sdkOperation?.classification,
      descriptorRegistered: sdkOperation !== undefined,
      duplicateName: representationsByName.has(representation.name),
    },
  )
  representationsByName.set(representation.name, representation)
  return representation
}

/** Guards execution against a representation object that skipped registration. */
export function isRegisteredEsiRepresentation(representation: { readonly name: string }) {
  return representationsByName.get(representation.name) === representation
}
