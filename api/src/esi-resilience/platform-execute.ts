import type { PlatformExecutableEsiOperationDefinition } from '@eve-space/platform-module-server'
import {
  getCharacterAuthorizationForLifecycle,
  getCharacterCacheAuthorizationForLifecycle,
} from '../auth/tokens.js'
import { getEsiOperationContract } from './catalog-access.js'
import type { EsiOperation } from './catalog.js'
import { characterEsiPrincipal, characterLifecycleEsiPrincipal } from './identity.js'
import {
  getEsiResilienceLayer,
  type CharacterEsiOperation,
  type PublicEsiOperation,
} from './layer.js'
import {
  dispatchModuleEsiOperation,
  validateModuleEsiOperationInputs,
} from './module-operation-dispatcher.js'
import { assertNoCallerEsiRevalidationHeaders } from './revalidation.js'
import { createEsiTransport } from './request-transport.js'
import type { EsiQuota } from './types.js'

export interface PlatformEsiExecutionRequest {
  readonly operation: EsiOperation
  readonly definition: PlatformExecutableEsiOperationDefinition
  readonly inputs: Readonly<Record<string, unknown>>
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
  const resilience = getEsiResilienceLayer()

  if (contract.authorization.kind === 'public') {
    if (request.authorization.kind !== 'public')
      throw new PlatformEsiRequestError(
        'Public platform ESI operation received character authority',
      )
    const result = await resilience.getPublic({
      operation: request.operation as PublicEsiOperation,
      inputs,
      load: (revalidation) =>
        dispatchModuleEsiOperation(request.definition, {
          inputs,
          authorization: { kind: 'public' },
          revalidation,
          transport: createEsiTransport(request.operation),
        }),
    })
    return { ...result, authorizationGeneration: null }
  }

  if (request.authorization.kind !== 'character-lifecycle')
    throw new PlatformEsiRequestError(
      'Character platform ESI operation requires lifecycle authority',
    )
  const authorization = request.authorization
  const requiredScope = contract.authorization.scope
  const transportPrincipal = characterEsiPrincipal(authorization.characterId)
  const execution = await resilience.getCharacterWithAuthorization(
    {
      operation: request.operation as CharacterEsiOperation,
      inputs,
      load: (authority, revalidation) =>
        dispatchModuleEsiOperation(request.definition, {
          inputs,
          authorization: { kind: 'character', accessToken: authority.accessToken },
          revalidation,
          transport: createEsiTransport(request.operation, authority.principal),
        }),
    },
    {
      cacheAuthorization: {
        kind: 'character',
        principal: characterLifecycleEsiPrincipal(
          authorization.characterId,
          authorization.lifecycleId,
        ),
        generation: authorization.generation,
      },
      transportPrincipal,
      resolve: () =>
        getCharacterAuthorizationForLifecycle(
          authorization.characterId,
          authorization.lifecycleId,
          requiredScope,
        ),
      recheckCacheAuthorization: async () =>
        (
          await getCharacterCacheAuthorizationForLifecycle(
            authorization.characterId,
            authorization.lifecycleId,
            requiredScope,
          )
        ).tokenVersion,
    },
  )
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
    const parsed = validateModuleEsiOperationInputs(definition, inputs)
    assertNoCallerEsiRevalidationHeaders(parsed)
    return parsed
  } catch (error) {
    throw new PlatformEsiRequestError('Platform ESI request inputs are invalid', { cause: error })
  }
}
