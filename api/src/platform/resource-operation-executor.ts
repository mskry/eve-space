import type {
  PlatformInstalledResourceDescriptor,
  PlatformResourceImplementation,
  PlatformResourceOperationContract,
  PlatformResourceOperationMethod,
  PlatformResourceOperationMethods,
  PlatformResourceOperationProtocol,
  PlatformResourceOperationResult,
  PlatformResourceSubject,
} from '@eve-space/platform-module-contract/resources'
import type { PlatformEsiRequestSubject } from '@eve-space/platform-module-contract/esi'
import {
  assertPlatformEsiOperation,
  getEsiOperationAuthorization,
  getPlatformEsiOperationDefinition,
  narrowPlatformEsiOperationOutput,
  parsePlatformEsiOperationInputs,
  type EsiOperationAuthorization,
  type PlatformEsiOperation,
  type PlatformEsiOperationOutput,
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
import {
  getInstalledResourceCredentialBindings,
  type PlatformResourceCredentialBinding,
} from './resource-declarations.js'
import { platformResources } from './resources.js'
import type { PlatformCollectionStateIdentity } from './collection-state.js'
import {
  managedCollectionAuthorityEquals,
  corporationAuthorityFenceEquals,
  createCorporationContinuationAuthorityBinding,
  type PlatformCorporationAuthorityFence,
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
  PlatformResourceObsoleteError,
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
      readonly corporationAuthorityFence?: PlatformCorporationAuthorityFence
      readonly organizationVersion?: number
      readonly complete?: boolean
      readonly result: PlatformEsiExecution<unknown>
    }

type LoadedPlatformResourceExecution = Extract<
  PlatformResourceOperationExecution,
  { outcome: 'loaded' }
>
type ReadyPlatformResourceExecution = Extract<PlatformResourceExecutionGuard, { outcome: 'ready' }>
type ResourceCollectionContext = Awaited<ReturnType<typeof loadResourceCollectionContext>>
type SingleRequestImplementation = Extract<
  PlatformResourceImplementation,
  { readonly mode: 'single-request' }
>
type BoundedCollectionImplementation = Extract<
  PlatformResourceImplementation,
  { readonly mode: 'bounded-collection' }
>
type ResourceCollectionOperationMethod =
  PlatformResourceOperationMethod<PlatformResourceOperationContract>

interface BoundRequestPath {
  readonly character_id?: unknown
  readonly corporation_id?: unknown
}

interface ResourceOperationExecutorOptions {
  readonly signal?: AbortSignal
  readonly request?: ResourceOperationRequest
  readonly loadCollectionContext?: typeof loadResourceCollectionContext
  readonly createCapabilities?: typeof createPlatformResourceReadCapabilities
  readonly createMappingCapabilities?: typeof createPlatformResourceMappingCapabilities
  readonly resources?: readonly PlatformInstalledResourceDescriptor[]
  readonly guardExecution?: typeof guardInstalledResourceExecution
  readonly executeEsiOperation?: typeof executePlatformEsiOperation
  readonly onAuthorityResolved?: (authority: {
    readonly authorizationGeneration: number | null
    readonly managedAuthority: PlatformManagedCollectionAuthority | null
    readonly corporationAuthorityFence?: PlatformCorporationAuthorityFence
  }) => void
}

interface ResourceOperationRequest {
  readonly operationId: string
  readonly inputs: unknown
  readonly corporationId?: number | null
  readonly expectedCorporationAuthorityFence?: PlatformCorporationAuthorityFence
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
  if (guarded.outcome === 'noop') {
    return guarded
  }
  if (!options.request) {
    options.onAuthorityResolved?.({
      authorizationGeneration: guarded.authorization?.tokenVersion ?? null,
      managedAuthority: guarded.managedAuthority,
      ...(guarded.corporationAuthorityFence && {
        corporationAuthorityFence: guarded.corporationAuthorityFence,
      }),
    })
  }

  const subject =
    guarded.subject ??
    toPlatformResourceSubject(identity as Parameters<typeof toPlatformResourceSubject>[0])
  if (!subject) {
    return { outcome: 'noop', reason: 'obsolete' }
  }
  if (options.request) {
    return executeResourceRequest(identity, options, guarded, subject, options.request)
  }
  const implementation = guarded.resource.implementation as PlatformResourceImplementation
  if (implementation.mode === 'bounded-collection') {
    return executeCollectedResourceOperation(identity, options, guarded, subject, implementation)
  }
  return executeSingleResourceOperation(identity, options, guarded, subject, implementation)
}

async function executeCollectedResourceOperation(
  identity: PlatformCollectionStateIdentity,
  options: ResourceOperationExecutorOptions,
  guarded: ReadyPlatformResourceExecution,
  subject: PlatformResourceSubject,
  implementation: BoundedCollectionImplementation,
): Promise<PlatformResourceOperationExecution> {
  const collectionContext = await (options.loadCollectionContext ?? loadResourceCollectionContext)(
    subject,
    options.signal,
  )
  options.signal?.throwIfAborted()
  const state: ResourceCollectionExecutionState = { requests: 0 }
  const requestContext: ResourceCollectionRequestContext = {
    collectionContext,
    guarded,
    identity,
    options,
    state,
    subject,
  }
  const collected = await implementation.collect({
    ...collectionContext,
    authorizationGeneration: guarded.authorization?.tokenVersion ?? null,
    capabilities: createResourceCollectionCapabilities(options, guarded.resource),
    managedAuthority: guarded.managedAuthority,
    ...(guarded.corporationAuthorityFence && {
      continuationAuthorityBinding: createCorporationContinuationAuthorityBinding(
        guarded.corporationAuthorityFence,
      ),
    }),
    operations: createResourceCollectionOperations(requestContext),
    requestBudget: RESOURCE_COLLECTION_REQUEST_BUDGET,
    subject,
  })
  options.signal?.throwIfAborted()
  if (!state.latest) {
    if (
      collected.complete !== false ||
      state.requests !== 0 ||
      !guarded.corporationAuthorityFence ||
      subject.kind !== 'corporation'
    ) {
      throw new Error('Resource collection must validate an observation')
    }
    const validatedAt = new Date().toISOString()
    return {
      authorizationCharacterId: guarded.authorizationCharacterId,
      authorizationCharacterLifecycleId: guarded.authorizationCharacterLifecycleId,
      authorizationGeneration: guarded.authorization?.tokenVersion ?? null,
      complete: false,
      corporationAuthorityFence: guarded.corporationAuthorityFence,
      managedAuthority: guarded.managedAuthority,
      organizationVersion: collectionContext.organizationVersion,
      outcome: 'loaded',
      resource: guarded.resource,
      result: {
        authorizationGeneration: guarded.authorization?.tokenVersion ?? null,
        cachedUntil: validatedAt,
        data: collected.data,
        quota: {},
        source: 'cache',
        stale: false,
        validatedAt,
      },
      subject,
    }
  }
  return {
    authorizationCharacterId: guarded.authorizationCharacterId,
    authorizationCharacterLifecycleId: guarded.authorizationCharacterLifecycleId,
    authorizationGeneration: guarded.authorization?.tokenVersion ?? null,
    complete: collected.complete,
    managedAuthority: guarded.managedAuthority,
    organizationVersion: collectionContext.organizationVersion,
    ...(guarded.corporationAuthorityFence && {
      corporationAuthorityFence: guarded.corporationAuthorityFence,
    }),
    outcome: 'loaded',
    resource: guarded.resource,
    result: { ...state.latest, data: collected.data },
    subject,
  }
}

/** Builds the collector's only ESI authority from the compiled descriptor's declared operations. */
function createResourceCollectionOperations(
  context: ResourceCollectionRequestContext,
): PlatformResourceOperationMethods<PlatformResourceOperationProtocol> {
  const operations: Record<string, ResourceCollectionOperationMethod> = Object.create(null)
  for (const operationId of declaredCollectionOperations(context.guarded.resource)) {
    operations[operationId] = (inputs) => executeCollectionRequest(context, operationId, inputs)
  }
  return Object.freeze(operations)
}

async function executeCollectionRequest(
  context: ResourceCollectionRequestContext,
  operationId: string,
  inputs: PlatformResourceOperationContract['input'],
): Promise<PlatformResourceOperationResult<unknown>> {
  context.options.signal?.throwIfAborted()
  context.state.requests += 1
  if (context.state.requests > RESOURCE_COLLECTION_REQUEST_BUDGET) {
    throw new Error('Resource collection request budget exceeded')
  }
  assertDeclaredCollectionOperation(operationId, context.guarded.resource)
  assertCollectionSubject(inputs, context.subject, context.collectionContext.corporationId)
  assertPlatformEsiOperation(operationId)
  const parsed = parseResourceRequestInputs(operationId, inputs)
  assertCollectionSubject(parsed, context.subject, context.collectionContext.corporationId)
  if (operationId === 'universe-resolve-names' && !context.options.executeEsiOperation) {
    const result = await resolveCollectionUniverseNames(inputs, context.options.signal)
    retainCollectionExecution(context.state, result)
    return { data: result.data, validatedAt: result.validatedAt }
  }
  const result = await executeInstalledResourceOperation(context.identity, {
    ...context.options,
    request: {
      inputs: parsed,
      operationId,
      corporationId: context.collectionContext.corporationId,
      expectedCorporationAuthorityFence: context.guarded.corporationAuthorityFence,
    },
  })
  context.options.signal?.throwIfAborted()
  assertCollectionAuthority(result, context.guarded)
  retainCollectionExecution(context.state, result.result)
  return {
    data: result.result.data,
    validatedAt: result.result.validatedAt,
    ...(result.result.pagination && { pagination: { ...result.result.pagination } }),
  }
}

async function resolveCollectionUniverseNames(
  inputs: unknown,
  signal?: AbortSignal,
): Promise<PlatformEsiExecution<PlatformEsiOperationOutput<'universe-resolve-names'>>> {
  const ids = parseResourceRequestInputs('universe-resolve-names', inputs).body
  const resolved = await resolveUniverseNamesBestEffort(ids, { signal })
  const responseSchema =
    getPlatformEsiOperationDefinition('universe-resolve-names').descriptor.responseSchema
  const validatedAt = new Date().toISOString()
  return {
    authorizationGeneration: null,
    cachedUntil: validatedAt,
    data: narrowPlatformEsiOperationOutput(
      'universe-resolve-names',
      ids.flatMap((id) => {
        const name = resolved.names.get(id)
        return name && responseSchema.safeParse([name]).success ? [name] : []
      }),
    ),
    quota: {},
    source: 'cache',
    stale: false,
    validatedAt,
  }
}

async function executeSingleResourceOperation(
  identity: PlatformCollectionStateIdentity,
  options: ResourceOperationExecutorOptions,
  guarded: ReadyPlatformResourceExecution,
  subject: PlatformResourceSubject,
  implementation: SingleRequestImplementation,
): Promise<PlatformResourceOperationExecution> {
  let inputs: unknown
  try {
    inputs = implementation.request(subject)
  } catch (error) {
    throw new PlatformResourceMappingError(error)
  }
  const loaded = await executeResourceRequest(identity, options, guarded, subject, {
    inputs,
    operationId: guarded.resource.operationId,
  })
  return {
    ...loaded,
    result: await mapResourceResult(
      loaded.result,
      implementation,
      subject,
      guarded.resource,
      options,
    ),
  }
}

const resolveBoundCharacterIdentity = (
  guarded: ReadyPlatformResourceExecution,
  subject: PlatformResourceSubject,
) => ({
  characterId:
    guarded.authorizationCharacterId ??
    guarded.characterId ??
    (subject.kind === 'character' ? subject.characterId : null),
  lifecycleId:
    guarded.authorizationCharacterLifecycleId ??
    (subject.kind === 'character' ? subject.lifecycleId : null),
})

const assertManagedMemberAdmission = (
  binding: PlatformResourceCredentialBinding,
  guarded: ReadyPlatformResourceExecution,
) => {
  if (binding.kind !== 'current-managed-member-character') return
  const authority = guarded.managedAuthority
  if (
    !authority ||
    ![
      authority.sectionId === binding.sectionId,
      authority.organizationVersion !== undefined,
      authority.managedMemberLifecycleId !== undefined,
      authority.disclosureVersion !== undefined,
      authority.sectionActivationVersion !== undefined,
    ].every(Boolean)
  ) {
    throw new Error('Resource operation requires current managed-member admission')
  }
}

const resolveBoundCorporationId = async (
  binding: PlatformResourceCredentialBinding,
  subject: PlatformResourceSubject,
  options: ResourceOperationExecutorOptions,
  knownCorporationId?: number | null,
): Promise<number | null> => {
  if (binding.kind === 'public' || !binding.requestSubjects.includes('corporation_id')) return null
  if (binding.kind === 'current-managed-corporation-source') {
    return subject.kind === 'corporation' ? subject.corporationId : null
  }
  if (knownCorporationId !== undefined && knownCorporationId !== null) return knownCorporationId
  return (
    await (options.loadCollectionContext ?? loadResourceCollectionContext)(subject, options.signal)
  ).corporationId
}

const assertBoundRequestSubjects = (
  requestSubjects: readonly PlatformEsiRequestSubject[],
  path: BoundRequestPath,
  subject: PlatformResourceSubject,
  corporationId: number | null,
) => {
  for (const requestSubject of requestSubjects) {
    let expected = corporationId
    if (requestSubject === 'character_id') {
      expected = subject.kind === 'character' ? subject.characterId : null
    }
    if (path[requestSubject] !== expected || expected === null) {
      throw new Error('Resource operation request is outside its bound subject')
    }
  }
}

const assertResourceOperationSubject = async (
  binding: PlatformResourceCredentialBinding,
  inputs: unknown,
  subject: PlatformResourceSubject,
  guarded: ReadyPlatformResourceExecution,
  options: ResourceOperationExecutorOptions,
  knownCorporationId?: number | null,
) => {
  if (binding.kind === 'public') return
  if (!isRecord(inputs) || !isRecord(inputs.path)) {
    throw new Error('Resource operation is missing its bound request subject')
  }
  const path = inputs.path
  const { characterId, lifecycleId } = resolveBoundCharacterIdentity(guarded, subject)
  if (!guarded.authorization || !characterId || !lifecycleId) {
    throw new Error('Resource operation is missing its bound credentials')
  }
  assertManagedMemberAdmission(binding, guarded)
  if (
    binding.kind !== 'current-managed-corporation-source' &&
    (subject.kind !== 'character' ||
      characterId !== subject.characterId ||
      lifecycleId !== subject.lifecycleId)
  ) {
    throw new Error('Resource operation character is outside its owned subject')
  }
  const corporationId = await resolveBoundCorporationId(
    binding,
    subject,
    options,
    knownCorporationId,
  )
  assertBoundRequestSubjects(binding.requestSubjects, path, subject, corporationId)
}

const resolveResourceOperationCredential = (
  guarded: ReadyPlatformResourceExecution,
  subject: PlatformResourceSubject,
  identity: PlatformCollectionStateIdentity,
  kind: EsiOperationAuthorization['kind'],
) => {
  const { characterId, lifecycleId } = resolveBoundCharacterIdentity(guarded, subject)
  if (kind === 'public') {
    return { authorization: { kind: 'public' as const }, characterId, lifecycleId }
  }
  if (!guarded.authorization || !characterId || !lifecycleId) {
    throw new Error(
      `Character-authorized resource ${identity.moduleId}/${identity.resourceId} lacks an authorization source`,
    )
  }
  return {
    authorization: {
      kind: 'character-lifecycle' as const,
      characterId,
      lifecycleId,
      generation: guarded.authorization.tokenVersion,
    },
    characterId,
    lifecycleId,
  }
}

async function executeResourceRequest(
  identity: PlatformCollectionStateIdentity,
  options: ResourceOperationExecutorOptions,
  guarded: ReadyPlatformResourceExecution,
  subject: PlatformResourceSubject,
  request: ResourceOperationRequest,
): Promise<LoadedPlatformResourceExecution> {
  const operation = request.operationId
  assertPlatformEsiOperation(operation)
  if (
    request.expectedCorporationAuthorityFence &&
    !corporationAuthorityFenceEquals(
      request.expectedCorporationAuthorityFence,
      guarded.corporationAuthorityFence,
    )
  ) {
    throw new PlatformResourceObsoleteError()
  }
  const inputs = parseResourceRequestInputs(operation, request.inputs)
  const binding = getInstalledResourceCredentialBindings(guarded.resource)[operation]
  if (!binding) throw new Error(`Resource operation ${operation} is undeclared`)
  await assertResourceOperationSubject(
    binding,
    inputs,
    subject,
    guarded,
    options,
    request.corporationId,
  )
  const operationAuthorization = getEsiOperationAuthorization(operation)
  const credential = resolveResourceOperationCredential(
    guarded,
    subject,
    identity,
    operationAuthorization.kind,
  )
  const execution = await executeResourceEsiOperation(options, {
    authorization: credential.authorization,
    inputs,
    operation,
    ...(options.signal && { signal: options.signal }),
  })
  options.signal?.throwIfAborted()
  assertPlatformResourceRefreshSucceeded(execution)
  return {
    authorizationCharacterId: credential.characterId,
    authorizationCharacterLifecycleId: credential.lifecycleId,
    authorizationGeneration:
      operationAuthorization.kind === 'oauth'
        ? execution.authorizationGeneration
        : (guarded.authorization?.tokenVersion ?? execution.authorizationGeneration),
    managedAuthority: guarded.managedAuthority,
    ...(guarded.corporationAuthorityFence && {
      corporationAuthorityFence: guarded.corporationAuthorityFence,
    }),
    outcome: 'loaded',
    resource: guarded.resource,
    result: execution,
    subject,
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
    if (error instanceof PlatformEsiRequestError) {
      throw new PlatformResourceMappingError(error)
    }
    if (isEsiAuthorizationFailure(error)) {
      throw new PlatformResourceAuthorizationError(error)
    }
    throw error
  }
}

async function mapResourceResult(
  result: PlatformEsiExecution<unknown>,
  implementation: SingleRequestImplementation,
  subject: PlatformResourceSubject,
  resource: PlatformInstalledResourceDescriptor,
  options: ResourceOperationExecutorOptions,
): Promise<PlatformEsiExecution<unknown>> {
  try {
    const createCapabilities =
      options.createMappingCapabilities ?? createPlatformResourceMappingCapabilities
    const data = await implementation.map({
      capabilities: createCapabilities(resource),
      data: result.data,
      subject,
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

function parseResourceRequestInputs<Operation extends PlatformEsiOperation>(
  operation: Operation,
  inputs: unknown,
) {
  try {
    return parsePlatformEsiOperationInputs(operation, inputs)
  } catch (error) {
    throw new PlatformResourceMappingError(
      new PlatformEsiRequestError('Platform ESI request inputs are invalid', { cause: error }),
    )
  }
}

function declaredCollectionOperations(resource: PlatformInstalledResourceDescriptor) {
  return new Set([resource.operationId, ...(resource.dependentOperationIds ?? [])])
}

function assertDeclaredCollectionOperation(
  operationId: string,
  resource: PlatformInstalledResourceDescriptor,
) {
  if (!declaredCollectionOperations(resource).has(operationId)) {
    throw new Error('Resource collection operation is undeclared')
  }
}

function assertCollectionSubject(
  inputs: unknown,
  subject: PlatformResourceSubject,
  corporationId: number | null,
) {
  if (!isRecord(inputs) || !isRecord(inputs.path)) {
    return
  }
  if (
    'character_id' in inputs.path &&
    (subject.kind !== 'character' || inputs.path.character_id !== subject.characterId)
  ) {
    throw new Error('Resource collection character is outside its subject')
  }
  if (
    'corporation_id' in inputs.path &&
    subject.kind !== 'deployment' &&
    inputs.path.corporation_id !== corporationId
  ) {
    throw new Error('Resource collection corporation is outside its subject')
  }
}

function assertCollectionAuthority(
  result: PlatformResourceOperationExecution,
  guarded: ReadyPlatformResourceExecution,
): asserts result is LoadedPlatformResourceExecution {
  if (
    result.outcome !== 'loaded' ||
    result.authorizationGeneration !== (guarded.authorization?.tokenVersion ?? null) ||
    result.authorizationCharacterId !== guarded.authorizationCharacterId ||
    result.authorizationCharacterLifecycleId !== guarded.authorizationCharacterLifecycleId ||
    !managedCollectionAuthorityEquals(result.managedAuthority, guarded.managedAuthority) ||
    !corporationAuthorityFenceEquals(
      result.corporationAuthorityFence,
      guarded.corporationAuthorityFence,
    )
  ) {
    throw new PlatformResourceObsoleteError()
  }
}

function retainCollectionExecution(
  state: ResourceCollectionExecutionState,
  result: PlatformEsiExecution<unknown>,
) {
  if (!state.latest || result.validatedAt < state.latest.validatedAt) {
    state.latest = result
  }
}
