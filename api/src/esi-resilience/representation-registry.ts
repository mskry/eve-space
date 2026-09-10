import { operationRegistry, type OperationRequestArguments } from '@evespace/esi-client/operations'
import { getEsiOperationContract } from './catalog-access.js'
import type { EsiOperation } from './catalog.js'
import { assertConsistentEsiRepresentationRegistration } from './catalog-validation.js'
import type { EsiRepresentation } from './representations.js'

const representationsByName = new Map<string, object>()

export function registerEsiRepresentation<
  Execution extends 'read' | 'mutation',
  Authorization extends 'public' | 'character',
  Operation extends EsiOperation,
  Input,
  Arguments extends OperationRequestArguments,
  WireResult,
  Result,
>(
  representation: EsiRepresentation<
    Authorization,
    Operation,
    Input,
    Arguments,
    WireResult,
    Result,
    Execution
  >,
): EsiRepresentation<Authorization, Operation, Input, Arguments, WireResult, Result, Execution> {
  assertConsistentEsiRepresentationRegistration(
    {
      name: representation.name,
      operation: representation.operation,
      authorization: representation.authorization,
      execution: representation.execution,
      descriptorOperationId: representation.descriptor.operationId,
    },
    {
      duplicateName: representationsByName.has(representation.name),
      descriptorRegistered: Object.values(operationRegistry).some(
        ({ transport }) => transport === representation.descriptor,
      ),
      contract: getEsiOperationContract(representation.operation),
    },
  )
  representationsByName.set(representation.name, representation)
  return representation
}

/** Guards execution against a representation object that skipped registration. */
export function isRegisteredEsiRepresentation(representation: { readonly name: string }) {
  return representationsByName.get(representation.name) === representation
}
