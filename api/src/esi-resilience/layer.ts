import { randomInt } from 'node:crypto'
import { EsiClient, type EsiResponse } from '@evespace/esi-client'
import type { PlatformExecutableEsiOperationDefinition } from '@eve-space/platform-module-server'
import type { OperationRequestArguments, StableOperationId } from '@evespace/esi-client/operations'
import { env } from '../env.js'
import { isPositiveSafeInteger, isRecord } from '../type-guards.js'
import {
  getCharacterAuthorization,
  getCharacterAuthorizationForLifecycle,
  getCharacterCacheAuthorization,
  getCharacterCacheAuthorizationForLifecycle,
  type CharacterAuthorization,
} from '../auth/tokens.js'
import { getSharedCacheRedisConnection, type CacheRedisConnection } from './cache-redis.js'
import { getEsiOperationContract } from './catalog-access.js'
import { type CharacterMutationEsiOperation, type EsiOperation } from './catalog.js'
import type { EsiOperationContract } from './contract-types.js'
import {
  acquireEsiRequestLease,
  commitEsiFence,
  getCommittedEsiFence,
  getEsiRequestLeaseTtl,
  initializeCacheNamespace,
  renewEsiRequestLease,
  releaseEsiRequestLease,
  type EsiRequestLease,
} from './coordination.js'
import { EsiQuotaError, recordEsiResponse } from './cooldowns.js'
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
import { BoundedEsiL1Cache } from './l1-cache.js'
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
  classifyStaleRefreshFailure,
  getErrorMetadata,
  getErrorStatus,
  isStaleUsableForFailure,
  markEsiOperationErrorCompleted,
  shouldAdvanceRevisionAfterMutationError,
  shouldRetryEsiError,
  toEsiQuotaError,
} from './errors.js'
import {
  recordEsiCacheEnvelopeRejection,
  recordEsiCacheSource,
  recordEsiUpstreamOutcome,
} from './telemetry-counters.js'
import { wait } from './timing.js'
import { createRawEsiTransport, getCoordinationConnection } from './transport.js'
import { assertNoCallerEsiRevalidationHeaders, withEsiRevalidation } from './revalidation.js'
import { acquireEsiRequestPermit, type EsiRequestPermit } from './permits.js'
import { recordEsiRateMeasurement } from './rate-measurement.js'
import type {
  EsiCacheAuthorization,
  EsiCachedResult,
  EsiCacheEnvelope,
  EsiLoadResult,
  EsiRevalidation,
} from './types.js'
import type { QueueRedisConnection } from '../queue/redis.js'

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
  resolve(): Promise<CharacterAuthorization>
  recheckCacheAuthorization(): Promise<number>
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
  load(revalidation: EsiRevalidation): Promise<EsiCanonicalLoad<Data>>
  resolveAuthorization?: undefined
}

/** Defers token decryption and refresh until after the cache lookup, so a hit never decrypts. */
interface LazyInternalEsiResource<Data> {
  operation: EsiOperation
  inputs: Readonly<Record<string, unknown>>
  representationName?: string
  authorization: EsiCacheAuthorization
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

class EsiResilienceLayer {
  readonly #l1: BoundedEsiL1Cache
  readonly #authorizeCharacter: typeof getCharacterAuthorization
  readonly #authorizeCharacterCache: typeof getCharacterCacheAuthorization
  #namespace = 'unavailable'
  #namespaceValidatedAt = 0
  #namespaceInitialization: Promise<string> | undefined
  readonly #resourceRevisions: EsiResourceRevisionRegistry

