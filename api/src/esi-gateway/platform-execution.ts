import {
  assertPlatformEsiOperation,
  getEsiOperationAuthorization,
  getPlatformEsiOperationDefinition,
  narrowPlatformEsiOperationOutput,
  parsePlatformEsiOperationInputs,
  type PlatformEsiOperation,
  type PlatformEsiOperationInput,
  type PlatformEsiOperationOutput,
} from './catalog-interface.js'
import { getProductionEsiExecutionRuntime } from './internal/production-runtime.js'
import { assertNoCallerEsiRevalidationHeaders } from './internal/revalidation.js'

export interface PlatformEsiExecutionRequest<
  Operation extends PlatformEsiOperation = PlatformEsiOperation,
> {
  readonly operation: Operation
  readonly inputs: PlatformEsiOperationInput<Operation>
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
  readonly pagination?: {
    readonly pages?: number
  }
}

export interface PlatformUntypedEsiExecutionRequest extends Omit<
  PlatformEsiExecutionRequest,
  'operation' | 'inputs'
> {
  readonly operation: string
  readonly inputs: unknown
}

export interface PlatformEsiQuota {
  readonly group?: string
  readonly limit?: string
  readonly remaining?: number
  readonly used?: number
  readonly errorRemaining?: number
  readonly errorResetSeconds?: number
}

export async function executePlatformEsiOperation<Operation extends PlatformEsiOperation>(
  request: PlatformEsiExecutionRequest<Operation>,
): Promise<PlatformEsiExecution<PlatformEsiOperationOutput<Operation>>> {
  assertPlatformEsiOperation(request.operation)
  const definition = getPlatformEsiOperationDefinition(request.operation)
  const inputs = validatePlatformInputs(request.operation, request.inputs)
  const authorization = getEsiOperationAuthorization(request.operation)

  if (authorization.kind === 'public') {
    if (request.authorization.kind !== 'public')
      throw new PlatformEsiRequestError(
        'Public platform ESI operation received character authority',
      )
    const execution = await (
      await getProductionEsiExecutionRuntime()
    ).executePlatformOperation(request, definition, inputs)
    return {
      ...execution.result,
      data: narrowPlatformEsiOperationOutput(request.operation, execution.result.data),
      authorizationGeneration: null,
    }
  }

  if (request.authorization.kind !== 'character-lifecycle')
    throw new PlatformEsiRequestError(
      'Character platform ESI operation requires lifecycle authority',
    )
  const execution = await (
    await getProductionEsiExecutionRuntime()
  ).executePlatformOperation(request, definition, inputs)
  return {
    ...execution.result,
    data: narrowPlatformEsiOperationOutput(request.operation, execution.result.data),
    authorizationGeneration: execution.authorizationGeneration,
  }
}

/** Executes host-erased requests only after the catalog request schema validates their inputs. */
export function executeUntypedPlatformEsiOperation(
  request: PlatformUntypedEsiExecutionRequest,
): Promise<PlatformEsiExecution<unknown>> {
  const operation = request.operation
  assertPlatformEsiOperation(operation)
  return executePlatformEsiOperation({
    ...request,
    operation,
    inputs: validatePlatformInputs(operation, request.inputs),
  })
}

export class PlatformEsiRequestError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PlatformEsiRequestError'
  }
}

function validatePlatformInputs<Operation extends PlatformEsiOperation>(
  operation: Operation,
  inputs: unknown,
) {
  try {
    const parsed = parsePlatformEsiOperationInputs(operation, inputs)
    assertNoCallerEsiRevalidationHeaders(parsed)
    return parsed
  } catch (error) {
    throw new PlatformEsiRequestError('Platform ESI request inputs are invalid', { cause: error })
  }
}
