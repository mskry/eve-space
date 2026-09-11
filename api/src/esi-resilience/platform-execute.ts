import type { PlatformExecutableEsiOperationDefinition } from '@eve-space/platform-module-server'
import { isRecord } from '../type-guards.js'
import { getEsiOperationContract } from './catalog-access.js'
import type { EsiOperation } from './catalog.js'
import { esiExecutionLayer } from './layer.js'
import { assertNoCallerEsiRevalidationHeaders } from './revalidation.js'
import type { EsiQuota } from './types.js'

export interface PlatformEsiExecutionRequest {
  readonly operation: EsiOperation
  readonly definition: PlatformExecutableEsiOperationDefinition
  readonly inputs: Readonly<Record<string, unknown>>
  readonly signal?: AbortSignal
  readonly authorization:
    | { readonly kind: 'public' }
    | {
        readonly kind: 'character-lifecycle'
        readonly characterId: number
        readonly lifecycleId: string
        readonly generation: number
      }
}

/** Validated SDK wire data cached before the platform caller performs its resource mapping. */
export interface PlatformEsiExecution<Data> {
  readonly data: Data
  readonly authorizationGeneration: number | null
  readonly cachedUntil: string
  readonly validatedAt: string
  readonly source: 'esi' | 'cache' | 'not-modified'
  readonly stale: boolean
  readonly retryAt?: string
  readonly refreshFailureClass?: 'esi-cooldown' | 'esi-unavailable' | 'response-invalid' | 'unknown'
  readonly quota: EsiQuota
}

export async function executePlatformEsiOperation(
  request: PlatformEsiExecutionRequest,
): Promise<PlatformEsiExecution<unknown>> {
  const inputs = validatePlatformInputs(request.definition, request.inputs)
  const contract = getEsiOperationContract(request.operation)

  if (contract.authorization.kind === 'public') {
    if (request.authorization.kind !== 'public')
      throw new PlatformEsiRequestError(
        'Public platform ESI operation received character authority',
      )
    const execution = await esiExecutionLayer.executePlatformOperation(request, inputs)
    return { ...execution.result, authorizationGeneration: null }
  }

  if (request.authorization.kind !== 'character-lifecycle')
    throw new PlatformEsiRequestError(
      'Character platform ESI operation requires lifecycle authority',
    )
  const execution = await esiExecutionLayer.executePlatformOperation(request, inputs)
  return { ...execution.result, authorizationGeneration: execution.authorizationGeneration }
}

export class PlatformEsiRequestError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PlatformEsiRequestError'
  }
}

function validatePlatformInputs(
  definition: PlatformExecutableEsiOperationDefinition,
  inputs: Readonly<Record<string, unknown>>,
) {
  try {
    const parsed: unknown = definition.descriptor.requestSchema.parse(inputs)
    if (!isRecord(parsed)) throw new Error('ESI SDK operation arguments must resolve to an object')
    assertNoCallerEsiRevalidationHeaders(parsed)
    return parsed
  } catch (error) {
    throw new PlatformEsiRequestError('Platform ESI request inputs are invalid', { cause: error })
  }
}
