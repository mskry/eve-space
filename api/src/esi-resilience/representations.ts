import type { EsiOperation } from './catalog.js'
import type { EsiLoadResult, EsiRevalidation } from './types.js'

const representationBrand: unique symbol = Symbol('EsiCharacterRepresentation')

export interface EsiCharacterRepresentationAuthority {
  readonly accessToken: string
  readonly principal: string
}

/**
 * Opaque: only `defineCharacterEsiRepresentation` can produce a value of this shape, because the
 * brand key is a module-private symbol. Feature code passes the whole value to `execute` rather
 * than constructing one inline or pulling `load` out to call ESI directly.
 */
export interface EsiCharacterRepresentation<Operation extends EsiOperation, Input, Result> {
  readonly [representationBrand]: true
  readonly operation: Operation
  readonly name: string
  readonly authorization: 'character'
  encodeIdentity(input: Input): Readonly<Record<string, unknown>>
  load(
    input: Input,
    authority: EsiCharacterRepresentationAuthority,
    revalidation: EsiRevalidation,
  ): Promise<EsiLoadResult<Result>>
}

export function defineCharacterEsiRepresentation<
  Operation extends EsiOperation,
  Input,
  Result,
>(options: {
  operation: Operation
  name: string
  encodeIdentity: (input: Input) => Readonly<Record<string, unknown>>
  load: (
    input: Input,
    authority: EsiCharacterRepresentationAuthority,
    revalidation: EsiRevalidation,
  ) => Promise<EsiLoadResult<Result>>
}): EsiCharacterRepresentation<Operation, Input, Result> {
  return {
    [representationBrand]: true,
    operation: options.operation,
    name: options.name,
    authorization: 'character',
    encodeIdentity: options.encodeIdentity,
    load: options.load,
  }
}
