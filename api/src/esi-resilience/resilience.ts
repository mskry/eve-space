import type { EsiResponseMetadata } from '@evespace/esi-client'
import { randomInt } from 'node:crypto'
import { env } from '../env.js'
import { esiCooldownFallbackSeconds } from './policy.js'
import { getCharacterAuthorization } from '../auth/tokens.js'
import { getSharedCacheRedisConnection, type CacheRedisConnection } from './cache-redis.js'
import { esiOperationCatalog, getEsiOperationContract, type EsiOperation } from './catalog.js'
import {
  acquireEsiRequestLease,
  commitEsiFence,
  getCommittedEsiFence,
  getEsiRequestLeaseTtl,
  getEsiResourceRevision,
  incrementEsiResourceRevision,
  initializeCacheNamespace,
  renewEsiRequestLease,
  releaseEsiRequestLease,
} from './coordination.js'
import { EsiQuotaError } from './cooldowns.js'
import {
  createCacheEnvelope,
  getEsiQuota,
  isEnvelopeFresh,
  isEnvelopeRetained,
  isEnvelopeStaleUsable,
  toRevalidation,
  updateNotModifiedEnvelope,
} from './envelope.js'
import { BoundedEsiL1Cache } from './l1.js'
import {
  characterEsiPrincipal,
  createEsiRepresentationIdentity,
  type EsiRepresentationIdentity,
  type EsiResourceRevision,
} from './identity.js'
import { cacheEnvelopeKey, cacheResourceRevisionRepairKey } from './namespaces.js'
import { recordEsiCacheSource, recordEsiCoordinationFailure } from './telemetry.js'
import { EsiTransportError, getCoordinationConnection } from './transport.js'
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
const resourceRevisionAdvanceAttempts = 3
const resourceRevisionRetryDelayMs = 100
const completedEsiOperationErrors = new WeakSet<object>()

class EsiRequestWaitTimeoutError extends Error {
  constructor() {
    super('Timed out waiting for the current ESI request owner')
    this.name = 'EsiRequestWaitTimeoutError'
  }
}

class EsiResourceRevisionUnavailableError extends Error {
  constructor() {
    super('ESI resource revision is temporarily unavailable')
    this.name = 'EsiResourceRevisionUnavailableError'
  }
}

export type PublicEsiOperation = {
  [Operation in EsiOperation]: (typeof esiOperationCatalog)[Operation]['authorization'] extends {
    kind: 'public'
  }
    ? Operation extends NoValueEsiOperation
      ? never
      : Operation
    : never
}[EsiOperation]

export type CharacterEsiOperation = {
  [Operation in EsiOperation]: (typeof esiOperationCatalog)[Operation]['authorization'] extends {
    kind: 'character'
  }
    ? (typeof esiOperationCatalog)[Operation]['cache'] extends { kind: 'none' }
      ? never
      : Operation
    : never
}[EsiOperation]

type CharacterMutationEsiOperation = Extract<
  EsiOperation,
  'mail-send' | 'mail-create-label' | 'mail-update' | 'mail-delete' | 'mail-delete-label'
>

type NoValueEsiOperation = Extract<EsiOperation, 'bulk-affiliation'>

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

export class EsiResilienceLayer {
  readonly #l1: BoundedEsiL1Cache
  readonly #authorizeCharacter: typeof getCharacterAuthorization
  #namespace = 'unavailable'
  #namespaceValidatedAt = 0
  #namespaceInitialization: Promise<string> | undefined
  readonly #unsafeResourceRevisions = new Set<string>()

