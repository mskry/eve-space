import {
  EsiClient,
  EsiNotModifiedError,
  type EsiResponse,
  type EsiResponseMetadata,
} from '@evespace/esi-client'
import type { PlatformExecutableEsiOperationDefinition } from '@eve-space/platform-module-server'
import type { OperationRequestArguments, StableOperationId } from '@evespace/esi-client/operations'
import { isPositiveSafeInteger, isRecord } from '../../type-guards.js'
import { getEsiOperationContract } from './catalog-access.js'
import { type CharacterMutationEsiOperation, type EsiOperation } from './catalog.js'
import type { EsiOperationContract } from './contract-types.js'
import {
  composeEnvelopeRepresentationVersion,
  createCacheEnvelope,
  getEsiQuota,
  isEnvelopeFresh,
  isEnvelopeRetained,
  isEnvelopeStaleUsable,
  parseEnvelope,
  toRevalidation,
  updateNotModifiedEnvelope,
} from './envelope.js'
import {
  characterEsiPrincipal,
  characterLifecycleEsiPrincipal,
  createEsiRepresentationIdentity,
  type EsiRepresentationIdentity,
} from './identity.js'
import { cacheEnvelopeKey } from './keys.js'
import { isRegisteredEsiRepresentation } from './representation-registry.js'
import type { EsiCharacterMutation, EsiRepresentation } from './representations.js'
import { EsiResourceRevisionRegistry } from './resource-revision.js'
import {
  classifyEsiRefreshFailure,
  isStaleUsableForFailure,
  shouldAdvanceRevisionAfterMutationError,
  shouldRetryEsiError,
  toEsiQuotaError,
} from './failure-policy.js'
import { EsiQuotaError } from './quota-error.js'
import { executeEsiRequestAttempt } from './request-lifecycle.js'
import { getEsiResponseErrorMetadata } from './response-error-metadata.js'
import { recordEsiCacheEnvelopeRejection, recordEsiCacheSource } from './telemetry-counters.js'
import { assertNoCallerEsiRevalidationHeaders, withEsiRevalidation } from './revalidation.js'
import type { EsiExecutionRuntimePorts, EsiRequestLease } from './runtime-ports.js'
import type { EsiExecutionRuntimeConfig } from './runtime-config.js'
import { createEsiExecutionRuntimeState } from './runtime-state.js'
import type {
  CharacterEsiExecutionOptions,
  EsiCacheAuthorization,
  EsiCachedResult,
  EsiCacheEnvelope,
  EsiExecutionOptions,
  EsiLoadResult,
  EsiRevalidation,
} from './types.js'

const followerWaitMs = 100
const namespaceValidationIntervalMs = 1_000

class EsiRequestWaitTimeoutError extends Error {
  constructor() {
    super('Timed out waiting for the current ESI request owner')
    this.name = 'EsiRequestWaitTimeoutError'
  }
}

interface RegisteredEsiRepresentationReference {
  readonly name: string
  readonly operation: EsiOperation
  readonly authorization: 'public' | 'character'
  readonly execution: 'read' | 'mutation'
}

interface CharacterEsiAuthorizationResolver {
  readonly cacheAuthorization: EsiCacheAuthorization
  readonly transportPrincipal: string
  resolve(
    signal?: AbortSignal,
  ): Promise<{ readonly accessToken: string; readonly tokenVersion: number }>
  recheckCacheAuthorization(signal?: AbortSignal): Promise<number>
}

interface CharacterEsiExecutionResult<Data> {
  readonly result: EsiCachedResult<Data>
  readonly authorizationGeneration: number
}

interface EsiCanonicalLoad<Data> {
  readonly meta: EsiLoadResult<unknown>['meta']
  map(): Promise<Data>
}

interface EsiExecutionResource<Data> {
  operation: EsiOperation
  characterId?: number
  inputs: Readonly<Record<string, unknown>>
  signal?: AbortSignal
  load(
    authority: { accessToken: string; principal: string } | undefined,
    revalidation: EsiRevalidation,
  ): Promise<EsiCanonicalLoad<Data>>
}

interface DirectInternalEsiResource<Data> {
  operation: EsiOperation
  inputs: Readonly<Record<string, unknown>>
  representationName?: string
  authorization?: EsiCacheAuthorization
  resourceRevisionPrincipal?: string
  signal?: AbortSignal
  load(revalidation: EsiRevalidation): Promise<EsiCanonicalLoad<Data>>
  resolveAuthorization?: undefined
}

/** Defers token decryption and refresh until after the cache lookup, so a hit never decrypts. */
interface LazyInternalEsiResource<Data> {
  operation: EsiOperation
  inputs: Readonly<Record<string, unknown>>
  representationName?: string
  authorization: EsiCacheAuthorization
  resourceRevisionPrincipal?: string
  signal?: AbortSignal
  load?: undefined
  resolveAuthorization(): Promise<{
    authorization: EsiCacheAuthorization
    load(revalidation: EsiRevalidation): Promise<EsiCanonicalLoad<Data>>
  }>
}

type InternalEsiResource<Data> = DirectInternalEsiResource<Data> | LazyInternalEsiResource<Data>

type ResolvedInternalEsiResource<Data> = DirectInternalEsiResource<Data>

/**
 * Which shared dependencies this request may still use. Coordination loss revokes the distributed
 * fence, so an L2 read or write without it could publish over a newer representation.
 */
interface EsiCacheDependencies {
  namespace: string
  canCoordinate: boolean
  canReadL2: boolean
  canWriteL2: boolean
}

/** Everything one cached request resolves up front and then carries through the load pipeline. */
interface EsiRequestContext<Data> {
  readonly resource: InternalEsiResource<Data>
  readonly identity: EsiRepresentationIdentity
  readonly key: string
  readonly policy: EsiOperationContract
  readonly dependencies: EsiCacheDependencies
}

