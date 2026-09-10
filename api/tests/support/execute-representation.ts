import { EsiClient, type EsiResponse } from '@evespace/esi-client'
import type { OperationRequestArguments, StableOperationId } from '@evespace/esi-client/operations'
import { withEsiRevalidation } from '../../src/esi-resilience/revalidation.js'
import type { EsiRevalidation } from '../../src/esi-resilience/types.js'

interface RepresentationFixture<Input = unknown, Result = unknown> {
  readonly descriptor: { readonly operationId: string }
  readonly execution: 'read' | 'mutation'
  encodeRequest(input: Input): OperationRequestArguments
  map(response: EsiResponse<unknown>, input: Input): Result | Promise<Result>
  recover?(
    error: unknown,
    input: Input,
  ): { data: Result; meta: EsiResponse<unknown>['meta'] } | undefined
}

export async function executeRepresentationFixture<Input, Result>(
  representation: RepresentationFixture<Input, Result>,
  input: Input,
  options: {
    readonly accessToken?: string
    readonly revalidation?: EsiRevalidation
  } = {},
) {
  const request = representation.encodeRequest(input)
  const client = new EsiClient({
    fetch: async () => {
      throw new Error('The mocked ESI client unexpectedly used its transport')
    },
    ...(options.accessToken ? { token: options.accessToken } : {}),
    ...(representation.execution === 'mutation' ? { allowGenericMutations: true } : {}),
  })
  let response: EsiResponse<unknown>
  try {
    response = await client.callOperation(
      representation.descriptor.operationId as StableOperationId,
      withEsiRevalidation(request, options.revalidation ?? {}) as never,
      ...(representation.execution === 'mutation' ? [{ confirmMutation: true } as const] : []),
    )
  } catch (error) {
    const recovered = representation.recover?.(error, input)
    if (!recovered) throw error
    return cached(recovered.data)
  }
  return cached(await representation.map(response, input))
}

function cached<Data>(data: Data) {
  return { data, cachedUntil: '', validatedAt: '', quota: {}, source: 'esi' as const, stale: false }
}
