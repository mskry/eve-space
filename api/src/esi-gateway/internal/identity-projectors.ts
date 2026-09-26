import type { OperationRequestArguments } from '@evespace/esi-client/operations'
import { isRecord } from '../../type-guards.js'
import type { EsiOperation } from './catalog.js'
import { getGeneratedEsiMaximumBatchSize } from './operation-metadata.js'

type ArrayBodyEsiOperation =
  | 'bulk-affiliation'
  | 'character-asset-names'
  | 'character-cspa-charge'
  | 'universe-resolve-ids'
  | 'universe-resolve-names'

export interface ProjectedEsiRequestIdentity {
  readonly characterId?: unknown
  readonly characterIds?: readonly unknown[]
  readonly itemIds?: readonly unknown[]
  readonly ids?: readonly unknown[]
  readonly names?: readonly unknown[]
}

type EsiRequestIdentityProjector = (
  inputs: OperationRequestArguments,
) => ProjectedEsiRequestIdentity

const arrayBodyIdentityProjectors = {
  'bulk-affiliation': (inputs) => ({
    characterIds: requireArrayBody(inputs, 'bulk-affiliation'),
  }),
  'character-asset-names': (inputs) => ({
    characterId: readPathField(inputs, 'character_id'),
    itemIds: requireArrayBody(inputs, 'character-asset-names'),
  }),
  'character-cspa-charge': (inputs) => {
    assertBoundedIntegerBody(
      requireArrayBody(inputs, 'character-cspa-charge'),
      getGeneratedEsiMaximumBatchSize('character-cspa-charge'),
      'character-cspa-charge',
    )
    return { characterId: readPathField(inputs, 'character_id') }
  },
  'universe-resolve-ids': (inputs) => ({
    names: requireArrayBody(inputs, 'universe-resolve-ids'),
  }),
  'universe-resolve-names': (inputs) => ({
    ids: requireArrayBody(inputs, 'universe-resolve-names'),
  }),
} satisfies Record<ArrayBodyEsiOperation, EsiRequestIdentityProjector>

export function projectRegisteredEsiRequestIdentity(
  operation: EsiOperation,
  inputs: OperationRequestArguments,
) {
  const projector = (
    arrayBodyIdentityProjectors as Partial<Record<EsiOperation, EsiRequestIdentityProjector>>
  )[operation]
  return projector?.(inputs)
}

function requireArrayBody(inputs: OperationRequestArguments, operation: string) {
  const body = inputs.body
  if (!Array.isArray(body)) {
    throw new TypeError(`ESI identity request body for ${operation} must be an array`)
  }
  return body
}

function readPathField(inputs: OperationRequestArguments, field: string) {
  return isRecord(inputs.path) ? inputs.path[field] : undefined
}

const isSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value)

function assertBoundedIntegerBody(
  values: readonly unknown[],
  maximumItems: number,
  operation: string,
) {
  if (values.length === 0 || values.length > maximumItems) {
    throw new Error(
      `ESI identity request body for ${operation} must contain between 1 and ${maximumItems} items`,
    )
  }
  if (!values.every(isSafeInteger)) {
    throw new Error(`ESI identity request body for ${operation} must contain safe integers`)
  }
}