  constructor(
    private readonly cache: CacheRedisConnection,
    private readonly coordination: QueueRedisConnection,
    l1Capacity = env.ESI_CACHE_L1_MAX_ENTRIES,
    authorizers:
      | {
          full: typeof getCharacterAuthorization
          cache: typeof getCharacterCacheAuthorization
        }
      | undefined = undefined,
  ) {
    this.#l1 = new BoundedEsiL1Cache(l1Capacity)
    this.#authorizeCharacter = authorizers?.full ?? getCharacterAuthorization
    this.#authorizeCharacterCache = authorizers?.cache ?? getCharacterCacheAuthorization
    this.#resourceRevisions = new EsiResourceRevisionRegistry(cache, coordination, () =>
      this.#l1.clear(),
    )
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
  ): Promise<EsiCachedResult<Result>> {
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
      load: (authorization, revalidation) =>
        this.#dispatchRepresentation(representation, input, request, revalidation, authorization),
    }
    if (representation.authorization === 'public')
      return this.#recordResult(
        representation.operation,
        this.#get({
          ...resource,
          representationName: representation.name,
          load: (revalidation) => resource.load(undefined, revalidation),
        }),
      )

    return this.#executeCharacter(
      { ...resource, characterId: characterIdFromRequest(request) },
      representation.name,
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
  ): Promise<Result> {
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
    const result = await this.#executeCharacterMutation({
      operation: representation.operation,
      characterId: characterIdFromRequest(request),
      inputs: request,
      load: (authorization) => {
        if (!authorization) throw new Error('Character ESI authorization is required')
        return this.#dispatchMutation(representation, input, request, authorization)
      },
    })
    return result.data
  }

  async executePlatformOperation(
    request: {
      readonly operation: EsiOperation
      readonly definition: PlatformExecutableEsiOperationDefinition
      readonly authorization:
        | { readonly kind: 'public' }
        | {
            readonly kind: 'character-lifecycle'
            readonly characterId: number
            readonly lifecycleId: string
            readonly generation: number
          }
    },
    inputs: Readonly<Record<string, unknown>>,
  ): Promise<CharacterEsiExecutionResult<unknown>> {
    const contract: EsiOperationContract = getEsiOperationContract(request.operation)
    if (contract.authorization.kind === 'public') {
      const result = await this.#recordResult(
        request.operation,
        this.#get({
          operation: request.operation,
          inputs,
          load: (revalidation) =>
            this.#dispatchPlatformOperation(
              request.operation,
              request.definition,
              inputs,
              revalidation,
            ),
        }),
      )
      return { result, authorizationGeneration: 0 }
    }

    if (request.authorization.kind !== 'character-lifecycle')
      throw new Error('Character platform ESI operation requires lifecycle authority')
    const authorization = request.authorization
    const requiredScope = contract.authorization.scope
    return this.#recordCharacterResult(
      request.operation,
      this.#getCharacterAuthorized(
        {
          operation: request.operation,
          inputs,
          load: (authority, revalidation) => {
            if (!authority) throw new Error('Character ESI authorization is required')
            return this.#dispatchPlatformOperation(
              request.operation,
              request.definition,
              inputs,
              revalidation,
              authority,
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
  ): Promise<EsiCanonicalLoad<Result>> {
    const policy = getEsiOperationContract(representation.operation)
    const client = new EsiClient({
      fetch: this.#createTransport(representation.operation, authorization?.principal),
      ...(authorization ? { token: authorization.accessToken } : {}),
      validateResponses: policy.responseValidation.kind === 'enabled',
    })
    let response: EsiResponse<WireResult>
    try {
      response = (await client.callOperation(
        representation.descriptor.operationId as StableOperationId,
        withEsiRevalidation(request, revalidation) as never,
      )) as unknown as EsiResponse<WireResult>
    } catch (error) {
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
    const client = new EsiClient({
      fetch: this.#createTransport(representation.operation, authorization.principal),
      token: authorization.accessToken,
      validateResponses: policy.responseValidation.kind === 'enabled',
      allowGenericMutations: true,
    })
    const response = (await client.callOperation(
      representation.descriptor.operationId as StableOperationId,
      request as never,
      { confirmMutation: true },
    )) as unknown as EsiResponse<WireResult>
    return { meta: response.meta, map: async () => representation.map(response, input) }
  }

  async #dispatchPlatformOperation(
    operation: EsiOperation,
    definition: PlatformExecutableEsiOperationDefinition,
    inputs: Readonly<Record<string, unknown>>,
    revalidation: EsiRevalidation,
    authorization?: { readonly accessToken: string; readonly principal: string },
  ): Promise<EsiCanonicalLoad<unknown>> {
    const client = new EsiClient({
      fetch: this.#createTransport(operation, authorization?.principal),
      ...(authorization ? { token: authorization.accessToken } : {}),
      validateResponses: definition.contract.responseValidation.kind === 'enabled',
    })
    const response = await client.callOperation(
      definition.sdkOperationId,
      withEsiRevalidation(inputs, revalidation) as never,
    )
    return { meta: response.meta, map: async () => response.data }
  }

  #createTransport(operation: EsiOperation, principal?: string): typeof globalThis.fetch {
    return async (input, init) => {
      const permit = await acquireEsiRequestPermit({
        connection: getCoordinationConnection(),
        operation,
        principal,
        concurrency: env.ESI_OPERATION_CONCURRENCY,
      })
      const permitLifecycle = new EsiRequestPermitLifecycle(permit)
      const transport = createRawEsiTransport({
        onResponseBodySettled: () => void permitLifecycle.release(),
      })
      try {
        const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
        const signal = callerSignal
          ? AbortSignal.any([callerSignal, permitLifecycle.signal])
          : permitLifecycle.signal
        const response = await transport(input, { ...init, signal })
        const cache = getSharedCacheRedisConnection()
        void Promise.all([
          recordEsiRateMeasurement(cache, { operation, principal, status: response.status }),
          recordEsiUpstreamOutcome(
            cache,
            operation,
            response.status,
            response.headers.get('x-ratelimit-group'),
          ),
        ]).catch(() => {})
        await recordEsiResponse({
          connection: getCoordinationConnection(),
          operation,
          principal,
          status: response.status,
          headers: response.headers,
        }).catch(() => {})
        return response
      } catch (error) {
        await permitLifecycle.release()
        throw error
      }
    }
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

  async #executeCharacter<Data>(resource: EsiExecutionResource<Data>, representationName: string) {
    const characterId = resource.characterId
    if (!Number.isSafeInteger(characterId)) throw new Error('Character ESI identity is invalid')
    const policy: EsiOperationContract = getEsiOperationContract(resource.operation)
    if (policy.authorization.kind !== 'character')
      throw new Error(`ESI operation ${resource.operation} is not character-authorized`)
    const requiredScope = policy.authorization.scope
    const cacheAuthority = await this.#authorizeCharacterCache(Number(characterId), requiredScope)
    const principal = characterEsiPrincipal(Number(characterId))
    const authorization = {
      cacheAuthorization: {
        kind: 'character' as const,
        principal,
        generation: cacheAuthority.tokenVersion,
      },
      transportPrincipal: principal,
      resolve: () => this.#authorizeCharacter(Number(characterId), requiredScope),
      recheckCacheAuthorization: async () =>
        (await this.#authorizeCharacterCache(Number(characterId), requiredScope)).tokenVersion,
    }
    const execution = await this.#recordCharacterResult(
      resource.operation,
      this.#getCharacterAuthorized(
        resource,
        authorization,
        authorization.cacheAuthorization,
        representationName,
      ),
    )
    return execution.result
  }

  async #executeCharacterMutation<Data>(
    mutation: EsiExecutionResource<Data> & { characterId: number },
  ): Promise<EsiLoadResult<Data>> {
    if (!isPositiveSafeInteger(mutation.characterId))
      throw new Error('Character ESI identity is invalid')
    const policy: EsiOperationContract = getEsiOperationContract(mutation.operation)
    if (!policy.mutation || policy.authorization.kind !== 'character')
      throw new Error(`ESI operation ${mutation.operation} is not a character mutation`)
    const authority = await this.#authorizeCharacter(
      mutation.characterId,
      policy.authorization.scope,
    )
    const principal = characterEsiPrincipal(mutation.characterId)
    let load: EsiCanonicalLoad<Data>
    try {
      load = await this.#loadWithRetry(
        {
          operation: mutation.operation,
          inputs: mutation.inputs,
          load: () => mutation.load({ accessToken: authority.accessToken, principal }, {}),
        },
        {},
        undefined,
        policy,
      )
    } catch (error) {
      if (shouldAdvanceRevisionAfterMutationError(policy, error))
        await this.#resourceRevisions.advance(policy, principal)
      throw toEsiQuotaError(error)
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
    let authorizationGeneration = cacheAuthorization.generation
    const result = await this.#get({
      operation: resource.operation,
      inputs: resource.inputs,
      representationName,
      authorization: cacheAuthorization,
      resolveAuthorization: async () => {
        const resolved = await authorization.resolve()
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
    if (result.source !== 'cache') return { result, authorizationGeneration }

    const currentGeneration = await authorization.recheckCacheAuthorization()
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
  ) {
    try {
      const execution = await pending
      recordEsiCacheSource(operation, execution.result.source, execution.result.stale)
      return execution
    } catch (error) {
      markEsiOperationErrorCompleted(error)
      throw error
    }
  }

  async #recordResult<Data>(operation: EsiOperation, pending: Promise<EsiCachedResult<Data>>) {
    try {
      const result = await pending
      recordEsiCacheSource(operation, result.source, result.stale)
      return result
    } catch (error) {
      markEsiOperationErrorCompleted(error)
      throw error
    }
  }

  async #get<Data>(resource: InternalEsiResource<Data>): Promise<EsiCachedResult<Data>> {
    const policy = getEsiOperationContract(resource.operation)
    const resourceRevision = await this.#resourceRevisions.resolve(policy, resource.authorization)
    if (resourceRevision === null) return this.#loadUncached(resource)
    const identity = createEsiRepresentationIdentity({
      operation: resource.operation,
      inputs: resource.inputs,
      compatibilityDate: env.ESI_COMPATIBILITY_DATE,
      representationVersion: policy.representationVersion,
      representationName: resource.representationName,
      resourceRevision,
    })
    if (policy.cache.kind === 'none') return this.#loadUncached(resource)

    const dependencies = await this.#resolveDependencies()
    const context: EsiRequestContext<Data> = {
      resource,
      identity,
      key: cacheEnvelopeKey(dependencies.namespace, identity),
      policy,
      dependencies,
    }
    const envelope = await this.#readCachedEnvelope(context)

    if (envelope && isEnvelopeFresh(envelope)) return toCachedResult(envelope, 'cache', false)

    return this.#loadWithRequestCollapse(
      context,
      envelope && isEnvelopeRetained(envelope) ? envelope : undefined,
    )
  }

  async #readCachedEnvelope<Data>(context: EsiRequestContext<Data>) {
    const l1Envelope = this.#readL1<Data>(context)
    if (l1Envelope || !context.dependencies.canReadL2) return l1Envelope

    const l2Envelope = await this.#readL2<Data>(context)
    if (l2Envelope) this.#l1.set(context.key, l2Envelope)
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
      lease = await acquireEsiRequestLease(this.coordination, context.identity)
    } catch {
      this.#namespaceValidatedAt = 0
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
      return this.#serveStaleOrThrow(stale, policy, error)
    }
  }

  async #loadUncached<Data>(resource: InternalEsiResource<Data>): Promise<EsiCachedResult<Data>> {
    const policy = getEsiOperationContract(resource.operation)
    let resolved: ResolvedInternalEsiResource<Data>
    let load: EsiCanonicalLoad<Data>
    try {
      resolved = await this.#resolveResourceAuthorization(resource)
      load = await this.#loadWithRetry(resolved, {}, undefined, policy)
    } catch (error) {
      throw toEsiQuotaError(error)
    }
    const result = { data: await load.map(), meta: load.meta }
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
        resolvedContext = { ...context, resource }
      } catch (error) {
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
    })
    if (await this.#publish(context, envelope, lease)) this.#l1.set(context.key, envelope)
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
      try {
        // oxlint-disable-next-line no-await-in-loop
        return await resource.load(revalidation)
      } catch (error) {
        if (
          // Prefer an already validated stale value over spending more upstream attempts.
          this.#canServeStale(stale, policy, error) ||
          attempt === attempts ||
          !shouldRetryEsiError(error)
        )
          throw error
        // oxlint-disable-next-line no-await-in-loop
        await wait(randomInt(delay + 1))
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
    const metadata = getErrorMetadata(error)
    if (getErrorStatus(error) === 304 && revalidationEnvelope) {
      const envelope = updateNotModifiedEnvelope({
        envelope: revalidationEnvelope,
        metadata,
        policy: context.policy,
        fence: lease?.fence,
        authorization: context.resource.authorization,
      })
      if (await this.#publish(context, envelope, lease)) this.#l1.set(context.key, envelope)
      return toCachedResult(envelope, 'not-modified', false, undefined, getEsiQuota(metadata))
    }
    return this.#serveStaleOrThrow(fallbackEnvelope, context.policy, toEsiQuotaError(error))
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
    return toCachedResult(stale, 'cache', true, retryAt, {}, classifyStaleRefreshFailure(error))
  }

  #canServeStale<Data>(
    stale: EsiCacheEnvelope<Data> | undefined,
    policy: EsiOperationContract,
    error: unknown,
  ): stale is EsiCacheEnvelope<Data> {
    return Boolean(
      stale &&
      policy.cache.kind !== 'none' &&
      isEnvelopeRetained(stale) &&
      isEnvelopeStaleUsable(stale) &&
      isStaleUsableForFailure(policy.cache.stale, error),
    )
  }

  #renewLease(lease: EsiRequestLease | undefined) {
    if (!lease) return undefined
    const timer = setInterval(
      () => {
        void renewEsiRequestLease(this.coordination, lease).catch(() => {})
      },
      Math.floor(lease.ttlMs / 2),
    )
    timer.unref()
    return () => clearInterval(timer)
  }

  async #releaseLease(lease: EsiRequestLease | undefined) {
    if (lease) await releaseEsiRequestLease(this.coordination, lease).catch(() => {})
  }

  async #waitForLeaseOrPublication<Data>(context: EsiRequestContext<Data>): Promise<{
    lease: EsiRequestLease | undefined
    published?: EsiCacheEnvelope<Data>
    coordinationUnavailable?: true
  }> {
    const deadline = Date.now() + env.ESI_OPERATION_QUEUE_TIMEOUT_MS
    while (Date.now() < deadline) {
      let ttlMs: number
      try {
        // oxlint-disable-next-line no-await-in-loop
        ttlMs = await getEsiRequestLeaseTtl(this.coordination, context.identity)
      } catch {
        this.#namespaceValidatedAt = 0
        return { lease: undefined, coordinationUnavailable: true }
      }
      if (ttlMs > 0) {
        // oxlint-disable-next-line no-await-in-loop
        await wait(Math.min(followerWaitMs, ttlMs, Math.max(1, deadline - Date.now())))
        // oxlint-disable-next-line no-await-in-loop
        const published = await this.#readL2<Data>(context)
        if (published && isEnvelopeFresh(published)) {
          this.#l1.set(context.key, published)
          return { lease: undefined, published }
        }
      }
      let lease: EsiRequestLease | undefined
      try {
        // oxlint-disable-next-line no-await-in-loop
        lease = await acquireEsiRequestLease(this.coordination, context.identity)
      } catch {
        this.#namespaceValidatedAt = 0
        return { lease: undefined, coordinationUnavailable: true }
      }
      if (lease) return { lease }
    }
    throw new EsiRequestWaitTimeoutError()
  }

  async #resolveDependencies(): Promise<EsiCacheDependencies> {
    if (this.#namespaceValidatedAt + namespaceValidationIntervalMs > Date.now())
      return this.#availableDependencies()

    try {
      this.#namespaceInitialization ??= initializeCacheNamespace(this.coordination)
      const namespace = await this.#namespaceInitialization
      if (namespace !== this.#namespace) {
        this.#namespace = namespace
        this.#l1.clear()
      }
      this.#namespaceValidatedAt = Date.now()
      return this.#availableDependencies()
    } catch {
      // Coordination loss invalidates every distributed fence; only L1 may be used conservatively.
      this.#namespaceValidatedAt = 0
      return {
        namespace: this.#namespace,
        canCoordinate: false,
        canReadL2: false,
        canWriteL2: false,
      }
    } finally {
      this.#namespaceInitialization = undefined
    }
  }

  #availableDependencies(): EsiCacheDependencies {
    return {
      namespace: this.#namespace,
      canCoordinate: true,
      canReadL2: true,
      canWriteL2: true,
    }
  }

  #readL1<Data>(context: EsiRequestContext<Data>) {
    const envelope = this.#l1.get<Data>(context.key)
    if (!envelope) return undefined
    if (!isCompatibleEnvelope(envelope, context) || !isEnvelopeRetained(envelope)) {
      this.#l1.delete(context.key)
      return undefined
    }
    return envelope
  }

  async #readL2<Data>(context: EsiRequestContext<Data>) {
    try {
      const [serialized, committedFence] = await Promise.all([
        this.cache.get(context.key),
        getCommittedEsiFence(this.coordination, context.identity),
      ])
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
        !isEnvelopeRetained(envelope)
      )
        return undefined
      return envelope
    } catch {
      return undefined
    }
  }

  async #publish<Data>(
    context: EsiRequestContext<Data>,
    envelope: EsiCacheEnvelope<Data>,
    lease: EsiRequestLease | undefined,
  ) {
    if (!context.dependencies.canWriteL2 || !lease) return true
    const committed = await commitEsiFence(this.coordination, context.identity, lease).catch(
      () => false,
    )
    if (!committed) return false
    const ttlMs = Math.max(1, envelope.retainUntil - Date.now())
    await this.cache.set(context.key, JSON.stringify(envelope), 'PX', ttlMs).catch(() => {})
    return true
  }
}

