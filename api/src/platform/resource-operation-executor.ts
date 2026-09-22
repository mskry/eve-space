import type {
  PlatformInstalledResourceDescriptor,
  PlatformResourceOperationImplementation,
  PlatformResourceSubject,
} from '@eve-space/platform-module-contract/resources'
import {
  getEsiOperationAuthorization,
  getPlatformEsiOperationDefinition,
  type EsiOperation,
} from '../esi-gateway/catalog-interface.js'
import { isEsiAuthorizationFailure } from '../esi-gateway/failures.js'
import {
  executePlatformEsiOperation,
  type PlatformEsiExecution,
  PlatformEsiRequestError,
} from '../esi-gateway/platform-execution.js'
import { isRecord } from '../type-guards.js'
import { resolveUniverseNamesBestEffort } from '../universe/names.js'
import {
  createPlatformResourceMappingCapabilities,
  createPlatformResourceReadCapabilities,
} from './module-route-capabilities.js'
import { loadResourceCollectionContext } from './resource-collection-context.js'
import { platformResources } from './resources.js'
import type { PlatformCollectionStateIdentity } from './collection-state.js'
import {
  managedCollectionAuthorityEquals,
  type PlatformManagedCollectionAuthority,
} from './resource-eligibility.js'
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

const RESOURCE_COLLECTION_REQUEST_BUDGET = 32

type PlatformResourceOperationExecution =
  | Extract<PlatformResourceExecutionGuard, { outcome: 'noop' }>
  | {
      readonly outcome: 'loaded'
      readonly resource: PlatformInstalledResourceDescriptor
      readonly subject: PlatformResourceSubject
      readonly authorizationGeneration: number | null
      readonly authorizationCharacterId?: number | null
      readonly authorizationCharacterLifecycleId?: string | null
      readonly managedAuthority: PlatformManagedCollectionAuthority | null
      readonly organizationVersion?: number
      readonly complete?: boolean
      readonly result: PlatformEsiExecution<unknown>
    }

type ReadyPlatformResourceExecution = Extract<PlatformResourceExecutionGuard, { outcome: 'ready' }>
type ResourceCollectionContext = Awaited<ReturnType<typeof loadResourceCollectionContext>>
type ResourceOperationImplementation = PlatformResourceOperationImplementation<
  string,
  unknown,
  unknown,
  string,
  unknown,
  PlatformResourceSubject
>
type ResourceCollector = NonNullable<ResourceOperationImplementation['collect']>

interface ResourceOperationExecutorOptions {
  readonly signal?: AbortSignal
  readonly request?: {
    readonly operationId: string
    readonly inputs: Readonly<Record<string, unknown>>
  }
  readonly loadCollectionContext?: typeof loadResourceCollectionContext
  readonly createCapabilities?: typeof createPlatformResourceReadCapabilities
  readonly createMappingCapabilities?: typeof createPlatformResourceMappingCapabilities
  readonly resources?: readonly PlatformInstalledResourceDescriptor[]
  readonly guardExecution?: typeof guardInstalledResourceExecution
  readonly executeEsiOperation?: typeof executePlatformEsiOperation
  readonly onAuthorityResolved?: (authority: {
    readonly authorizationGeneration: number | null
    readonly managedAuthority: PlatformManagedCollectionAuthority | null
  }) => void
}

interface ResourceCollectionExecutionState {
  requests: number
  latest?: PlatformEsiExecution<unknown>
}

interface ResourceCollectionRequestContext {
  readonly identity: PlatformCollectionStateIdentity
  readonly options: ResourceOperationExecutorOptions
  readonly guarded: ReadyPlatformResourceExecution
  readonly subject: PlatformResourceSubject
  readonly collectionContext: ResourceCollectionContext
  readonly state: ResourceCollectionExecutionState
}

export async function executeInstalledResourceOperation(
  identity: PlatformCollectionStateIdentity,
  options: ResourceOperationExecutorOptions = {},
): Promise<PlatformResourceOperationExecution> {
  options.signal?.throwIfAborted()
  const resources = options.resources ?? platformResources
  const guarded = await (options.guardExecution ?? guardInstalledResourceExecution)(identity, {
    resources,
    signal: options.signal,
  })
  options.signal?.throwIfAborted()
  if (guarded.outcome === 'noop') return guarded
  options.onAuthorityResolved?.({
    authorizationGeneration: guarded.authorization?.tokenVersion ?? null,
    managedAuthority: guarded.managedAuthority,
  })

  const subject =
    guarded.subject ??
    toPlatformResourceSubject(identity as Parameters<typeof toPlatformResourceSubject>[0])
  if (!subject) return { outcome: 'noop', reason: 'obsolete' }
  const implementation = guarded.resource.implementation as ResourceOperationImplementation
  if (implementation.collect && !options.request)
    return executeCollectedResourceOperation(
      identity,
      options,
      guarded,
      subject,
      implementation.collect,
    )

  return executeSingleResourceOperation(identity, options, guarded, subject, implementation)
}

