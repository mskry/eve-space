import type { EsiResponseMetadata } from '@evespace/esi-client'
import { env } from '../env.js'
import { esiCooldownFallbackSeconds } from '../esi-policy.js'
import { createCacheRedisConnection, type CacheRedisConnection } from './cache-redis.js'
import {
  acquireEsiRequestLease,
  commitEsiFence,
  getCommittedEsiFence,
  getEsiRequestLeaseTtl,
  initializeCacheNamespace,
  renewEsiRequestLease,
  releaseEsiRequestLease,
} from './coordination.js'
import { EsiQuotaError } from './cooldowns.js'
import {
  createCacheEnvelope,
  isEnvelopeFresh,
  isEnvelopeRetained,
  toRevalidation,
  updateNotModifiedEnvelope,
} from './envelope.js'
import { BoundedEsiL1Cache } from './l1.js'
import { cacheEnvelopeKey } from './namespaces.js'
import { getEsiOperationPolicy, type EsiOperation } from './policy.js'
import { getCoordinationConnection } from './transport.js'
import type { EsiCachedResult, EsiCacheEnvelope, EsiLoadResult, EsiRevalidation } from './types.js'
import type { QueueRedisConnection } from '../queue/redis.js'

const followerWaitMs = 100
const localL1Capacity = 100

export interface ResilientEsiResource<Data> {
  operation: EsiOperation
  resource: string
  principal?: string
  load(revalidation: EsiRevalidation): Promise<EsiLoadResult<Data>>
}

export class EsiResilienceLayer {
  readonly #l1: BoundedEsiL1Cache
  readonly #localL1 = new BoundedEsiL1Cache(localL1Capacity)
  #namespaceVersion = 1
  #namespaceInitialization: Promise<number> | undefined

  constructor(
    private readonly cache: CacheRedisConnection,
    private readonly coordination: QueueRedisConnection,
    l1Capacity = env.ESI_CACHE_L1_MAX_ENTRIES,
  ) {
    this.#l1 = new BoundedEsiL1Cache(l1Capacity)
  }

  async get<Data>(resource: ResilientEsiResource<Data>): Promise<EsiCachedResult<Data>> {
    const policy = getEsiOperationPolicy(resource.operation)
    if (policy.valueCache === 'none') return this.#loadUncached(resource)
    if (policy.valueCache === 'local') return this.#getLocal(resource, policy)

    const dependencies = await this.#resolveDependencies()
    const key = cacheEnvelopeKey(
      dependencies.namespaceVersion,
      resource.operation,
      resource.resource,
    )
    const envelope = await this.#readCachedEnvelope<Data>(key, resource.resource, dependencies)

    if (envelope && isEnvelopeFresh(envelope)) return toCachedResult(envelope, 'cache', false)

    const stale = envelope && isEnvelopeRetained(envelope) ? envelope : undefined
    return this.#loadWithRequestCollapse(resource, key, stale, dependencies, policy)
  }

