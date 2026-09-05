import { randomInt } from 'node:crypto'
import { env } from '../env.js'
import { isPositiveSafeInteger } from '../type-guards.js'
import { getCharacterAuthorization } from '../auth/tokens.js'
import { getSharedCacheRedisConnection, type CacheRedisConnection } from './cache-redis.js'
import { getEsiOperationContract } from './catalog-access.js'
import { esiOperationCatalog, type EsiOperation } from './catalog.js'
import type { EsiMutationContract, EsiOperationContract } from './contract-types.js'
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
import { EsiQuotaError } from './cooldowns.js'
import {
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
  createEsiRepresentationIdentity,
  type EsiRepresentationIdentity,
} from './identity.js'
import { cacheEnvelopeKey } from './keys.js'
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
import { recordEsiCacheEnvelopeRejection, recordEsiCacheSource } from './telemetry-counters.js'
import { wait } from './timing.js'
import { getCoordinationConnection } from './transport.js'
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

type EsiOperationsWhere<Authorization extends 'public' | 'character', Cached extends boolean> = {
  [Operation in EsiOperation]: (typeof esiOperationCatalog)[Operation]['authorization'] extends {
    kind: Authorization
  }
    ? (
        (typeof esiOperationCatalog)[Operation]['cache'] extends { kind: 'none' } ? false : true
      ) extends Cached
      ? Operation
      : never
    : never
}[EsiOperation]

export type PublicEsiOperation = EsiOperationsWhere<'public', true>

export type CharacterEsiOperation = EsiOperationsWhere<'character', true>

/** Operations the catalog declares as mutations; the contract also carries their 404 semantics. */
type CharacterMutationEsiOperation = {
  [Operation in EsiOperation]: (typeof esiOperationCatalog)[Operation] extends {
    mutation: EsiMutationContract
  }
    ? Operation
    : never
}[EsiOperation]

type NoValueEsiOperation = EsiOperationsWhere<'public', false>

export interface ResilientEsiResource<Operation extends EsiOperation, Data> {
  operation: Operation
  inputs: Readonly<Record<string, unknown>>
  load(revalidation: EsiRevalidation): Promise<EsiLoadResult<Data>>
}

interface CharacterEsiResource<Data> {
  operation: CharacterEsiOperation
  inputs: Readonly<Record<string, unknown>>
  load(
    authority: { accessToken: string; principal: string },
    revalidation: EsiRevalidation,
  ): Promise<EsiLoadResult<Data>>
}

export interface CharacterEsiMutation<Data> {
  operation: CharacterMutationEsiOperation
  characterId: number
  load(authority: { accessToken: string; principal: string }): Promise<EsiLoadResult<Data>>
}

type InternalEsiResource<Data> = ResilientEsiResource<EsiOperation, Data> & {
  authorization?: EsiCacheAuthorization
}

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

export class EsiResilienceLayer {
  readonly #l1: BoundedEsiL1Cache
  readonly #authorizeCharacter: typeof getCharacterAuthorization
  #namespace = 'unavailable'
  #namespaceValidatedAt = 0
  #namespaceInitialization: Promise<string> | undefined
  readonly #resourceRevisions: EsiResourceRevisionRegistry