async function executeCollectedResourceOperation(
  identity: PlatformCollectionStateIdentity,
  options: ResourceOperationExecutorOptions,
  guarded: ReadyPlatformResourceExecution,
  subject: PlatformResourceSubject,
  collect: ResourceCollector,
): Promise<PlatformResourceOperationExecution> {
  const collectionContext = await (options.loadCollectionContext ?? loadResourceCollectionContext)(
    subject,
    options.signal,
  )
  options.signal?.throwIfAborted()
  const state: ResourceCollectionExecutionState = { requests: 0 }
  const requestContext: ResourceCollectionRequestContext = {
    identity,
    options,
    guarded,
    subject,
    collectionContext,
    state,
  }
  const collected = await collect({
    ...collectionContext,
    subject,
    authorizationGeneration: guarded.authorization?.tokenVersion ?? null,
    managedAuthority: guarded.managedAuthority,
    capabilities: createResourceCollectionCapabilities(options, guarded.resource),
    requestBudget: RESOURCE_COLLECTION_REQUEST_BUDGET,
    execute: (operationId, inputs) => executeCollectionRequest(requestContext, operationId, inputs),
  })
  options.signal?.throwIfAborted()
  if (!state.latest) throw new Error('Resource collection must validate an observation')
  return {
    outcome: 'loaded',
    resource: guarded.resource,
    subject,
    authorizationGeneration: guarded.authorization?.tokenVersion ?? null,
    authorizationCharacterId: guarded.authorizationCharacterId,
    authorizationCharacterLifecycleId: guarded.authorizationCharacterLifecycleId,
    managedAuthority: guarded.managedAuthority,
    organizationVersion: collectionContext.organizationVersion,
    complete: collected.complete,
    result: { ...state.latest, data: collected.data },
  }
}

async function executeCollectionRequest(
  context: ResourceCollectionRequestContext,
  operationId: string,
  inputs: Readonly<Record<string, unknown>>,
) {
  context.options.signal?.throwIfAborted()
  context.state.requests += 1
  if (context.state.requests > RESOURCE_COLLECTION_REQUEST_BUDGET)
    throw new Error('Resource collection request budget exceeded')
  assertDeclaredCollectionOperation(operationId, context.guarded.resource)
  assertCollectionSubject(inputs, context.subject, context.collectionContext.corporationId)
  if (operationId === 'universe-resolve-names' && !context.options.executeEsiOperation) {
    const result = await resolveCollectionUniverseNames(inputs, context.options.signal)
    retainCollectionExecution(context.state, result)
    return { data: result.data, validatedAt: result.validatedAt }
  }
  const result = await executeInstalledResourceOperation(context.identity, {
    ...context.options,
    request: { operationId, inputs },
  })
  context.options.signal?.throwIfAborted()
  assertCollectionAuthority(result, context.guarded)
  retainCollectionExecution(context.state, result.result)
  return {
    data: result.result.data,
    validatedAt: result.result.validatedAt,
    ...(result.result.pagination ? { pagination: { ...result.result.pagination } } : {}),
  }
}

