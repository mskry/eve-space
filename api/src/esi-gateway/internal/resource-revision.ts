import type { EsiOperationContract } from './contract-types.js'
import { cacheResourceRevisionRepairKey } from './keys.js'
import type {
  BoundedStringSetPort,
  CacheRedisPort,
  CoordinationPort,
  RuntimeTimingPort,
} from './runtime-ports.js'
import { recordEsiCoordinationFailure } from './telemetry-counters.js'
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
  constructor(
    private readonly cache: CacheRedisPort,
    private readonly coordination: CoordinationPort,
    private readonly unrepaired: BoundedStringSetPort,
    private readonly timing: Pick<RuntimeTimingPort, 'wait'>,
    private readonly invalidateLocalCache: () => void,
  ) {}

  /**
   * The revision to bind representations to: undefined when the contract declares none, or null
   * when coordination cannot be trusted and the caller must bypass the cache entirely.
   */
  async resolve(
    policy: EsiOperationContract,
    authorization: EsiCacheAuthorization | undefined,
    signal?: AbortSignal,
    principal = authorization?.principal,
  ): Promise<EsiResourceRevision | undefined | null> {
    signal?.throwIfAborted()
    if (!policy.resourceRevision) return undefined
    if (authorization?.kind !== 'character')
      throw new Error('Revision-sensitive ESI operation is missing character authorization')
    const namespace = policy.resourceRevision.namespace
    if (!principal) throw new Error('Revision-sensitive ESI operation is missing a principal')
    const keys = this.#keys(namespace, principal)

    const needsRepair = await this.#needsRepair(keys)
    signal?.throwIfAborted()
    if (needsRepair === undefined) return null

    try {
      const value = needsRepair
        ? await this.coordination.incrementResourceRevision(namespace, principal)
        : await this.coordination.getResourceRevision(namespace, principal)
      if (needsRepair) await this.#clearRepair(keys)
      signal?.throwIfAborted()
      return { namespace, value }
    } catch {
      signal?.throwIfAborted()
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
        await this.coordination.incrementResourceRevision(namespace, principal)
        // oxlint-disable-next-line no-await-in-loop
        await this.#clearRepair(keys)
        return
      } catch {
        if (attempt < advanceAttempts) {
          // oxlint-disable-next-line no-await-in-loop
          await this.timing.wait(retryDelayMs * attempt)
        }
      }
    }
    this.invalidateLocalCache()
    this.unrepaired.add(keys.unrepaired)
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
    if (this.unrepaired.has(keys.unrepaired)) return true
    try {
      return (await this.cache.get(keys.repair)) !== null
    } catch {
      recordEsiCoordinationFailure()
      return undefined
    }
  }

  async #clearRepair(keys: { unrepaired: string; repair: string }) {
    this.unrepaired.delete(keys.unrepaired)
    await this.cache.delete(keys.repair).catch(() => {})
  }
}
