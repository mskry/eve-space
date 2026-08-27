import { EsiClient } from '@evespace/esi-client'
import type { PlatformEsiRevalidation } from '@eve-space/platform-module-contract'
import type { PlatformExecutableEsiOperationDefinition } from '@eve-space/platform-module-server'
import type { EsiLoadResult } from './types.js'

export function validateModuleEsiOperationInputs(
  definition: PlatformExecutableEsiOperationDefinition,
  inputs: Readonly<Record<string, unknown>>,
) {
  const parsed: unknown = definition.descriptor.requestSchema.parse(inputs)
  if (!isRecord(parsed)) throw new Error('ESI SDK operation arguments must resolve to an object')
  return parsed
}

export async function dispatchModuleEsiOperation(
  definition: PlatformExecutableEsiOperationDefinition,
  input: {
    readonly inputs: Readonly<Record<string, unknown>>
    readonly authorization:
      | { readonly kind: 'public' }
      | { readonly kind: 'character'; readonly accessToken: string }
    readonly revalidation: PlatformEsiRevalidation
    readonly transport: typeof globalThis.fetch
  },
): Promise<EsiLoadResult<unknown>> {
  const client = new EsiClient({
    fetch: input.transport,
    token: input.authorization.kind === 'character' ? input.authorization.accessToken : undefined,
    validateResponses: definition.contract.responseValidation.kind === 'enabled',
  })
  return client.callOperation(
    definition.sdkOperationId,
    withRevalidation(input.inputs, input.revalidation) as never,
  )
}

function withRevalidation(
  inputs: Readonly<Record<string, unknown>>,
  revalidation: PlatformEsiRevalidation,
) {
  if (!revalidation.ifNoneMatch && !revalidation.ifModifiedSince) return inputs
  const header = isRecord(inputs.header) ? inputs.header : {}
  return {
    ...inputs,
    header: {
      ...header,
      ...(revalidation.ifNoneMatch ? { 'If-None-Match': revalidation.ifNoneMatch } : {}),
      ...(revalidation.ifModifiedSince
        ? { 'If-Modified-Since': revalidation.ifModifiedSince }
        : {}),
    },
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
