import type { CacheRedisConnection } from './cache-redis.js'
import type { CoordinationRedisConnection } from '../coordination-redis.js'
import type { EsiOperationContract } from './contract-types.js'
import { getEsiResourceRevision, incrementEsiResourceRevision } from './coordination.js'
import { cacheResourceRevisionRepairKey } from './keys.js'
import { recordEsiCoordinationFailure } from './telemetry-counters.js'
import { wait } from './timing.js'
import type { EsiCacheAuthorization, EsiResourceRevision } from './types.js'

const advanceAttempts = 3
const retryDelayMs = 100

class EsiResourceRevisionUnavailableError extends Error {
  constructor() {
    super('ESI resource revision is temporarily unavailable')
    this.name = 'EsiResourceRevisionUnavailableError'
  }
}

/**
 * Per-principal revisions that invalidate every representation derived from them.
 *
 * An advance that cannot reach coordination leaves representations that may already be behind, so
 * the failure is recorded as a repair marker and every later resolve repairs it before it is
 * allowed to hand back a revision.
 */
export class EsiResourceRevisionRegistry {
  readonly #unrepaired = new Set<string>()

  constructor(
    private readonly cache: CacheRedisConnection,
    private readonly coordination: CoordinationRedisConnection,
    private readonly invalidateLocalCache: () => void,
  ) {}

  /**
   * The revision to bind representations to: undefined when the contract declares none, or null
   * when coordination cannot be trusted and the caller must bypass the cache entirely.
   */
  async resolve(
    policy: EsiOperationContract,
    authorization: EsiCacheAuthorization | undefined,
  ): Promise<EsiResourceRevision | undefined | null> {
    if (!policy.resourceRevision) return undefined
    if (authorization?.kind !== 'character')
      throw new Error('Revision-sensitive ESI operation is missing character authorization')
    const namespace = policy.resourceRevision.namespace
    const keys = this.#keys(namespace, authorization.principal)

    const needsRepair = await this.#needsRepair(keys)
    if (needsRepair === undefined) return null

    try {
      const value = needsRepair
        ? await incrementEsiResourceRevision(this.coordination, namespace, authorization.principal)
        : await getEsiResourceRevision(this.coordination, namespace, authorization.principal)
      if (needsRepair) await this.#clearRepair(keys)
      return { namespace, value }
    } catch {
      recordEsiCoordinationFailure()
      return null
    }
  }

  /** Advances the revision after a mutation, retrying before it gives up and marks a repair. */
  async advance(policy: EsiOperationContract, principal: string) {
    if (!policy.resourceRevision) return
    const namespace = policy.resourceRevision.namespace
    const keys = this.#keys(namespace, principal)
    for (let attempt = 1; attempt <= advanceAttempts; attempt += 1) {
      try {
        // oxlint-disable-next-line no-await-in-loop
        await incrementEsiResourceRevision(this.coordination, namespace, principal)
        // oxlint-disable-next-line no-await-in-loop
        await this.#clearRepair(keys)
        return
      } catch {
        if (attempt < advanceAttempts) {
          // oxlint-disable-next-line no-await-in-loop
          await wait(retryDelayMs * attempt)
        }
      }
    }
    this.invalidateLocalCache()
    this.#unrepaired.add(keys.unrepaired)
    await this.cache.set(keys.repair, '1').catch(() => {})
    recordEsiCoordinationFailure()
    throw new EsiResourceRevisionUnavailableError()
  }

  #keys(namespace: string, principal: string) {
    return {
      unrepaired: `${namespace}:${principal}`,
      repair: cacheResourceRevisionRepairKey(namespace, principal),
    }
  }

  async #needsRepair(keys: { unrepaired: string; repair: string }) {
    if (this.#unrepaired.has(keys.unrepaired)) return true
    try {
      return (await this.cache.get(keys.repair)) !== null
    } catch {
      recordEsiCoordinationFailure()
      return undefined
    }
  }

  async #clearRepair(keys: { unrepaired: string; repair: string }) {
    this.#unrepaired.delete(keys.unrepaired)
    await this.cache.del(keys.repair).catch(() => {})
  }
}
