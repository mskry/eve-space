import type {
  PlatformInstalledResourceDescriptor,
  PlatformResourceOperationImplementation,
  PlatformResourceSubject,
} from '@eve-space/platform-module-contract'
import type { PlatformExecutableEsiOperationDefinition } from '@eve-space/platform-module-server'
import {
  getCharacterAuthorizationForLifecycle,
  getCharacterCacheAuthorizationForLifecycle,
} from '../auth/tokens.js'
import { getEsiOperationContract } from '../esi-resilience/catalog-access.js'
import type { EsiOperation } from '../esi-resilience/catalog.js'
import {
  dispatchModuleEsiOperation,
  validateModuleEsiOperationInputs,
} from '../esi-resilience/module-operation-dispatcher.js'
import {
  characterEsiPrincipal,
  characterLifecycleEsiPrincipal,
} from '../esi-resilience/identity.js'
import {
  getEsiResilienceLayer,
  type CharacterEsiExecutionResult,
  type CharacterEsiOperation,
  type PublicEsiOperation,
} from '../esi-resilience/layer.js'
import { createEsiTransport } from '../esi-resilience/request-transport.js'
import type { EsiCachedResult } from '../esi-resilience/types.js'
import { platformResources } from './resources.js'
import type { PlatformCollectionStateIdentity } from './collection-state.js'
import { getInstalledResourceEsiOperationDefinition } from './resource-declarations.js'
import {
  guardInstalledResourceExecution,
  type PlatformResourceExecutionGuard,
} from './resource-execution-guard.js'
import {
  assertPlatformResourceRefreshSucceeded,
  PlatformResourceAuthorizationError,
  PlatformResourceMappingError,
} from './resource-failures.js'
import { toPlatformResourceSubject } from './resource-subject.js'

type PlatformResourceOperationExecution =
  | Extract<PlatformResourceExecutionGuard, { outcome: 'noop' }>
  | {
      readonly outcome: 'loaded'
      readonly resource: PlatformInstalledResourceDescriptor
      readonly subject: PlatformResourceSubject
      readonly authorizationGeneration: number | null
      readonly result: EsiCachedResult<unknown>
    }

interface ResourceOperationExecutorOptions {
  readonly resources?: readonly PlatformInstalledResourceDescriptor[]
  readonly guardExecution?: typeof guardInstalledResourceExecution
  readonly definitions?: Readonly<Record<string, PlatformExecutableEsiOperationDefinition>>
  readonly validateInputs?: typeof validateModuleEsiOperationInputs
  readonly dispatchOperation?: typeof dispatchModuleEsiOperation
  readonly loadCharacterAuthorization?: typeof getCharacterAuthorizationForLifecycle
}