type ResolvedEsiRequestContext<Data> = Omit<EsiRequestContext<Data>, 'resource'> & {
  readonly resource: ResolvedInternalEsiResource<Data>
}

export type EsiExecutionRuntime = Pick<
  EsiExecutionRuntimeImplementation,
  | 'executeRepresentation'
  | 'executeMutationRepresentation'
  | 'executePlatformOperation'
  | 'getQuotaStatuses'
  | 'isOperationQuotaLimited'
  | 'close'
>

export function createEsiExecutionRuntime(
  ports: EsiExecutionRuntimePorts,
  config: EsiExecutionRuntimeConfig,
): EsiExecutionRuntime {
  return new EsiExecutionRuntimeImplementation(
    ports,
    config,
    createEsiExecutionRuntimeState(config.cacheL1Capacity),
  )
}

class EsiExecutionRuntimeImplementation {
  readonly #resourceRevisions: EsiResourceRevisionRegistry
  readonly #activeOperations = new Set<Promise<unknown>>()
  #closed = false
  #closePromise: Promise<void> | undefined

  constructor(
    private readonly ports: EsiExecutionRuntimePorts,
    private readonly config: EsiExecutionRuntimeConfig,
    private readonly state: ReturnType<typeof createEsiExecutionRuntimeState>,
  ) {
    this.#resourceRevisions = new EsiResourceRevisionRegistry(
      ports.cache,
      ports.coordination,
      state.unrepairedResourceRevisions,
      ports.timing,
      () => state.l1.clear(),
    )
  }

  getQuotaStatuses(
    requests: Parameters<
      EsiExecutionRuntimePorts['coordination']['getRequestCooldowns']
    >[0]['requests'],
  ) {
    this.#assertOpen()
    return this.ports.coordination.getRequestCooldowns({
      requests,
      localState: this.state.localQuota,
    })
  }

  async isOperationQuotaLimited(operation: EsiOperation) {
    this.#assertOpen()
    try {
      const permit = await this.ports.coordination.acquireRequestPermit({
        operation,
        concurrency: this.config.operationConcurrency,
        localState: this.state.localQuota,
      })
      await permit.release()
      return false
    } catch (error) {
      if (error instanceof EsiQuotaError) return true
      throw error
    }
  }

  async executeRepresentation<
    Authorization extends 'public' | 'character',
    Operation extends EsiOperation,
    Input,
    Arguments extends OperationRequestArguments,
    WireResult,
    Result,
  >(
    representation: EsiRepresentation<
      Authorization,
      Operation,
      Input,
      Arguments,
      WireResult,
      Result
    >,
    input: Input,
    options?: EsiExecutionOptions | CharacterEsiExecutionOptions,
  ): Promise<EsiCachedResult<Result>> {
    this.#assertOpen()
    const signal = options?.signal
    signal?.throwIfAborted()
    this.#assertRegisteredRepresentation(
      representation,
      representation.operation,
      representation.authorization,
      'read',
    )
    const request = representation.encodeRequest(input)
    assertNoCallerEsiRevalidationHeaders(request)
    const resource: EsiExecutionResource<Result> = {
      operation: representation.operation,
      inputs: request,
      signal,
      load: (authorization, revalidation) =>
        this.#dispatchRepresentation(
          representation,
          input,
          request,
          revalidation,
          authorization,
          signal,
        ),
    }
    if (representation.authorization === 'public')
      return this.#track(
        this.#recordResult(
          representation.operation,
          this.#get({
            ...resource,
            representationName: representation.name,
            load: (revalidation) => resource.load(undefined, revalidation),
          }),
          signal,
        ),
      )

    if (!options || !('subjectLifecycleId' in options))
      throw new Error('Character ESI execution requires lifecycle authority')
    return this.#track(
      this.#executeCharacter(
        { ...resource, characterId: characterIdFromRequest(request) },
        representation.name,
        options.subjectLifecycleId,
      ),
    )
  }

  async executeMutationRepresentation<
    Operation extends CharacterMutationEsiOperation,
    Input,
    Arguments extends OperationRequestArguments,
    WireResult,
    Result,
  >(
    representation: EsiCharacterMutation<Operation, Input, Arguments, WireResult, Result>,
    input: Input,
    options: CharacterEsiExecutionOptions,
  ): Promise<Result> {
    this.#assertOpen()
    options.signal?.throwIfAborted()
    this.#assertRegisteredRepresentation(
      representation,
      representation.operation,
      'character',
      'mutation',
    )
    const policy = getEsiOperationContract(representation.operation)
    if (!policy.mutation)
      throw new Error(
        `ESI operation ${representation.operation} is not a catalog-declared mutation`,
      )
    const request = representation.encodeRequest(input)
    assertNoCallerEsiRevalidationHeaders(request)
    return this.#track(
      this.#executeCharacterMutation(
        {
          operation: representation.operation,
          characterId: characterIdFromRequest(request),
          inputs: request,
          signal: options.signal,
          load: (authorization) => {
            if (!authorization) throw new Error('Character ESI authorization is required')
            return this.#dispatchMutation(representation, input, request, authorization)
          },
        },
        options.subjectLifecycleId,
      ).then((result) => result.data),
    )
  }

  async executePlatformOperation(
    request: {
      readonly operation: EsiOperation
      readonly authorization:
        | { readonly kind: 'public' }
        | {
            readonly kind: 'character-lifecycle'
            readonly characterId: number
            readonly lifecycleId: string
            readonly generation: number
          }
      readonly signal?: AbortSignal
    },
    definition: PlatformExecutableEsiOperationDefinition,
    inputs: Readonly<Record<string, unknown>>,
  ): Promise<CharacterEsiExecutionResult<unknown>> {
    this.#assertOpen()
    request.signal?.throwIfAborted()
    const contract: EsiOperationContract = getEsiOperationContract(request.operation)
    if (contract.authorization.kind === 'public') {
      return this.#track(
        this.#recordResult(
          request.operation,
          this.#get({
            operation: request.operation,
            inputs,
            signal: request.signal,
            load: (revalidation) =>
              this.#dispatchPlatformOperation(
                request.operation,
                definition,
                inputs,
                revalidation,
                undefined,
                request.signal,
              ),
          }),
          request.signal,
        ).then((result) => ({ result, authorizationGeneration: 0 })),
      )
    }

    if (request.authorization.kind !== 'character-lifecycle')
      throw new Error('Character platform ESI operation requires lifecycle authority')
    const authorization = request.authorization
    const requiredScope = contract.authorization.scope
    return this.#track(
      this.#recordCharacterResult(
        request.operation,
        this.#getCharacterAuthorized(
          {
            operation: request.operation,
            inputs,
            signal: request.signal,
            load: (authority, revalidation) => {
              if (!authority) throw new Error('Character ESI authorization is required')
              return this.#dispatchPlatformOperation(
                request.operation,
                definition,
                inputs,
                revalidation,
                authority,
                request.signal,
              )
            },
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
            transportPrincipal: characterEsiPrincipal(authorization.characterId),
            resolve: (signal) =>
              this.#getCharacterAuthorization(
                authorization.characterId,
                authorization.lifecycleId,
                requiredScope,
                signal,
              ),
            recheckCacheAuthorization: async (signal) => {
              const cacheAuthorization = await this.#getCharacterCacheAuthorization(
                authorization.characterId,
                authorization.lifecycleId,
                requiredScope,
                signal,
              )
              return cacheAuthorization.tokenVersion
            },
          },
        ),
        request.signal,
      ),
    )
  }

  async #dispatchRepresentation<
    Authorization extends 'public' | 'character',
    Operation extends EsiOperation,
    Input,
    Arguments extends OperationRequestArguments,
    WireResult,
    Result,
  >(
    representation: EsiRepresentation<
      Authorization,
      Operation,
      Input,
      Arguments,
      WireResult,
      Result
    >,
    input: Input,
    request: OperationRequestArguments,
    revalidation: EsiRevalidation,
    authorization?: { readonly accessToken: string; readonly principal: string },
    signal?: AbortSignal,
  ): Promise<EsiCanonicalLoad<Result>> {
    const policy = getEsiOperationContract(representation.operation)
    let response: EsiResponse<WireResult>
    try {
      response = await this.#executeSdkAttempt(
        representation.operation,
        authorization?.principal,
        signal,
        (transport) => {
          const client = new EsiClient({
            fetch: transport,
            requestTimeoutMs: this.config.requestTimeoutMs,
            ...(authorization ? { token: authorization.accessToken } : {}),
            validateResponses: policy.responseValidation.kind === 'enabled',
          })
          return client.callOperation(
            representation.descriptor.operationId as StableOperationId,
            withEsiRevalidation(request, revalidation) as never,
          ) as unknown as Promise<EsiResponse<WireResult>>
        },
      )
      signal?.throwIfAborted()
    } catch (error) {
      signal?.throwIfAborted()
      const recovered = representation.recover?.(error, input)
      if (!recovered) throw error
      return { meta: recovered.meta, map: async () => recovered.data }
    }
    return { meta: response.meta, map: async () => representation.map(response, input) }
  }

  async #dispatchMutation<
    Operation extends CharacterMutationEsiOperation,
    Input,
    Arguments extends OperationRequestArguments,
    WireResult,
    Result,
  >(
    representation: EsiCharacterMutation<Operation, Input, Arguments, WireResult, Result>,
    input: Input,
    request: OperationRequestArguments,
    authorization: { readonly accessToken: string; readonly principal: string },
  ): Promise<EsiCanonicalLoad<Result>> {
    const policy = getEsiOperationContract(representation.operation)
    if (!policy.mutation)
      throw new Error(
        `ESI operation ${representation.operation} is not a catalog-declared mutation`,
      )
    const response = await this.#executeSdkAttempt(
      representation.operation,
      authorization.principal,
      undefined,
      (transport) => {
        const client = new EsiClient({
          fetch: transport,
          requestTimeoutMs: this.config.requestTimeoutMs,
          token: authorization.accessToken,
          validateResponses: policy.responseValidation.kind === 'enabled',
          allowGenericMutations: true,
        })
        return client.callOperation(
          representation.descriptor.operationId as StableOperationId,
          request as never,
          { confirmMutation: true },
        ) as unknown as Promise<EsiResponse<WireResult>>
      },
    )
    return { meta: response.meta, map: async () => representation.map(response, input) }
  }

  async #dispatchPlatformOperation(
    operation: EsiOperation,
    definition: PlatformExecutableEsiOperationDefinition,
    inputs: Readonly<Record<string, unknown>>,
    revalidation: EsiRevalidation,
    authorization?: { readonly accessToken: string; readonly principal: string },
    signal?: AbortSignal,
  ): Promise<EsiCanonicalLoad<unknown>> {
    const response = await this.#executeSdkAttempt(
      operation,
      authorization?.principal,
      signal,
      (transport) => {
        const client = new EsiClient({
          fetch: transport,
          requestTimeoutMs: this.config.requestTimeoutMs,
          ...(authorization ? { token: authorization.accessToken } : {}),
          validateResponses: definition.contract.responseValidation.kind === 'enabled',
        })
        return client.callOperation(
          definition.sdkOperationId,
          withEsiRevalidation(inputs, revalidation) as never,
        )
      },
    )
    signal?.throwIfAborted()
    return { meta: response.meta, map: async () => response.data }
  }

  #executeSdkAttempt<Data>(
    operation: EsiOperation,
    principal: string | undefined,
    executionSignal: AbortSignal | undefined,
    attempt: (transport: typeof globalThis.fetch) => Promise<EsiResponse<Data>>,
  ) {
    return executeEsiRequestAttempt({
      executionSignal,
      acquirePermit: (signal) =>
        this.ports.coordination.acquireRequestPermit({
          operation,
          principal,
          concurrency: this.config.operationConcurrency,
          localState: this.state.localQuota,
          signal,
        }),
      createTransport: (options) => this.ports.transport.create(options),
      attempt: (transport) =>
        this.#observeSdkCall(operation, principal, executionSignal, () => attempt(transport)),
    })
  }

  async #observeSdkCall<Data>(
    operation: EsiOperation,
    principal: string | undefined,
    signal: AbortSignal | undefined,
    call: () => Promise<EsiResponse<Data>>,
  ) {
    try {
      const response = await call()
      signal?.throwIfAborted()
      await this.#recordEsiResponseMetadata(operation, principal, response.meta)
      signal?.throwIfAborted()
      return response
    } catch (error) {
      signal?.throwIfAborted()
      const metadata = getEsiResponseErrorMetadata(error)
      if (metadata) await this.#recordEsiResponseMetadata(operation, principal, metadata)
      signal?.throwIfAborted()
      throw error
    }
  }

  async #recordEsiResponseMetadata(
    operation: EsiOperation,
    principal: string | undefined,
    metadata: EsiResponseMetadata,
  ) {
    void this.ports.cache.recordResponse(operation, principal, metadata).catch(() => {})
    await this.ports.coordination
      .recordResponse(operation, principal, metadata, this.state.localQuota)
      .catch(() => {})
  }

  #assertRegisteredRepresentation(
    representation: RegisteredEsiRepresentationReference,
    operation: EsiOperation,
    authorization: RegisteredEsiRepresentationReference['authorization'],
    execution: RegisteredEsiRepresentationReference['execution'],
  ) {
    if (!isRegisteredEsiRepresentation(representation))
      throw new Error(`ESI representation ${representation.name} was not registered`)
    if (representation.operation !== operation)
      throw new Error(
        `ESI representation ${representation.name} cannot execute operation ${operation}`,
      )
    if (representation.authorization !== authorization)
      throw new Error(
        `ESI representation ${representation.name} cannot execute with ${authorization} authorization`,
      )
    if (representation.execution !== execution)
      throw new Error(
        `ESI representation ${representation.name} cannot execute through the ${execution} path`,
      )
  }

  async #executeCharacter<Data>(
    resource: EsiExecutionResource<Data>,
    representationName: string,
    subjectLifecycleId: string,
  ) {
    resource.signal?.throwIfAborted()
    const characterId = resource.characterId
    if (!Number.isSafeInteger(characterId)) throw new Error('Character ESI identity is invalid')
    const policy: EsiOperationContract = getEsiOperationContract(resource.operation)
    if (policy.authorization.kind !== 'character')
      throw new Error(`ESI operation ${resource.operation} is not character-authorized`)
    const requiredScope = policy.authorization.scope
    const cacheAuthority = await this.#getCharacterCacheAuthorization(
      Number(characterId),
      subjectLifecycleId,
      requiredScope,
      resource.signal,
    )
    resource.signal?.throwIfAborted()
    const transportPrincipal = characterEsiPrincipal(Number(characterId))
    const principal = characterLifecycleEsiPrincipal(Number(characterId), subjectLifecycleId)
    const authorization = {
      cacheAuthorization: {
        kind: 'character' as const,
        principal,
        generation: cacheAuthority.tokenVersion,
      },
      transportPrincipal,
      resolve: (signal?: AbortSignal) =>
        this.#getCharacterAuthorization(
          Number(characterId),
          subjectLifecycleId,
          requiredScope,
          signal,
        ),
      recheckCacheAuthorization: async (signal?: AbortSignal) =>
        (
          await this.#getCharacterCacheAuthorization(
            Number(characterId),
            subjectLifecycleId,
            requiredScope,
            signal,
          )
        ).tokenVersion,
    }
    const execution = await this.#recordCharacterResult(
      resource.operation,
      this.#getCharacterAuthorized(
        resource,
        authorization,
        authorization.cacheAuthorization,
        representationName,
      ),
      resource.signal,
    )
    return execution.result
  }

  #getCharacterCacheAuthorization(
    characterId: number,
    lifecycleId: string,
    requiredScope: string,
    signal?: AbortSignal,
  ) {
    return signal
      ? this.ports.authorization.getCacheAuthorization(
          characterId,
          lifecycleId,
          requiredScope,
          signal,
        )
      : this.ports.authorization.getCacheAuthorization(characterId, lifecycleId, requiredScope)
  }

  #getCharacterAuthorization(
    characterId: number,
    lifecycleId: string,
    requiredScope: string,
    signal?: AbortSignal,
  ) {
    return signal
      ? this.ports.authorization.getAuthorization(characterId, lifecycleId, requiredScope, signal)
      : this.ports.authorization.getAuthorization(characterId, lifecycleId, requiredScope)
  }

  async #executeCharacterMutation<Data>(
    mutation: EsiExecutionResource<Data> & { characterId: number },
    subjectLifecycleId: string,
  ): Promise<EsiLoadResult<Data>> {
    if (!isPositiveSafeInteger(mutation.characterId))
      throw new Error('Character ESI identity is invalid')
    const policy: EsiOperationContract = getEsiOperationContract(mutation.operation)
    if (!policy.mutation || policy.authorization.kind !== 'character')
      throw new Error(`ESI operation ${mutation.operation} is not a character mutation`)
    const principal = characterEsiPrincipal(mutation.characterId)
    let load: EsiCanonicalLoad<Data>
    try {
      load = await this.ports.authorization.withAuthorization(
        mutation.characterId,
        subjectLifecycleId,
        policy.authorization.scope,
        (authority) =>
          this.#loadWithRetry(
            {
              operation: mutation.operation,
              inputs: mutation.inputs,
              signal: mutation.signal,
              load: () => mutation.load({ accessToken: authority.accessToken, principal }, {}),
            },
            {},
            undefined,
            policy,
          ),
        mutation.signal,
      )
    } catch (error) {
      if (shouldAdvanceRevisionAfterMutationError(policy, error))
        await this.#resourceRevisions.advance(policy, principal)
      throw toEsiQuotaError(error, this.ports.timing.now())
    }
    await this.#resourceRevisions.advance(policy, principal)
    return { data: await load.map(), meta: load.meta }
  }

  async #getCharacterAuthorized<Data>(
    resource: EsiExecutionResource<Data>,
    authorization: CharacterEsiAuthorizationResolver,
    cacheAuthorization = authorization.cacheAuthorization,
    representationName?: string,
  ): Promise<CharacterEsiExecutionResult<Data>> {
    resource.signal?.throwIfAborted()
    let authorizationGeneration = cacheAuthorization.generation
    const result = await this.#get({
      operation: resource.operation,
      inputs: resource.inputs,
      representationName,
      authorization: cacheAuthorization,
      resourceRevisionPrincipal: authorization.transportPrincipal,
      signal: resource.signal,
      resolveAuthorization: async () => {
        const resolved = await authorization.resolve(resource.signal)
        resource.signal?.throwIfAborted()
        authorizationGeneration = resolved.tokenVersion
        return {
          authorization: {
            ...cacheAuthorization,
            generation: resolved.tokenVersion,
          },
          load: (revalidation) =>
            resource.load(
              {
                accessToken: resolved.accessToken,
                principal: authorization.transportPrincipal,
              },
              revalidation,
            ),
        }
      },
    })
    const currentGeneration = await authorization.recheckCacheAuthorization(resource.signal)
    resource.signal?.throwIfAborted()
    if (currentGeneration === authorizationGeneration) return { result, authorizationGeneration }
    return this.#getCharacterAuthorized(
      resource,
      authorization,
      {
        ...cacheAuthorization,
        generation: currentGeneration,
      },
      representationName,
    )
  }

  async #recordCharacterResult<Data>(
    operation: EsiOperation,
    pending: Promise<CharacterEsiExecutionResult<Data>>,
    signal?: AbortSignal,
  ) {
    try {
      const execution = await pending
      recordEsiCacheSource(operation, execution.result.source, execution.result.stale)
      return execution
    } catch (error) {
      signal?.throwIfAborted()
      this.state.markErrorCompleted(error)
      throw error
    }
  }

  async #recordResult<Data>(
    operation: EsiOperation,
    pending: Promise<EsiCachedResult<Data>>,
    signal?: AbortSignal,
  ) {
    try {
      const result = await pending
      recordEsiCacheSource(operation, result.source, result.stale)
      return result
    } catch (error) {
      signal?.throwIfAborted()
      this.state.markErrorCompleted(error)
      throw error
    }
  }

  async #get<Data>(resource: InternalEsiResource<Data>): Promise<EsiCachedResult<Data>> {
    resource.signal?.throwIfAborted()
    const policy = resolveRuntimeEsiOperationContract(
      getEsiOperationContract(resource.operation),
      this.config,
    )
    const resourceRevision = await this.#resourceRevisions.resolve(
      policy,
      resource.authorization,
      resource.signal,
      resource.resourceRevisionPrincipal,
    )
    resource.signal?.throwIfAborted()
    if (resourceRevision === null) return this.#loadUncached(resource)
    const identity = createEsiRepresentationIdentity({
      operation: resource.operation,
      inputs: resource.inputs,
      compatibilityDate: this.config.compatibilityDate,
      representationVersion: policy.representationVersion,
      representationName: resource.representationName,
      resourceRevision,
    })
    if (policy.cache.kind === 'none') return this.#loadUncached(resource)

    const dependencies = await this.#resolveDependencies(resource.signal)
    resource.signal?.throwIfAborted()
    const context: EsiRequestContext<Data> = {
      resource,
      identity,
      key: cacheEnvelopeKey(dependencies.namespace, identity),
      policy,
      dependencies,
    }
    const envelope = await this.#readCachedEnvelope(context)
    resource.signal?.throwIfAborted()

    if (envelope && isEnvelopeFresh(envelope, this.ports.timing.now()))
      return toCachedResult(envelope, 'cache', false)

    return this.#loadWithRequestCollapse(
      context,
      envelope && isEnvelopeRetained(envelope, this.ports.timing.now()) ? envelope : undefined,
    )
  }

  async #readCachedEnvelope<Data>(context: EsiRequestContext<Data>) {
    const l1Envelope = this.#readL1<Data>(context)
    if (l1Envelope || !context.dependencies.canReadL2) return l1Envelope

    const l2Envelope = await this.#readL2<Data>(context)
    context.resource.signal?.throwIfAborted()
    if (l2Envelope) this.state.l1.set(context.key, l2Envelope)
    return l2Envelope
  }

  async #loadWithRequestCollapse<Data>(
    context: EsiRequestContext<Data>,
    stale: EsiCacheEnvelope<Data> | undefined,
  ): Promise<EsiCachedResult<Data>> {
    const { policy } = context
    if (
      !context.dependencies.canCoordinate ||
      policy.cache.kind !== 'shared' ||
      !policy.cache.collapse
    )
      return this.#loadAndStore(context, stale, undefined)

    let lease: EsiRequestLease | undefined
    try {
      lease = await this.ports.coordination.acquireRequestLease(context.identity)
      if (context.resource.signal?.aborted) {
        await this.#releaseLease(lease)
        context.resource.signal.throwIfAborted()
      }
      context.resource.signal?.throwIfAborted()
    } catch {
      context.resource.signal?.throwIfAborted()
      this.state.namespaceValidatedAt = 0
      return this.#loadAndStore(withoutL2Writes(context), stale, undefined)
    }
    if (lease) return this.#loadAndStore(context, stale, lease)

    try {
      const follower = await this.#waitForLeaseOrPublication(context)
      if (follower.coordinationUnavailable)
        return this.#loadAndStore(withoutL2Writes(context), stale, undefined)
      if (follower.published) return toCachedResult(follower.published, 'cache', false)
      return this.#loadAndStore(context, stale, follower.lease)
    } catch (error) {
      context.resource.signal?.throwIfAborted()
      return this.#serveStaleOrThrow(stale, policy, error)
    }
  }

  async #loadUncached<Data>(resource: InternalEsiResource<Data>): Promise<EsiCachedResult<Data>> {
    const policy = resolveRuntimeEsiOperationContract(
      getEsiOperationContract(resource.operation),
      this.config,
    )
    let resolved: ResolvedInternalEsiResource<Data>
    let load: EsiCanonicalLoad<Data>
    try {
      resolved = await this.#resolveResourceAuthorization(resource)
      resource.signal?.throwIfAborted()
      load = await this.#loadWithRetry(resolved, {}, undefined, policy)
    } catch (error) {
      resource.signal?.throwIfAborted()
      throw toEsiQuotaError(error, this.ports.timing.now())
    }
    const result = { data: await load.map(), meta: load.meta }
    resource.signal?.throwIfAborted()
    const envelope = createCacheEnvelope({
      data: result.data,
      metadata: result.meta,
      policy,
      representationVersion: composeEnvelopeRepresentationVersion(
        policy.representationVersion,
        resolved.representationName,
      ),
      authorization: resolved.authorization,
      fence: 0,
      maximumRetentionMs: this.config.cacheMaximumRetentionMs,
      now: this.ports.timing.now(),
    })
    return toCachedResult(envelope, 'esi', false, undefined, getEsiQuota(result.meta))
  }

  async #loadAndStore<Data>(
    context: EsiRequestContext<Data>,
    stale: EsiCacheEnvelope<Data> | undefined,
    lease: EsiRequestLease | undefined,
  ): Promise<EsiCachedResult<Data>> {
    const stopRenewal = this.#renewLease(lease)
    let fallback = stale
    try {
      let resolvedContext: ResolvedEsiRequestContext<Data>
      try {
        const resource = await this.#resolveResourceAuthorization(context.resource)
        context.resource.signal?.throwIfAborted()
        resolvedContext = { ...context, resource }
      } catch (error) {
        context.resource.signal?.throwIfAborted()
        return await this.#recoverLoadFailure(context, stale, fallback, lease, error)
      }
      const { resource } = resolvedContext
      if (!hasMatchingAuthorization(stale, resource.authorization)) fallback = undefined
      let load: EsiCanonicalLoad<Data>
      try {
        load = await this.#loadWithRetry(
          resource,
          toRevalidation(
            stale,
            context.policy.cache.kind !== 'none' && context.policy.cache.revalidate,
          ),
          fallback,
          context.policy,
        )
      } catch (error) {
        context.resource.signal?.throwIfAborted()
        return await this.#recoverLoadFailure(resolvedContext, stale, fallback, lease, error)
      }
      return await this.#mapAndPublish(resolvedContext, load, lease)
    } finally {
      stopRenewal?.()
      await this.#releaseLease(lease)
    }
  }

  async #mapAndPublish<Data>(
    context: ResolvedEsiRequestContext<Data>,
    load: EsiCanonicalLoad<Data>,
    lease: EsiRequestLease | undefined,
  ) {
    const { policy } = context
    const response = { data: await load.map(), meta: load.meta }
    context.resource.signal?.throwIfAborted()
    const envelope = createCacheEnvelope({
      data: response.data,
      metadata: response.meta,
      policy,
      representationVersion: composeEnvelopeRepresentationVersion(
        context.identity.representationVersion,
        context.identity.representationName,
      ),
      authorization: context.resource.authorization,
      resourceRevision: context.identity.resourceRevision,
      fence: lease?.fence ?? 0,
      maximumRetentionMs: this.config.cacheMaximumRetentionMs,
      now: this.ports.timing.now(),
    })
    if (await this.#publish(context, envelope, lease)) this.state.l1.set(context.key, envelope)
    context.resource.signal?.throwIfAborted()
    return toCachedResult(envelope, 'esi', false, undefined, getEsiQuota(response.meta))
  }

  async #loadWithRetry<Data>(
    resource: ResolvedInternalEsiResource<Data>,
    revalidation: EsiRevalidation,
    stale: EsiCacheEnvelope<Data> | undefined,
    policy: EsiOperationContract,
  ) {
    const attempts = policy.retry.kind === 'idempotent' ? policy.retry.attempts : 1
    let delay = policy.retry.kind === 'idempotent' ? policy.retry.initialDelayMilliseconds : 0
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      resource.signal?.throwIfAborted()
      try {
        // oxlint-disable-next-line no-await-in-loop
        return await resource.load(revalidation)
      } catch (error) {
        resource.signal?.throwIfAborted()
        if (
          // Prefer an already validated stale value over spending more upstream attempts.
          this.#canServeStale(stale, policy, error) ||
          attempt === attempts ||
          !shouldRetryEsiError(error, this.state)
        )
          throw error
        // oxlint-disable-next-line no-await-in-loop
        await this.ports.timing.wait(this.ports.timing.randomInteger(delay + 1), resource.signal)
        if (policy.retry.kind === 'idempotent')
          delay = Math.min(delay * 2, policy.retry.maximumDelayMilliseconds)
      }
    }
    throw new Error('ESI retry attempts were exhausted')
  }

  async #recoverLoadFailure<Data>(
    context: EsiRequestContext<Data>,
    revalidationEnvelope: EsiCacheEnvelope<Data> | undefined,
    fallbackEnvelope: EsiCacheEnvelope<Data> | undefined,
    lease: EsiRequestLease | undefined,
    error: unknown,
  ): Promise<EsiCachedResult<Data>> {
    context.resource.signal?.throwIfAborted()
    if (error instanceof EsiNotModifiedError && revalidationEnvelope) {
      const metadata = error.metadata
      const envelope = updateNotModifiedEnvelope({
        envelope: revalidationEnvelope,
        metadata,
        policy: context.policy,
        fence: lease?.fence,
        authorization: context.resource.authorization,
        maximumRetentionMs: this.config.cacheMaximumRetentionMs,
        now: this.ports.timing.now(),
      })
      if (await this.#publish(context, envelope, lease)) this.state.l1.set(context.key, envelope)
      context.resource.signal?.throwIfAborted()
      return toCachedResult(envelope, 'not-modified', false, undefined, getEsiQuota(metadata))
    }
    return this.#serveStaleOrThrow(
      fallbackEnvelope,
      context.policy,
      toEsiQuotaError(error, this.ports.timing.now()),
    )
  }

  async #resolveResourceAuthorization<Data>(
    resource: InternalEsiResource<Data>,
  ): Promise<ResolvedInternalEsiResource<Data>> {
    if (!resource.resolveAuthorization) return resource
    const { authorization, load } = await resource.resolveAuthorization()
    return {
      operation: resource.operation,
      inputs: resource.inputs,
      representationName: resource.representationName,
      authorization,
      signal: resource.signal,
      load,
    }
  }

  #serveStaleOrThrow<Data>(
    stale: EsiCacheEnvelope<Data> | undefined,
    policy: EsiOperationContract,
    error: unknown,
  ): EsiCachedResult<Data> {
    if (!this.#canServeStale(stale, policy, error)) throw error
    const retryAt = error instanceof EsiQuotaError ? error.retryAt.toISOString() : undefined
    return toCachedResult(stale, 'cache', true, retryAt, {}, classifyEsiRefreshFailure(error))
  }

  #canServeStale<Data>(
    stale: EsiCacheEnvelope<Data> | undefined,
    policy: EsiOperationContract,
    error: unknown,
  ): stale is EsiCacheEnvelope<Data> {
    return Boolean(
      stale &&
      policy.cache.kind !== 'none' &&
      isEnvelopeRetained(stale, this.ports.timing.now()) &&
      isEnvelopeStaleUsable(stale, this.ports.timing.now()) &&
      isStaleUsableForFailure(policy.cache.stale, error),
    )
  }

  #renewLease(lease: EsiRequestLease | undefined) {
    if (!lease) return undefined
    return this.ports.timing.repeat(
      () => void this.ports.coordination.renewRequestLease(lease).catch(() => {}),
      Math.floor(lease.ttlMs / 2),
    )
  }

  async #releaseLease(lease: EsiRequestLease | undefined) {
    if (lease) await this.ports.coordination.releaseRequestLease(lease).catch(() => {})
  }

  async #waitForLeaseOrPublication<Data>(context: EsiRequestContext<Data>): Promise<{
    lease: EsiRequestLease | undefined
    published?: EsiCacheEnvelope<Data>
    coordinationUnavailable?: true
  }> {
    const deadline = this.ports.timing.now() + this.config.operationQueueTimeoutMs
    while (this.ports.timing.now() < deadline) {
      context.resource.signal?.throwIfAborted()
      let ttlMs: number
      try {
        // oxlint-disable-next-line no-await-in-loop
        ttlMs = await this.ports.coordination.getRequestLeaseTtl(context.identity)
        context.resource.signal?.throwIfAborted()
      } catch {
        context.resource.signal?.throwIfAborted()
        this.state.namespaceValidatedAt = 0
        return { lease: undefined, coordinationUnavailable: true }
      }
      if (ttlMs > 0) {
        // oxlint-disable-next-line no-await-in-loop
        await this.ports.timing.wait(
          Math.min(followerWaitMs, ttlMs, Math.max(1, deadline - this.ports.timing.now())),
          context.resource.signal,
        )
        // oxlint-disable-next-line no-await-in-loop
        const published = await this.#readL2<Data>(context)
        context.resource.signal?.throwIfAborted()
        if (published && isEnvelopeFresh(published, this.ports.timing.now())) {
          this.state.l1.set(context.key, published)
          return { lease: undefined, published }
        }
      }
      let lease: EsiRequestLease | undefined
      try {
        // oxlint-disable-next-line no-await-in-loop
        lease = await this.ports.coordination.acquireRequestLease(context.identity)
        if (context.resource.signal?.aborted) {
          // oxlint-disable-next-line no-await-in-loop
          await this.#releaseLease(lease)
          context.resource.signal.throwIfAborted()
        }
        context.resource.signal?.throwIfAborted()
      } catch {
        context.resource.signal?.throwIfAborted()
        this.state.namespaceValidatedAt = 0
        return { lease: undefined, coordinationUnavailable: true }
      }
      if (lease) return { lease }
    }
    throw new EsiRequestWaitTimeoutError()
  }

  async #resolveDependencies(signal?: AbortSignal): Promise<EsiCacheDependencies> {
    signal?.throwIfAborted()
    if (this.state.namespaceValidatedAt + namespaceValidationIntervalMs > this.ports.timing.now())
      return this.#availableDependencies()

    try {
      this.state.namespaceInitialization ??= this.ports.coordination.initializeCacheNamespace()
      const namespace = await this.state.namespaceInitialization
      signal?.throwIfAborted()
      if (namespace !== this.state.namespace) {
        this.state.namespace = namespace
        this.state.l1.clear()
      }
      this.state.namespaceValidatedAt = this.ports.timing.now()
      return this.#availableDependencies()
    } catch {
      signal?.throwIfAborted()
      // Coordination loss invalidates every distributed fence; only L1 may be used conservatively.
      this.state.namespaceValidatedAt = 0
      return {
        namespace: this.state.namespace,
        canCoordinate: false,
        canReadL2: false,
        canWriteL2: false,
      }
    } finally {
      this.state.namespaceInitialization = undefined
    }
  }

  #availableDependencies(): EsiCacheDependencies {
    return {
      namespace: this.state.namespace,
      canCoordinate: true,
      canReadL2: true,
      canWriteL2: true,
    }
  }

  #readL1<Data>(context: EsiRequestContext<Data>) {
    const envelope = this.state.l1.get<Data>(context.key)
    if (!envelope) return undefined
    if (
      !isCompatibleEnvelope(envelope, context) ||
      !isEnvelopeRetained(envelope, this.ports.timing.now())
    ) {
      this.state.l1.delete(context.key)
      return undefined
    }
    return envelope
  }

  async #readL2<Data>(context: EsiRequestContext<Data>) {
    try {
      const [serialized, committedFence] = await Promise.all([
        this.ports.cache.get(context.key),
        this.ports.coordination.getCommittedFence(context.identity),
      ])
      context.resource.signal?.throwIfAborted()
      if (!serialized || committedFence === undefined) return undefined
      const parsed = parseEnvelope<Data>(serialized)
      if (!parsed.success) {
        recordEsiCacheEnvelopeRejection(parsed)
        return undefined
      }
      const envelope = parsed.envelope
      if (
        !isCompatibleEnvelope(envelope, context) ||
        envelope.fence !== committedFence ||
        !isEnvelopeRetained(envelope, this.ports.timing.now())
      )
        return undefined
      return envelope
    } catch {
      context.resource.signal?.throwIfAborted()
      return undefined
    }
  }

  async #publish<Data>(
    context: EsiRequestContext<Data>,
    envelope: EsiCacheEnvelope<Data>,
    lease: EsiRequestLease | undefined,
  ) {
    if (!context.dependencies.canWriteL2 || !lease) return true
    const committed = await this.ports.coordination
      .commitFence(context.identity, lease)
      .catch(() => false)
    context.resource.signal?.throwIfAborted()
    if (!committed) return false
    const ttlMs = Math.max(1, envelope.retainUntil - this.ports.timing.now())
    await this.ports.cache.set(context.key, JSON.stringify(envelope), ttlMs).catch(() => {})
    context.resource.signal?.throwIfAborted()
    return true
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise
    this.#closed = true
    this.#closePromise = Promise.allSettled(this.#activeOperations).then(() => this.state.clear())
    return this.#closePromise
  }

  #assertOpen() {
    if (this.#closed) throw new Error('ESI execution runtime is closed')
  }

  #track<Result>(pending: Promise<Result>): Promise<Result> {
    const tracked = pending.finally(() => this.#activeOperations.delete(tracked))
    this.#activeOperations.add(tracked)
    return tracked
  }
}

