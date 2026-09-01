import type {
  PlatformInstalledResourceDescriptor,
  PlatformResourceOperationImplementation,
  PlatformResourceSubject,
} from '@eve-space/platform-module-contract'
import type { PlatformExecutableEsiOperationDefinition } from '@eve-space/platform-module-server'
import {
  getEsiOperationContract,
  getExecutableEsiOperationDefinition,
  type EsiOperation,
} from '../esi-resilience/catalog.js'
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
  type CharacterEsiOperation,
  type PublicEsiOperation,
} from '../esi-resilience/resilience.js'
import { createEsiTransport } from '../esi-resilience/transport.js'
import type { EsiCachedResult } from '../esi-resilience/types.js'
import { platformResources } from './resources.js'
import type { PlatformCollectionStateIdentity } from './collection-state.js'
import { toPlatformResourceSubject } from './core-resources.js'
import {
  guardInstalledResourceExecution,
  type PlatformResourceExecutionGuard,
} from './resource-execution-guard.js'
import {
  assertPlatformResourceRefreshSucceeded,
  PlatformResourceAuthorizationError,
  PlatformResourceMappingError,
} from './resource-failures.js'

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
  const definition = getExecutableEsiOperationDefinition(operation, options.definitions)
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

  const authorization = guarded.authorization
  if (!authorization)
    throw new Error(
      `Character resource ${identity.moduleId}/${identity.resourceId} lacks authorization`,
    )
  const authorizationCharacterId =
    guarded.authorizationCharacterId ?? (subject.kind === 'character' ? subject.characterId : null)
  const authorizationCharacterLifecycleId =
    guarded.authorizationCharacterLifecycleId ??
    (subject.kind === 'character' ? subject.lifecycleId : null)
  if (!authorizationCharacterId || !authorizationCharacterLifecycleId)
    throw new Error(
      `Character-authorized resource ${identity.moduleId}/${identity.resourceId} lacks an authorization source`,
    )
  const transportPrincipal = characterEsiPrincipal(authorizationCharacterId)
  let result: EsiCachedResult<unknown>
  try {
    result = await resilience.getCharacterWithAuthorization(
      {
        operation: operation as CharacterEsiOperation,
        inputs,
        load: (revalidation) =>
          (options.dispatchOperation ?? dispatchModuleEsiOperation)(definition, {
            inputs,
            authorization: {
              kind: 'character',
              accessToken: authorization.accessToken,
            },
            revalidation,
            transport: createEsiTransport(operation, transportPrincipal),
          }),
      },
      {
        kind: 'character',
        principal: characterLifecycleEsiPrincipal(
          authorizationCharacterId,
          authorizationCharacterLifecycleId,
        ),
        generation: authorization.tokenVersion,
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
    authorizationGeneration: authorization.tokenVersion,
    result: mapResourceResult(result, implementation, subject),
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