export async function executeInstalledResourceOperation(
  identity: PlatformCollectionStateIdentity,
  options: ResourceOperationExecutorOptions = {},
): Promise<PlatformResourceOperationExecution> {
  const resources = options.resources ?? platformResources
  const guarded = await (options.guardExecution ?? guardInstalledResourceExecution)(identity, {
    resources,
  })
  if (guarded.outcome === 'noop') return guarded

  const subject =
    guarded.subject ??
    toPlatformResourceSubject(identity as Parameters<typeof toPlatformResourceSubject>[0])
  if (!subject) return { outcome: 'noop', reason: 'obsolete' }
  const implementation = guarded.resource.implementation as PlatformResourceOperationImplementation<
    string,
    unknown,
    unknown,
    string,
    unknown,
    PlatformResourceSubject
  >
  const operation = guarded.resource.operationId as EsiOperation
  const definition = getInstalledResourceEsiOperationDefinition(operation, options.definitions)
  let inputs: Readonly<Record<string, unknown>>
  try {
    inputs = (options.validateInputs ?? validateModuleEsiOperationInputs)(
      definition,
      implementation.request(subject),
    )
  } catch (error) {
    throw new PlatformResourceMappingError(error)
  }
  const policy = getEsiOperationContract(operation)
  const resilience = getEsiResilienceLayer()

  if (policy.authorization.kind === 'public') {
    const result = await resilience.getPublic({
      operation: operation as PublicEsiOperation,
      inputs,
      load: (revalidation) =>
        (options.dispatchOperation ?? dispatchModuleEsiOperation)(definition, {
          inputs,
          authorization: { kind: 'public' },
          revalidation,
          transport: createEsiTransport(operation),
        }),
    })
    return {
      outcome: 'loaded',
      resource: guarded.resource,
      subject,
      authorizationGeneration: null,
      result: mapResourceResult(result, implementation, subject),
    }
  }
  const requiredScope = policy.authorization.scope

  const authorization = guarded.authorization
  if (!authorization)
    throw new Error(
      `Character resource ${identity.moduleId}/${identity.resourceId} lacks authorization`,
    )
  const authorizationCharacterId =
    guarded.authorizationCharacterId ??
    guarded.characterId ??
    (subject.kind === 'character' ? subject.characterId : null)
  const authorizationCharacterLifecycleId =
    guarded.authorizationCharacterLifecycleId ??
    (subject.kind === 'character' ? subject.lifecycleId : null)
  if (!authorizationCharacterId || !authorizationCharacterLifecycleId)
    throw new Error(
      `Character-authorized resource ${identity.moduleId}/${identity.resourceId} lacks an authorization source`,
    )
  const transportPrincipal = characterEsiPrincipal(authorizationCharacterId)
  let execution: CharacterEsiExecutionResult<unknown>
  try {
    execution = await resilience.getCharacterWithAuthorization(
      {
        operation: operation as CharacterEsiOperation,
        inputs,
        load: (authority, revalidation) =>
          (options.dispatchOperation ?? dispatchModuleEsiOperation)(definition, {
            inputs,
            authorization: {
              kind: 'character',
              accessToken: authority.accessToken,
            },
            revalidation,
            transport: createEsiTransport(operation, authority.principal),
          }),
      },
      {
        cacheAuthorization: {
          kind: 'character',
          principal: characterLifecycleEsiPrincipal(
            authorizationCharacterId,
            authorizationCharacterLifecycleId,
          ),
          generation: authorization.tokenVersion,
        },
        transportPrincipal,
        resolve: () =>
          (options.loadCharacterAuthorization ?? getCharacterAuthorizationForLifecycle)(
            authorizationCharacterId,
            authorizationCharacterLifecycleId,
            requiredScope,
          ),
        recheckCacheAuthorization: async () =>
          (
            await getCharacterCacheAuthorizationForLifecycle(
              authorizationCharacterId,
              authorizationCharacterLifecycleId,
              requiredScope,
            )
          ).tokenVersion,
      },
    )
  } catch (error) {
    if (isAuthorizationResponse(error)) throw new PlatformResourceAuthorizationError(error)
    throw error
  }
  return {
    outcome: 'loaded',
    resource: guarded.resource,
    subject,
    authorizationGeneration: execution.authorizationGeneration,
    result: mapResourceResult(execution.result, implementation, subject),
  }
}

function mapResourceResult(
  result: EsiCachedResult<unknown>,
  implementation: PlatformResourceOperationImplementation<
    string,
    unknown,
    unknown,
    string,
    unknown,
    PlatformResourceSubject
  >,
  subject: PlatformResourceSubject,
): EsiCachedResult<unknown> {
  assertPlatformResourceRefreshSucceeded(result)
  try {
    return { ...result, data: implementation.map({ subject, data: result.data }) }
  } catch (error) {
    throw new PlatformResourceMappingError(error)
  }
}

function isAuthorizationResponse(error: unknown) {
  if (typeof error !== 'object' || !error || !('status' in error)) return false
  return error.status === 401 || error.status === 403
}