  async #getLocal<Data>(
    resource: ResilientEsiResource<Data>,
    policy: ReturnType<typeof getEsiOperationPolicy>,
  ): Promise<EsiCachedResult<Data>> {
    const key = cacheEnvelopeKey(0, resource.operation, resource.resource)
    const envelope = this.#readL1<Data>(key, this.#localL1)
    if (envelope && isEnvelopeFresh(envelope)) return toCachedResult(envelope, 'cache', false)

    const stale = envelope && isEnvelopeRetained(envelope) ? envelope : undefined
    return this.#loadAndStore(
      resource,
      key,
      stale,
      { canWriteL2: false },
      undefined,
      this.#localL1,
      policy,
    )
  }

  async #readCachedEnvelope<Data>(
    key: string,
    resource: string,
    dependencies: { canReadL2: boolean },
  ) {
    const l1Envelope = this.#readL1<Data>(key)
    if (l1Envelope || !dependencies.canReadL2) return l1Envelope

    const l2Envelope = await this.#readL2<Data>(key, resource)
    if (l2Envelope) this.#l1.set(key, l2Envelope)
    return l2Envelope
  }

  async #loadWithRequestCollapse<Data>(
    resource: ResilientEsiResource<Data>,
    key: string,
    stale: EsiCacheEnvelope<Data> | undefined,
    dependencies: {
      namespaceVersion: number
      canCoordinate: boolean
      canWriteL2: boolean
    },
    policy: ReturnType<typeof getEsiOperationPolicy>,
  ): Promise<EsiCachedResult<Data>> {
    if (!dependencies.canCoordinate || !policy.collapse)
      return this.#loadAndStore(resource, key, stale, dependencies, undefined)

    const lease = await acquireEsiRequestLease(this.coordination, resource.resource).catch(
      () => undefined,
    )
    if (lease) return this.#loadAndStore(resource, key, stale, dependencies, lease)

    try {
      const follower = await this.#waitForLeaseOrPublication<Data>(key, resource.resource)
      if (follower.published) return toCachedResult(follower.published, 'cache', false)
      return this.#loadAndStore(resource, key, stale, dependencies, follower.lease)
    } catch (error) {
      return this.#serveStaleOrThrow(stale, policy, error)
    }
  }

  async #loadUncached<Data>(resource: ResilientEsiResource<Data>): Promise<EsiCachedResult<Data>> {
    try {
      const result = await resource.load({})
      const envelope = createCacheEnvelope({
        data: result.data,
        metadata: result.meta,
        policy: getEsiOperationPolicy(resource.operation),
        fence: 0,
      })
      return toCachedResult(envelope, 'esi', false)
    } catch (error) {
      throw toEsiQuotaError(error)
    }
  }

  async #loadAndStore<Data>(
    resource: ResilientEsiResource<Data>,
    key: string,
    stale: EsiCacheEnvelope<Data> | undefined,
    dependencies: { canWriteL2: boolean },
    lease: Awaited<ReturnType<typeof acquireEsiRequestLease>>,
    l1 = this.#l1,
    policy = getEsiOperationPolicy(resource.operation),
  ): Promise<EsiCachedResult<Data>> {
    const stopRenewal = this.#renewLease(lease)
    try {
      return await this.#loadAndPublish(resource, key, dependencies, lease, stale, policy, l1)
    } catch (error) {
      return this.#recoverLoadFailure(resource, key, dependencies, lease, stale, policy, error)
    } finally {
      stopRenewal?.()
      await this.#releaseLease(lease)
    }
  }

  async #loadAndPublish<Data>(
    resource: ResilientEsiResource<Data>,
    key: string,
    dependencies: { canWriteL2: boolean },
    lease: Awaited<ReturnType<typeof acquireEsiRequestLease>>,
    stale: EsiCacheEnvelope<Data> | undefined,
    policy: ReturnType<typeof getEsiOperationPolicy>,
    l1: BoundedEsiL1Cache,
  ) {
    const response = await resource.load(toRevalidation(stale, policy.revalidate))
    const envelope = createCacheEnvelope({
      data: response.data,
      metadata: response.meta,
      policy,
      fence: lease?.fence ?? 0,
    })
    const published = await this.#publish(key, resource.resource, envelope, dependencies, lease)
    if (published) l1.set(key, envelope)
    return toCachedResult(envelope, 'esi', false)
  }

  async #recoverLoadFailure<Data>(
    resource: ResilientEsiResource<Data>,
    key: string,
    dependencies: { canWriteL2: boolean },
    lease: Awaited<ReturnType<typeof acquireEsiRequestLease>>,
    stale: EsiCacheEnvelope<Data> | undefined,
    policy: ReturnType<typeof getEsiOperationPolicy>,
    error: unknown,
  ): Promise<EsiCachedResult<Data>> {
    const metadata = getErrorMetadata(error)
    if (getErrorStatus(error) === 304 && stale) {
      const envelope = updateNotModifiedEnvelope(stale, metadata, policy, Date.now(), lease?.fence)
      const published = await this.#publish(key, resource.resource, envelope, dependencies, lease)
      if (published) this.#l1.set(key, envelope)
      return toCachedResult(envelope, 'not-modified', false)
    }
    return this.#serveStaleOrThrow(stale, policy, toEsiQuotaError(error))
  }

  #serveStaleOrThrow<Data>(
    stale: EsiCacheEnvelope<Data> | undefined,
    policy: ReturnType<typeof getEsiOperationPolicy>,
    error: unknown,
  ): EsiCachedResult<Data> {
    if (!stale || !policy.allowStale || !isEnvelopeRetained(stale)) throw error
    const retryAfterSeconds = error instanceof EsiQuotaError ? error.retryAfterSeconds : undefined
    return toCachedResult(stale, 'cache', true, retryAfterSeconds)
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
    resource: string,
  ): Promise<{
    lease: Awaited<ReturnType<typeof acquireEsiRequestLease>>
    published?: EsiCacheEnvelope<Data>
  }> {
    const deadline = Date.now() + env.ESI_OPERATION_QUEUE_TIMEOUT_MS
    while (Date.now() < deadline) {
      // oxlint-disable-next-line no-await-in-loop
      const ttlMs = await getEsiRequestLeaseTtl(this.coordination, resource).catch(() => 0)
      if (ttlMs > 0) {
        // oxlint-disable-next-line no-await-in-loop
        await wait(Math.min(followerWaitMs, ttlMs, Math.max(1, deadline - Date.now())))
        // oxlint-disable-next-line no-await-in-loop
        const published = await this.#readL2<Data>(key, resource)
        if (published && isEnvelopeFresh(published)) {
          this.#l1.set(key, published)
          return { lease: undefined, published }
        }
      }
      // oxlint-disable-next-line no-await-in-loop
      const lease = await acquireEsiRequestLease(this.coordination, resource).catch(() => undefined)
      if (lease) return { lease }
    }
    throw new EsiQuotaError(1)
  }

  async #resolveDependencies() {
    try {
      await this.cache.ping()
    } catch {
      try {
        await this.coordination.ping()
        // Cache loss does not remove shared quota or request-ownership authority.
        return {
          namespaceVersion: this.#namespaceVersion,
          canCoordinate: true,
          canReadL2: false,
          canWriteL2: false,
        }
      } catch {
        return {
          namespaceVersion: this.#namespaceVersion,
          canCoordinate: false,
          canReadL2: false,
          canWriteL2: false,
        }
      }
    }
    try {
      this.#namespaceInitialization ??= initializeCacheNamespace(
        this.cache,
        this.coordination,
      ).catch((error) => {
        this.#namespaceInitialization = undefined
        throw error
      })
      this.#namespaceVersion = await this.#namespaceInitialization
      return {
        namespaceVersion: this.#namespaceVersion,
        canCoordinate: true,
        canReadL2: true,
        canWriteL2: true,
      }
    } catch {
      // Coordination loss invalidates every distributed fence; only L1 may be used conservatively.
      return {
        namespaceVersion: this.#namespaceVersion,
        canCoordinate: false,
        canReadL2: false,
        canWriteL2: false,
      }
    }
  }

  #readL1<Data>(key: string, l1 = this.#l1) {
    const envelope = l1.get<Data>(key)
    if (!envelope) return undefined
    if (!isEnvelopeRetained(envelope)) {
      l1.delete(key)
      return undefined
    }
    return envelope
  }

  async #readL2<Data>(key: string, resource: string) {
    try {
      const [serialized, committedFence] = await Promise.all([
        this.cache.get(key),
        getCommittedEsiFence(this.coordination, resource),
      ])
      if (!serialized || committedFence === undefined) return undefined
      const envelope = parseEnvelope<Data>(serialized)
      if (!envelope || envelope.fence !== committedFence || !isEnvelopeRetained(envelope))
        return undefined
      return envelope
    } catch {
      return undefined
    }
  }

  async #publish<Data>(
    key: string,
    resource: string,
    envelope: EsiCacheEnvelope<Data>,
    dependencies: { canWriteL2: boolean },
    lease: Awaited<ReturnType<typeof acquireEsiRequestLease>>,
  ) {
    if (!dependencies.canWriteL2 || !lease) return true
    const committed = await commitEsiFence(this.coordination, resource, lease).catch(() => false)
    if (!committed) return false
    const ttlMs = Math.max(1, envelope.retainUntil - Date.now())
    await this.cache.set(key, JSON.stringify(envelope), 'PX', ttlMs).catch(() => {})
    return true
  }
}