async function resolveCollectionUniverseNames(
  inputs: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<PlatformEsiExecution<unknown>> {
  const parsed =
    getPlatformEsiOperationDefinition('universe-resolve-names').descriptor.requestSchema.parse(
      inputs,
    )
  if (!isRecord(parsed) || !Array.isArray(parsed.body))
    throw new PlatformResourceMappingError(new Error('Universe name request is invalid'))
  const ids = parsed.body as number[]
  const resolved = await resolveUniverseNamesBestEffort(ids, { signal })
  const validatedAt = new Date().toISOString()
  return {
    data: ids.flatMap((id) => {
      const name = resolved.names.get(id)
      return name ? [name] : []
    }),
    authorizationGeneration: null,
    cachedUntil: validatedAt,
    validatedAt,
    source: 'cache',
    stale: false,
    quota: {},
  }
}

async function executeSingleResourceOperation(
  identity: PlatformCollectionStateIdentity,
  options: ResourceOperationExecutorOptions,
  guarded: ReadyPlatformResourceExecution,
  subject: PlatformResourceSubject,
  implementation: ResourceOperationImplementation,
): Promise<PlatformResourceOperationExecution> {
  const operation = (options.request?.operationId ?? guarded.resource.operationId) as EsiOperation
  let inputs: Readonly<Record<string, unknown>>
  try {
    inputs = options.request?.inputs ?? implementation.request(subject)
  } catch (error) {
    throw new PlatformResourceMappingError(error)
  }
  const authorization = guarded.authorization
  const operationAuthorization = getEsiOperationAuthorization(operation)
  const authorizationCharacterId =
    guarded.authorizationCharacterId ??
    guarded.characterId ??
    (subject.kind === 'character' ? subject.characterId : null)
  const authorizationCharacterLifecycleId =
    guarded.authorizationCharacterLifecycleId ??
    (subject.kind === 'character' ? subject.lifecycleId : null)
  if (authorization && (!authorizationCharacterId || !authorizationCharacterLifecycleId))
    throw new Error(
      `Character-authorized resource ${identity.moduleId}/${identity.resourceId} lacks an authorization source`,
    )
  const execution = await executeResourceEsiOperation(options, {
    operation,
    inputs,
    authorization:
      authorization && operationAuthorization.kind === 'character'
        ? {
            kind: 'character-lifecycle',
            characterId: authorizationCharacterId!,
            lifecycleId: authorizationCharacterLifecycleId!,
            generation: authorization.tokenVersion,
          }
        : { kind: 'public' },
    ...(options.signal ? { signal: options.signal } : {}),
  })
  options.signal?.throwIfAborted()
  return {
    outcome: 'loaded',
    resource: guarded.resource,
    subject,
    authorizationGeneration:
      operationAuthorization.kind === 'character'
        ? execution.authorizationGeneration
        : (guarded.authorization?.tokenVersion ?? execution.authorizationGeneration),
    authorizationCharacterId,
    authorizationCharacterLifecycleId,
    managedAuthority: guarded.managedAuthority,
    result: await mapResourceResult(
      execution,
      implementation,
      subject,
      guarded.resource,
      options,
      !!options.request,
    ),
  }
}

async function executeResourceEsiOperation(
  options: ResourceOperationExecutorOptions,
  request: Parameters<typeof executePlatformEsiOperation>[0],
) {
  try {
    return await (options.executeEsiOperation ?? executePlatformEsiOperation)(request)
  } catch (error) {
    options.signal?.throwIfAborted()
    if (error instanceof PlatformEsiRequestError) throw new PlatformResourceMappingError(error)
    if (isEsiAuthorizationFailure(error)) throw new PlatformResourceAuthorizationError(error)
    throw error
  }
}

async function mapResourceResult(
  result: PlatformEsiExecution<unknown>,
  implementation: ResourceOperationImplementation,
  subject: PlatformResourceSubject,
  resource: PlatformInstalledResourceDescriptor,
  options: ResourceOperationExecutorOptions,
  raw = false,
): Promise<PlatformEsiExecution<unknown>> {
  assertPlatformResourceRefreshSucceeded(result)
  if (raw) return result
  try {
    const createCapabilities =
      options.createMappingCapabilities ?? createPlatformResourceMappingCapabilities
    const data = await implementation.map({
      subject,
      data: result.data,
      capabilities: createCapabilities(resource),
    })
    options.signal?.throwIfAborted()
    return { ...result, data }
  } catch (error) {
    options.signal?.throwIfAborted()
    throw new PlatformResourceMappingError(error)
  }
}

function createResourceCollectionCapabilities(
  options: ResourceOperationExecutorOptions,
  resource: PlatformInstalledResourceDescriptor,
) {
  const createCapabilities = options.createCapabilities ?? createPlatformResourceReadCapabilities
  return options.signal
    ? createCapabilities(resource, options.signal)
    : createCapabilities(resource)
}

function assertDeclaredCollectionOperation(
  operationId: string,
  resource: PlatformInstalledResourceDescriptor,
) {
  if (
    operationId !== resource.operationId &&
    !resource.dependentOperationIds?.includes(operationId)
  )
    throw new Error('Resource collection operation is undeclared')
}

function assertCollectionSubject(
  inputs: Readonly<Record<string, unknown>>,
  subject: PlatformResourceSubject,
  corporationId: number | null,
) {
  if (!isRecord(inputs.path)) return
  if (
    'character_id' in inputs.path &&
    (subject.kind !== 'character' || inputs.path.character_id !== subject.characterId)
  )
    throw new Error('Resource collection character is outside its subject')
  if (
    'corporation_id' in inputs.path &&
    subject.kind !== 'deployment' &&
    inputs.path.corporation_id !== corporationId
  )
    throw new Error('Resource collection corporation is outside its subject')
}

function assertCollectionAuthority(
  result: PlatformResourceOperationExecution,
  guarded: ReadyPlatformResourceExecution,
): asserts result is Extract<PlatformResourceOperationExecution, { outcome: 'loaded' }> {
  if (
    result.outcome !== 'loaded' ||
    result.authorizationGeneration !== (guarded.authorization?.tokenVersion ?? null) ||
    result.authorizationCharacterId !== guarded.authorizationCharacterId ||
    result.authorizationCharacterLifecycleId !== guarded.authorizationCharacterLifecycleId ||
    !managedCollectionAuthorityEquals(result.managedAuthority, guarded.managedAuthority)
  )
    throw new Error('Resource collection authority changed')
}

function retainCollectionExecution(
  state: ResourceCollectionExecutionState,
  result: PlatformEsiExecution<unknown>,
) {
  if (!state.latest || result.validatedAt < state.latest.validatedAt) state.latest = result
}