  constructor(
    private readonly cache: CacheRedisConnection,
    private readonly coordination: QueueRedisConnection,
    l1Capacity = env.ESI_CACHE_L1_MAX_ENTRIES,
    authorizeCharacter = getCharacterAuthorization,
  ) {
    this.#l1 = new BoundedEsiL1Cache(l1Capacity)
    this.#authorizeCharacter = authorizeCharacter
    this.#resourceRevisions = new EsiResourceRevisionRegistry(cache, coordination, () =>
      this.#l1.clear(),
    )
  }

  getPublic<Data>(
    resource: ResilientEsiResource<PublicEsiOperation, Data>,
  ): Promise<EsiCachedResult<Data>> {
    return this.#recordResult(resource.operation, this.#get(resource))
  }

  async getCharacter<Data>(resource: CharacterEsiResource<Data>): Promise<EsiCachedResult<Data>> {
    const characterId = resource.inputs.characterId
    if (!Number.isSafeInteger(characterId)) throw new Error('Character ESI identity is invalid')
    const policy = getEsiOperationContract(resource.operation)
    if (policy.authorization.kind !== 'character')
      throw new Error(`ESI operation ${resource.operation} is not character-authorized`)
    const authority = await this.#authorizeCharacter(
      Number(characterId),
      policy.authorization.scope,
    )
    const principal = characterEsiPrincipal(Number(characterId))
    return this.getCharacterWithAuthorization(
      {
        operation: resource.operation,
        inputs: resource.inputs,
        load: (revalidation) =>
          resource.load({ accessToken: authority.accessToken, principal }, revalidation),
      },
      { kind: 'character', principal, generation: authority.tokenVersion },
    )
  }

  getCharacterWithAuthorization<Data>(
    resource: ResilientEsiResource<CharacterEsiOperation, Data>,
    authorization: EsiCacheAuthorization,
  ): Promise<EsiCachedResult<Data>> {
    const policy = getEsiOperationContract(resource.operation)
    if (policy.authorization.kind !== 'character')
      throw new Error(`ESI operation ${resource.operation} is not character-authorized`)
    return this.#recordResult(resource.operation, this.#get({ ...resource, authorization }))
  }

  executeNoValue<Data>(
    resource: ResilientEsiResource<NoValueEsiOperation, Data>,
  ): Promise<EsiCachedResult<Data>> {
    return this.#recordResult(resource.operation, this.#get(resource))
  }

  async executeCharacterMutation<Data>(
    mutation: CharacterEsiMutation<Data>,
  ): Promise<EsiLoadResult<Data>> {
    if (!isPositiveSafeInteger(mutation.characterId))
      throw new Error('Character ESI identity is invalid')
    const policy = getEsiOperationContract(mutation.operation)
    if (!policy.mutation || policy.authorization.kind !== 'character')
      throw new Error(`ESI operation ${mutation.operation} is not a character mutation`)
    const authority = await this.#authorizeCharacter(
      mutation.characterId,
      policy.authorization.scope,
    )
    const principal = characterEsiPrincipal(mutation.characterId)
    try {
      const result = await this.#loadWithRetry(
        {
          operation: mutation.operation,
          inputs: { characterId: mutation.characterId },
          load: () => mutation.load({ accessToken: authority.accessToken, principal }),
        },
        {},
        undefined,
        policy,
      )
      await this.#resourceRevisions.advance(policy, principal)
      return result
    } catch (error) {
      if (shouldAdvanceRevisionAfterMutationError(policy, error))
        await this.#resourceRevisions.advance(policy, principal)
      throw toEsiQuotaError(error)
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
    try {
      const policy = getEsiOperationContract(resource.operation)
      const result = await this.#loadWithRetry(resource, {}, undefined, policy)
      const envelope = createCacheEnvelope({
        data: result.data,
        metadata: result.meta,
        policy,
        representationVersion: policy.representationVersion,
        authorization: resource.authorization,
        fence: 0,
      })
      return toCachedResult(envelope, 'esi', false, undefined, getEsiQuota(result.meta))
    } catch (error) {
      throw toEsiQuotaError(error)
    }
  }

  async #loadAndStore<Data>(
    context: EsiRequestContext<Data>,
    stale: EsiCacheEnvelope<Data> | undefined,
    lease: EsiRequestLease | undefined,
  ): Promise<EsiCachedResult<Data>> {
    const stopRenewal = this.#renewLease(lease)
    try {
      return await this.#loadAndPublish(context, stale, lease)
    } catch (error) {
      return await this.#recoverLoadFailure(context, stale, lease, error)
    } finally {
      stopRenewal?.()
      await this.#releaseLease(lease)
    }
  }

  async #loadAndPublish<Data>(
    context: EsiRequestContext<Data>,
    stale: EsiCacheEnvelope<Data> | undefined,
    lease: EsiRequestLease | undefined,
  ) {
    const { policy } = context
    const response = await this.#loadWithRetry(
      context.resource,
      toRevalidation(stale, policy.cache.kind !== 'none' && policy.cache.revalidate),
      stale,
      policy,
    )
    const envelope = createCacheEnvelope({
      data: response.data,
      metadata: response.meta,
      policy,
      representationVersion: context.identity.representationVersion,
      authorization: context.resource.authorization,
      resourceRevision: context.identity.resourceRevision,
      fence: lease?.fence ?? 0,
    })
    if (await this.#publish(context, envelope, lease)) this.#l1.set(context.key, envelope)
    return toCachedResult(envelope, 'esi', false, undefined, getEsiQuota(response.meta))
  }

  async #loadWithRetry<Data>(
    resource: InternalEsiResource<Data>,
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
    stale: EsiCacheEnvelope<Data> | undefined,
    lease: EsiRequestLease | undefined,
    error: unknown,
  ): Promise<EsiCachedResult<Data>> {
    const metadata = getErrorMetadata(error)
    if (getErrorStatus(error) === 304 && stale) {
      const envelope = updateNotModifiedEnvelope({
        envelope: stale,
        metadata,
        policy: context.policy,
        fence: lease?.fence,
      })
      if (await this.#publish(context, envelope, lease)) this.#l1.set(context.key, envelope)
      return toCachedResult(envelope, 'not-modified', false, undefined, getEsiQuota(metadata))
    }
    return this.#serveStaleOrThrow(stale, context.policy, toEsiQuotaError(error))
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

let defaultLayer: EsiResilienceLayer | undefined

export function getEsiResilienceLayer() {
  defaultLayer ??= new EsiResilienceLayer(
    getSharedCacheRedisConnection(),
    getCoordinationConnection(),
  )
  return defaultLayer
}

function toCachedResult<Data>(
  envelope: EsiCacheEnvelope<Data>,
  source: EsiCachedResult<Data>['source'],
  stale: boolean,
  retryAt?: string,
  quota: EsiCachedResult<Data>['quota'] = {},
  refreshFailureClass?: EsiCachedResult<Data>['refreshFailureClass'],
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
  if (envelope.representationVersion !== identity.representationVersion) return false
  if (!identity.resourceRevision) {
    if (envelope.resourceRevision !== undefined) return false
  } else if (
    envelope.resourceRevision?.namespace !== identity.resourceRevision.namespace ||
    envelope.resourceRevision.value !== identity.resourceRevision.value
  )
    return false
  if (!authorization) return envelope.authorization === undefined
  return (
    envelope.authorization?.kind === 'character' &&
    envelope.authorization.principal === authorization.principal &&
    envelope.authorization.generation === authorization.generation
  )
}