function resolveRuntimeEsiOperationContract(
  policy: EsiOperationContract,
  config: EsiExecutionRuntimeConfig,
): EsiOperationContract {
  if (policy.cache.kind !== 'shared' || policy.cache.runtimeRetention !== 'private') return policy
  return {
    ...policy,
    cache: {
      ...policy.cache,
      stale:
        config.privateRetentionMs > 0
          ? { kind: 'outage', milliseconds: config.privateRetentionMs }
          : { kind: 'none' },
      retentionMilliseconds: config.privateRetentionMs,
    },
  }
}

function characterIdFromRequest(request: OperationRequestArguments) {
  const characterId = isRecord(request.path) ? request.path.character_id : undefined
  if (!Number.isSafeInteger(characterId)) throw new Error('Character ESI identity is invalid')
  return Number(characterId)
}

function toCachedResult<Data>(
  envelope: EsiCacheEnvelope<Data>,
  source: EsiCachedResult<Data>['source'],
  stale: boolean,
  retryAt?: string,
  quota: EsiCachedResult<Data>['quota'] = {},
  refreshFailureClass?: NonNullable<EsiCachedResult<Data>['refreshFailureClass']>,
): EsiCachedResult<Data> {
  return {
    data: envelope.data,
    cachedUntil: new Date(envelope.freshUntil).toISOString(),
    validatedAt: envelope.validatedAt,
    source,
    stale,
    ...(retryAt ? { retryAt } : {}),
    ...(refreshFailureClass ? { refreshFailureClass } : {}),
    quota,
  }
}

