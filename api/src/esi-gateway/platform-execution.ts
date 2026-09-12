import { isRecord } from '../type-guards.js'
import {
  assertPlatformEsiOperation,
  getEsiOperationAuthorization,
  getPlatformEsiOperationDefinition,
  type EsiOperation,
} from './catalog-interface.js'
import { getProductionEsiExecutionRuntime } from './internal/production-runtime.js'
import { assertNoCallerEsiRevalidationHeaders } from './internal/revalidation.js'

export interface PlatformEsiExecutionRequest {
  readonly operation: EsiOperation
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
  readonly quota: PlatformEsiQuota
}

export interface PlatformEsiQuota {
  readonly group?: string
  readonly limit?: string
  readonly remaining?: number
  readonly used?: number
  readonly errorRemaining?: number
  readonly errorResetSeconds?: number
}

export async function executePlatformEsiOperation(
  request: PlatformEsiExecutionRequest,
): Promise<PlatformEsiExecution<unknown>> {
  assertPlatformEsiOperation(request.operation)
  const definition = getPlatformEsiOperationDefinition(request.operation)
  const inputs = validatePlatformInputs(definition, request.inputs)
  const authorization = getEsiOperationAuthorization(request.operation)

  if (authorization.kind === 'public') {
    if (request.authorization.kind !== 'public')
      throw new PlatformEsiRequestError(
        'Public platform ESI operation received character authority',
      )
    const execution = await (
      await getProductionEsiExecutionRuntime()
    ).executePlatformOperation(request, definition, inputs)
    return { ...execution.result, authorizationGeneration: null }
  }

  if (request.authorization.kind !== 'character-lifecycle')
    throw new PlatformEsiRequestError(
      'Character platform ESI operation requires lifecycle authority',
    )
  const execution = await (
    await getProductionEsiExecutionRuntime()
  ).executePlatformOperation(request, definition, inputs)
  return { ...execution.result, authorizationGeneration: execution.authorizationGeneration }
}

export class PlatformEsiRequestError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PlatformEsiRequestError'
  }
}

function validatePlatformInputs(
  definition: ReturnType<typeof getPlatformEsiOperationDefinition>,
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
