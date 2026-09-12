import { isRecord } from '../../type-guards.js'
import type { EsiOperation } from './catalog.js'
import { getGeneratedEsiMaximumBatchSize } from './operation-metadata.js'

type ArrayBodyEsiOperation =
  | 'bulk-affiliation'
  | 'character-asset-names'
  | 'character-cspa-charge'
  | 'universe-resolve-ids'
  | 'universe-resolve-names'

type EsiRequestIdentityProjector = (
  inputs: Readonly<Record<string, unknown>>,
) => Readonly<Record<string, unknown>>

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
  inputs: Readonly<Record<string, unknown>>,
) {
  const projector = (
    arrayBodyIdentityProjectors as Partial<Record<EsiOperation, EsiRequestIdentityProjector>>
  )[operation]
  return projector?.(inputs)
}

function requireArrayBody(inputs: Readonly<Record<string, unknown>>, operation: string) {
  if (!Array.isArray(inputs.body))
    throw new Error(`ESI identity request body for ${operation} must be an array`)
  return inputs.body
}

function readPathField(inputs: Readonly<Record<string, unknown>>, field: string) {
  return isRecord(inputs.path) ? inputs.path[field] : undefined
}

function assertBoundedIntegerBody(
  values: readonly unknown[],
  maximumItems: number,
  operation: string,
) {
  if (values.length === 0 || values.length > maximumItems)
    throw new Error(
      `ESI identity request body for ${operation} must contain between 1 and ${maximumItems} items`,
    )
  if (values.some((value) => typeof value !== 'number' || !Number.isSafeInteger(value)))
    throw new Error(`ESI identity request body for ${operation} must contain safe integers`)
}