  constructor(
    private readonly cache: CacheRedisConnection,
    private readonly coordination: QueueRedisConnection,
    l1Capacity = env.ESI_CACHE_L1_MAX_ENTRIES,
    authorizeCharacter = getCharacterAuthorization,
  ) {
    this.#l1 = new BoundedEsiL1Cache(l1Capacity)
    this.#authorizeCharacter = authorizeCharacter
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
    if (!Number.isSafeInteger(mutation.characterId) || mutation.characterId <= 0)
      throw new Error('Character ESI identity is invalid')
    const policy = getEsiOperationContract(mutation.operation)
    if (policy.authorization.kind !== 'character' || policy.cache.kind !== 'none')
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
      await this.#advanceResourceRevision(policy, principal)
      return result
    } catch (error) {
      if (shouldAdvanceRevisionAfterMutationError(mutation.operation, error))
        await this.#advanceResourceRevision(policy, principal)
      throw toEsiQuotaError(error)
    }
  }

  async #recordResult<Data>(operation: EsiOperation, pending: Promise<EsiCachedResult<Data>>) {
    try {
      const result = await pending
      recordEsiCacheSource(operation, result.source, result.stale)
      return result
    } catch (error) {
      if (typeof error === 'object' && error) completedEsiOperationErrors.add(error)
      throw error
    }
  }

  async #get<Data>(resource: InternalEsiResource<Data>): Promise<EsiCachedResult<Data>> {
    const policy = getEsiOperationContract(resource.operation)
    const resourceRevision = await this.#resolveResourceRevision(policy, resource.authorization)
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
    const key = cacheEnvelopeKey(dependencies.namespace, identity)
    const envelope = await this.#readCachedEnvelope<Data>(
      key,
      identity,
      resource.authorization,
      dependencies,
    )

    if (envelope && isEnvelopeFresh(envelope)) return toCachedResult(envelope, 'cache', false)

    const stale = envelope && isEnvelopeRetained(envelope) ? envelope : undefined
    return this.#loadWithRequestCollapse(resource, identity, key, stale, dependencies, policy)
  }

  async #readCachedEnvelope<Data>(
    key: string,
    identity: EsiRepresentationIdentity,
    authorization: EsiCacheAuthorization | undefined,
    dependencies: { canReadL2: boolean },
  ) {
    const l1Envelope = this.#readL1<Data>(key, identity, authorization)
    if (l1Envelope || !dependencies.canReadL2) return l1Envelope

    const l2Envelope = await this.#readL2<Data>(key, identity, authorization)
    if (l2Envelope) this.#l1.set(key, l2Envelope)
    return l2Envelope
  }

  async #loadWithRequestCollapse<Data>(
    resource: InternalEsiResource<Data>,
    identity: EsiRepresentationIdentity,
    key: string,
    stale: EsiCacheEnvelope<Data> | undefined,
    dependencies: {
      namespace: string
      canCoordinate: boolean
      canWriteL2: boolean
    },
    policy: ReturnType<typeof getEsiOperationContract>,
  ): Promise<EsiCachedResult<Data>> {
    if (!dependencies.canCoordinate || policy.cache.kind !== 'shared' || !policy.cache.collapse)
      return this.#loadAndStore(resource, identity, key, stale, dependencies, undefined)

    let lease: Awaited<ReturnType<typeof acquireEsiRequestLease>>
    try {
      lease = await acquireEsiRequestLease(this.coordination, identity)
    } catch {
      this.#namespaceValidatedAt = 0
      return this.#loadAndStore(resource, identity, key, stale, { canWriteL2: false }, undefined)
    }
    if (lease) return this.#loadAndStore(resource, identity, key, stale, dependencies, lease)

    try {
      const follower = await this.#waitForLeaseOrPublication<Data>(
        key,
        identity,
        resource.authorization,
      )
      if (follower.coordinationUnavailable)
        return this.#loadAndStore(resource, identity, key, stale, { canWriteL2: false }, undefined)
      if (follower.published) return toCachedResult(follower.published, 'cache', false)
      return this.#loadAndStore(resource, identity, key, stale, dependencies, follower.lease)
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
    resource: InternalEsiResource<Data>,
    identity: EsiRepresentationIdentity,
    key: string,
    stale: EsiCacheEnvelope<Data> | undefined,
    dependencies: { canWriteL2: boolean },
    lease: Awaited<ReturnType<typeof acquireEsiRequestLease>>,
    policy = getEsiOperationContract(resource.operation),
  ): Promise<EsiCachedResult<Data>> {
    const stopRenewal = this.#renewLease(lease)
    try {
      return await this.#loadAndPublish(resource, identity, key, dependencies, lease, stale, policy)
    } catch (error) {
      return await this.#recoverLoadFailure({
        resource,
        identity,
        key,
        dependencies,
        lease,
        stale,
        policy,
        error,
      })
    } finally {
      stopRenewal?.()
      await this.#releaseLease(lease)
    }
  }

  async #loadAndPublish<Data>(
    resource: InternalEsiResource<Data>,
    identity: EsiRepresentationIdentity,
    key: string,
    dependencies: { canWriteL2: boolean },
    lease: Awaited<ReturnType<typeof acquireEsiRequestLease>>,
    stale: EsiCacheEnvelope<Data> | undefined,
    policy: ReturnType<typeof getEsiOperationContract>,
  ) {
    const response = await this.#loadWithRetry(
      resource,
      toRevalidation(stale, policy.cache.kind !== 'none' && policy.cache.revalidate),
      stale,
      policy,
    )
    const envelope = createCacheEnvelope({
      data: response.data,
      metadata: response.meta,
      policy,
      representationVersion: identity.representationVersion,
      authorization: resource.authorization,
      resourceRevision: identity.resourceRevision,
      fence: lease?.fence ?? 0,
    })
    const published = await this.#publish(key, identity, envelope, dependencies, lease)
    if (published) this.#l1.set(key, envelope)
    return toCachedResult(envelope, 'esi', false, undefined, getEsiQuota(response.meta))
  }

  async #loadWithRetry<Data>(
    resource: InternalEsiResource<Data>,
    revalidation: EsiRevalidation,
    stale: EsiCacheEnvelope<Data> | undefined,
    policy: ReturnType<typeof getEsiOperationContract>,
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
          this.#canServeStale(stale, policy) ||
          attempt === attempts ||
          !isRetryableEsiError(error)
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

  async #recoverLoadFailure<Data>(options: {
    resource: InternalEsiResource<Data>
    identity: EsiRepresentationIdentity
    key: string
    dependencies: { canWriteL2: boolean }
    lease: Awaited<ReturnType<typeof acquireEsiRequestLease>>
    stale: EsiCacheEnvelope<Data> | undefined
    policy: ReturnType<typeof getEsiOperationContract>
    error: unknown
  }): Promise<EsiCachedResult<Data>> {
    const metadata = getErrorMetadata(options.error)
    if (getErrorStatus(options.error) === 304 && options.stale) {
      const envelope = updateNotModifiedEnvelope({
        envelope: options.stale,
        metadata,
        policy: options.policy,
        representationVersion: options.identity.representationVersion,
        authorization: options.resource.authorization,
        fence: options.lease?.fence,
        resourceRevision: options.identity.resourceRevision,
      })
      const published = await this.#publish(
        options.key,
        options.identity,
        envelope,
        options.dependencies,
        options.lease,
      )
      if (published) this.#l1.set(options.key, envelope)
      return toCachedResult(envelope, 'not-modified', false, undefined, getEsiQuota(metadata))
    }
    return this.#serveStaleOrThrow(options.stale, options.policy, toEsiQuotaError(options.error))
  }

  #serveStaleOrThrow<Data>(
    stale: EsiCacheEnvelope<Data> | undefined,
    policy: ReturnType<typeof getEsiOperationContract>,
    error: unknown,
  ): EsiCachedResult<Data> {
    if (!this.#canServeStale(stale, policy)) throw error
    const retryAt = error instanceof EsiQuotaError ? error.retryAt.toISOString() : undefined
    return toCachedResult(stale, 'cache', true, retryAt, {}, classifyStaleRefreshFailure(error))
  }

  #canServeStale<Data>(
    stale: EsiCacheEnvelope<Data> | undefined,
    policy: ReturnType<typeof getEsiOperationContract>,
  ): stale is EsiCacheEnvelope<Data> {
    return Boolean(
      stale &&
      policy.cache.kind !== 'none' &&
      isEnvelopeRetained(stale) &&
      isEnvelopeStaleUsable(stale),
    )
  }

  #renewLease(lease: Awaited<ReturnType<typeof acquireEsiRequestLease>>) {
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

  async #releaseLease(lease: Awaited<ReturnType<typeof acquireEsiRequestLease>>) {
    if (lease) await releaseEsiRequestLease(this.coordination, lease).catch(() => {})
  }

  async #waitForLeaseOrPublication<Data>(
    key: string,
    identity: EsiRepresentationIdentity,
    authorization: EsiCacheAuthorization | undefined,
  ): Promise<{
    lease: Awaited<ReturnType<typeof acquireEsiRequestLease>>
    published?: EsiCacheEnvelope<Data>
    coordinationUnavailable?: true
  }> {
    const deadline = Date.now() + env.ESI_OPERATION_QUEUE_TIMEOUT_MS
    while (Date.now() < deadline) {
      let ttlMs: number
      try {
        // oxlint-disable-next-line no-await-in-loop
        ttlMs = await getEsiRequestLeaseTtl(this.coordination, identity)
      } catch {
        this.#namespaceValidatedAt = 0
        return { lease: undefined, coordinationUnavailable: true }
      }
      if (ttlMs > 0) {
        // oxlint-disable-next-line no-await-in-loop
        await wait(Math.min(followerWaitMs, ttlMs, Math.max(1, deadline - Date.now())))
        // oxlint-disable-next-line no-await-in-loop
        const published = await this.#readL2<Data>(key, identity, authorization)
        if (published && isEnvelopeFresh(published)) {
          this.#l1.set(key, published)
          return { lease: undefined, published }
        }
      }
      let lease: Awaited<ReturnType<typeof acquireEsiRequestLease>>
      try {
        // oxlint-disable-next-line no-await-in-loop
        lease = await acquireEsiRequestLease(this.coordination, identity)
      } catch {
        this.#namespaceValidatedAt = 0
        return { lease: undefined, coordinationUnavailable: true }
      }
      if (lease) return { lease }
    }
    throw new EsiRequestWaitTimeoutError()
  }

  async #resolveDependencies() {
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

  #availableDependencies() {
    return {
      namespace: this.#namespace,
      canCoordinate: true,
      canReadL2: true,
      canWriteL2: true,
    }
  }

  async #resolveResourceRevision(
    policy: ReturnType<typeof getEsiOperationContract>,
    authorization: EsiCacheAuthorization | undefined,
  ): Promise<EsiResourceRevision | undefined | null> {
    if (!policy.resourceRevision) return undefined
    if (authorization?.kind !== 'character')
      throw new Error('Revision-sensitive ESI operation is missing character authorization')
    const unsafeKey = resourceRevisionUnsafeKey(
      policy.resourceRevision.namespace,
      authorization.principal,
    )
    const repairKey = cacheResourceRevisionRepairKey(
      policy.resourceRevision.namespace,
      authorization.principal,
    )
    const needsRepair = await this.#needsResourceRevisionRepair(unsafeKey, repairKey)
    if (needsRepair === undefined) return null
    if (needsRepair) {
      try {
        const value = await incrementEsiResourceRevision(
          this.coordination,
          policy.resourceRevision.namespace,
          authorization.principal,
        )
        await this.#clearResourceRevisionRepair(unsafeKey, repairKey)
        return { namespace: policy.resourceRevision.namespace, value }
      } catch {
        recordEsiCoordinationFailure()
        return null
      }
    }
    try {
      return {
        namespace: policy.resourceRevision.namespace,
        value: await getEsiResourceRevision(
          this.coordination,
          policy.resourceRevision.namespace,
          authorization.principal,
        ),
      }
    } catch {
      recordEsiCoordinationFailure()
      return null
    }
  }

  async #advanceResourceRevision(
    policy: ReturnType<typeof getEsiOperationContract>,
    principal: string,
  ) {
    if (!policy.resourceRevision) return
    const unsafeKey = resourceRevisionUnsafeKey(policy.resourceRevision.namespace, principal)
    const repairKey = cacheResourceRevisionRepairKey(policy.resourceRevision.namespace, principal)
    for (let attempt = 1; attempt <= resourceRevisionAdvanceAttempts; attempt += 1) {
      try {
        // oxlint-disable-next-line no-await-in-loop
        await incrementEsiResourceRevision(
          this.coordination,
          policy.resourceRevision.namespace,
          principal,
        )
        // oxlint-disable-next-line no-await-in-loop
        await this.#clearResourceRevisionRepair(unsafeKey, repairKey)
        return
      } catch {
        if (attempt < resourceRevisionAdvanceAttempts) {
          // oxlint-disable-next-line no-await-in-loop
          await wait(resourceRevisionRetryDelayMs * attempt)
        }
      }
    }
    this.#l1.clear()
    this.#unsafeResourceRevisions.add(unsafeKey)
    await this.cache.set(repairKey, '1').catch(() => {})
    recordEsiCoordinationFailure()
    throw new EsiResourceRevisionUnavailableError()
  }

  async #needsResourceRevisionRepair(unsafeKey: string, repairKey: string) {
    if (this.#unsafeResourceRevisions.has(unsafeKey)) return true
    try {
      return (await this.cache.get(repairKey)) !== null
    } catch {
      recordEsiCoordinationFailure()
      return undefined
    }
  }

  async #clearResourceRevisionRepair(unsafeKey: string, repairKey: string) {
    this.#unsafeResourceRevisions.delete(unsafeKey)
    await this.cache.del(repairKey).catch(() => {})
  }

  #readL1<Data>(
    key: string,
    identity: EsiRepresentationIdentity,
    authorization: EsiCacheAuthorization | undefined,
  ) {
    const envelope = this.#l1.get<Data>(key)
    if (!envelope) return undefined
    if (!isCompatibleEnvelope(envelope, identity, authorization) || !isEnvelopeRetained(envelope)) {
      this.#l1.delete(key)
      return undefined
    }
    return envelope
  }

  async #readL2<Data>(
    key: string,
    identity: EsiRepresentationIdentity,
    authorization: EsiCacheAuthorization | undefined,
  ) {
    try {
      const [serialized, committedFence] = await Promise.all([
        this.cache.get(key),
        getCommittedEsiFence(this.coordination, identity),
      ])
      if (!serialized || committedFence === undefined) return undefined
      const envelope = parseEnvelope<Data>(serialized)
      if (
        !envelope ||
        !isCompatibleEnvelope(envelope, identity, authorization) ||
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
    key: string,
    identity: EsiRepresentationIdentity,
    envelope: EsiCacheEnvelope<Data>,
    dependencies: { canWriteL2: boolean },
    lease: Awaited<ReturnType<typeof acquireEsiRequestLease>>,
  ) {
    if (!dependencies.canWriteL2 || !lease) return true
    const committed = await commitEsiFence(this.coordination, identity, lease).catch(() => false)
    if (!committed) return false
    const ttlMs = Math.max(1, envelope.retainUntil - Date.now())
    await this.cache.set(key, JSON.stringify(envelope), 'PX', ttlMs).catch(() => {})
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

function getErrorStatus(error: unknown) {
  if (typeof error !== 'object' || !error || !('status' in error)) return undefined
  const status = Number(error.status)
  return Number.isFinite(status) ? status : undefined
}

function classifyStaleRefreshFailure(
  error: unknown,
): NonNullable<EsiCachedResult<unknown>['refreshFailureClass']> {
  if (error instanceof EsiQuotaError) return 'esi-cooldown'
  if (
    typeof error === 'object' &&
    error &&
    'code' in error &&
    (error.code === 'ESI_RESPONSE_PARSE_ERROR' || error.code === 'ESI_RESPONSE_VALIDATION_ERROR')
  )
    return 'response-invalid'
  return isRetryableEsiError(error) || error instanceof EsiRequestWaitTimeoutError
    ? 'esi-unavailable'
    : 'unknown'
}

function getErrorMetadata(error: unknown): EsiResponseMetadata | undefined {
  if (typeof error !== 'object' || !error || !('metadata' in error)) return undefined
  return error.metadata as EsiResponseMetadata
}

function toEsiQuotaError(error: unknown) {
  if (error instanceof EsiQuotaError || getErrorStatus(error) !== 429) return error
  const retryAfter = Number(getErrorMetadata(error)?.headers['retry-after'])
  return new EsiQuotaError(
    Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.max(1, Math.ceil(retryAfter))
      : esiCooldownFallbackSeconds,
  )
}

function isRetryableEsiError(error: unknown) {
  if (typeof error === 'object' && error && completedEsiOperationErrors.has(error)) return false
  const status = getErrorStatus(error)
  return (
    (error instanceof EsiTransportError &&
      (status === undefined || (status >= 500 && status < 600))) ||
    (isEsiHttpError(error) && status !== undefined && status >= 500 && status < 600)
  )
}

function isEsiHttpError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ESI_HTTP_ERROR'
  )
}

function shouldAdvanceRevisionAfterMutationError(
  operation: CharacterMutationEsiOperation,
  error: unknown,
) {
  return (
    error instanceof EsiTransportError ||
    isEsiResponseContractError(error) ||
    ((operation === 'mail-delete' || operation === 'mail-delete-label') &&
      getErrorStatus(error) === 404)
  )
}

function isEsiResponseContractError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ESI_RESPONSE_PARSE_ERROR' || error.code === 'ESI_RESPONSE_VALIDATION_ERROR')
  )
}