function withoutL2Writes<Data>(context: EsiRequestContext<Data>): EsiRequestContext<Data> {
  return { ...context, dependencies: { ...context.dependencies, canWriteL2: false } }
}

function isCompatibleEnvelope(
  envelope: EsiCacheEnvelope<unknown>,
  { identity, resource }: EsiRequestContext<unknown>,
) {
  const authorization = resource.authorization
  if (
    envelope.representationVersion !==
    composeEnvelopeRepresentationVersion(
      identity.representationVersion,
      identity.representationName,
    )
  )
    return false
  if (!identity.resourceRevision) {
    if (envelope.resourceRevision !== undefined) return false
  } else if (
    envelope.resourceRevision?.namespace !== identity.resourceRevision.namespace ||
    envelope.resourceRevision.value !== identity.resourceRevision.value
  )
    return false
  return hasMatchingAuthorization(envelope, authorization)
}

function hasMatchingAuthorization(
  envelope: EsiCacheEnvelope<unknown> | undefined,
  authorization: EsiCacheAuthorization | undefined,
) {
  if (!envelope) return true
  if (!authorization) return envelope.authorization === undefined
  return (
    envelope.authorization?.kind === 'character' &&
    envelope.authorization.principal === authorization.principal &&
    envelope.authorization.generation === authorization.generation
  )
}