type EsiExecutionLayer = Pick<
  EsiResilienceLayer,
  'executeRepresentation' | 'executeMutationRepresentation' | 'executePlatformOperation'
>

let executionLayerInstance: EsiResilienceLayer | undefined

export const esiExecutionLayer: EsiExecutionLayer = {
  executeRepresentation: (representation, input) =>
    executionLayer().executeRepresentation(representation, input),
  executeMutationRepresentation: (representation, input) =>
    executionLayer().executeMutationRepresentation(representation, input),
  executePlatformOperation: (request, inputs) =>
    executionLayer().executePlatformOperation(request, inputs),
}

function executionLayer() {
  executionLayerInstance ??= new EsiResilienceLayer(
    getSharedCacheRedisConnection(),
    getCoordinationConnection(),
  )
  return executionLayerInstance
}

class EsiRequestPermitLifecycle {
  readonly #lossController = new AbortController()
  readonly #renewalTimer: ReturnType<typeof setInterval>
  #settled = false
  #renewalInFlight: Promise<void> | undefined
  #releasePromise: Promise<void> | undefined

  constructor(private readonly permit: EsiRequestPermit) {
    this.#renewalTimer = setInterval(() => this.#renew(), Math.floor(permit.ttlMs / 2))
    this.#renewalTimer.unref()
  }

  get signal() {
    return this.#lossController.signal
  }

  release() {
    if (this.#releasePromise) return this.#releasePromise
    this.#settled = true
    clearInterval(this.#renewalTimer)
    this.#releasePromise = (async () => {
      await this.#renewalInFlight?.catch(() => {})
      await this.permit.release().catch(() => {})
    })()
    return this.#releasePromise
  }

  #lose() {
    if (this.#settled) return
    this.#settled = true
    clearInterval(this.#renewalTimer)
    this.#lossController.abort(
      new DOMException('ESI concurrency permit ownership lost', 'AbortError'),
    )
  }

  #renew() {
    if (this.#settled || this.#renewalInFlight) return
    const pending = this.permit.renew().then(
      (renewed) => {
        if (!renewed) this.#lose()
      },
      () => this.#lose(),
    )
    this.#renewalInFlight = pending
    void pending.finally(() => {
      if (this.#renewalInFlight === pending) this.#renewalInFlight = undefined
      if (this.#settled && !this.#releasePromise) void this.release()
    })
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