function resourceRevisionUnsafeKey(namespace: string, principal: string) {
  return `${namespace}:${principal}`
}

function parseEnvelope<Data>(serialized: string): EsiCacheEnvelope<Data> | undefined {
  try {
    const value: unknown = JSON.parse(serialized)
    if (
      !value ||
      typeof value !== 'object' ||
      !('version' in value) ||
      value.version !== 2 ||
      !('representationVersion' in value) ||
      !('data' in value) ||
      !('freshUntil' in value) ||
      !('staleUntil' in value) ||
      !('retainUntil' in value) ||
      !('validatedAt' in value) ||
      !('fence' in value) ||
      typeof value.representationVersion !== 'string' ||
      !Number.isFinite(value.freshUntil) ||
      !Number.isFinite(value.staleUntil) ||
      !Number.isFinite(value.retainUntil) ||
      typeof value.validatedAt !== 'string' ||
      Number.isNaN(Date.parse(value.validatedAt)) ||
      !Number.isSafeInteger(value.fence) ||
      Number(value.fence) < 0 ||
      Number(value.freshUntil) > Number(value.staleUntil) ||
      Number(value.staleUntil) > Number(value.retainUntil) ||
      !isOptionalString(value, 'etag') ||
      !isOptionalString(value, 'lastModified') ||
      !isParsedAuthorization(value) ||
      !isParsedResourceRevision(value)
    )
      return undefined
    return value as EsiCacheEnvelope<Data>
  } catch {
    return undefined
  }
}