let cacheConnection: CacheRedisConnection | undefined
let defaultLayer: EsiResilienceLayer | undefined

export function getEsiResilienceLayer() {
  cacheConnection ??= createCacheRedisConnection()
  defaultLayer ??= new EsiResilienceLayer(cacheConnection, getCoordinationConnection())
  return defaultLayer
}

function toCachedResult<Data>(
  envelope: EsiCacheEnvelope<Data>,
  source: EsiCachedResult<Data>['source'],
  stale: boolean,
  retryAfterSeconds?: number,
): EsiCachedResult<Data> {
  return {
    data: envelope.data,
    cachedUntil: new Date(envelope.freshUntil).toISOString(),
    checkedAt: envelope.validatedAt,
    source,
    stale,
    ...(retryAfterSeconds
      ? { retryAt: new Date(Date.now() + retryAfterSeconds * 1_000).toISOString() }
      : {}),
    quota: envelope.quota,
  }
}

function getErrorStatus(error: unknown) {
  return typeof error === 'object' && error && 'status' in error ? Number(error.status) : undefined
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

function parseEnvelope<Data>(serialized: string): EsiCacheEnvelope<Data> | undefined {
  try {
    const value: unknown = JSON.parse(serialized)
    if (
      !value ||
      typeof value !== 'object' ||
      !('version' in value) ||
      value.version !== 1 ||
      !('freshUntil' in value) ||
      !('retainUntil' in value) ||
      !('fence' in value) ||
      !Number.isFinite(value.freshUntil) ||
      !Number.isFinite(value.retainUntil) ||
      !Number.isSafeInteger(value.fence)
    )
      return undefined
    return value as EsiCacheEnvelope<Data>
  } catch {
    return undefined
  }
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}