function isCompatibleEnvelope(
  envelope: EsiCacheEnvelope<unknown>,
  identity: EsiRepresentationIdentity,
  authorization: EsiCacheAuthorization | undefined,
) {
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

function isParsedAuthorization(value: object) {
  if (!('authorization' in value) || value.authorization === undefined) return true
  if (!value.authorization || typeof value.authorization !== 'object') return false
  const authorization = value.authorization as Record<string, unknown>
  return (
    authorization.kind === 'character' &&
    typeof authorization.principal === 'string' &&
    authorization.principal.length > 0 &&
    Number.isSafeInteger(authorization.generation) &&
    Number(authorization.generation) >= 0
  )
}

function isParsedResourceRevision(value: object) {
  if (!('resourceRevision' in value) || value.resourceRevision === undefined) return true
  if (!value.resourceRevision || typeof value.resourceRevision !== 'object') return false
  const revision = value.resourceRevision as Record<string, unknown>
  return (
    typeof revision.namespace === 'string' &&
    revision.namespace.length > 0 &&
    Number.isSafeInteger(revision.value) &&
    Number(revision.value) >= 0
  )
}

function isOptionalString(value: object, field: string) {
  if (!(field in value)) return true
  const fieldValue = (value as Record<string, unknown>)[field]
  return fieldValue === undefined || typeof fieldValue === 'string'
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}
