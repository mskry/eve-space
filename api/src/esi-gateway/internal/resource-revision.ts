import { randomUUID } from 'node:crypto'
import type { EsiOperationContract } from './contract-types.js'
import type {
  CoordinationPort,
  EsiResourceMutationIntent,
  RuntimeTimingPort,
} from './runtime-ports.js'
import { recordEsiCoordinationFailure } from './telemetry-counters.js'
import type { EsiCacheAuthorization, EsiResourceRevision } from './types.js'

const advanceAttempts = 3
const retryDelayMs = 100
const maximumLocalRepairs = 1000

class EsiResourceRevisionUnavailableError extends Error {
  constructor() {
    super('ESI resource revision is temporarily unavailable')
    this.name = 'EsiResourceRevisionUnavailableError'
  }
}

export class EsiResourceRevisionRegistry {
  constructor(
    private readonly coordination: CoordinationPort,
    private readonly repairs: Map<string, EsiResourceMutationIntent>,
    private readonly timing: Pick<RuntimeTimingPort, 'wait'>,
    private readonly invalidateLocalCache: () => void,
  ) {}

  async resolve(
    policy: EsiOperationContract,
    authorization: EsiCacheAuthorization | undefined,
    signal?: AbortSignal,
    principal = authorization?.principal,
  ): Promise<EsiResourceRevision | undefined | null> {
    signal?.throwIfAborted()
    if (!policy.resourceRevision) {
      return undefined
    }
    if (authorization?.kind !== 'character' || !principal) {
      throw new Error('Revision-sensitive ESI operation is missing character authorization')
    }
    const namespace = policy.resourceRevision.namespace
    try {
      for (const intent of this.repairs.values()) {
        if (intent.namespace === namespace && intent.principal === principal) {
          // oxlint-disable-next-line no-await-in-loop
          await this.complete(intent)
        }
      }
      const value = await this.coordination.getResourceRevision(namespace, principal)
      signal?.throwIfAborted()
      return { namespace, value }
    } catch {
      signal?.throwIfAborted()
      recordEsiCoordinationFailure()
      return null
    }
  }

  async begin(policy: EsiOperationContract, principal: string) {
    if (!policy.resourceRevision) {
      return undefined
    }
    const intent: EsiResourceMutationIntent = {
      namespace: policy.resourceRevision.namespace,
      principal,
      token: randomUUID(),
    }
    try {
      await this.coordination.beginResourceMutation(intent)
      return intent
    } catch {
      // A lost Redis reply may still have recorded intent; no upstream mutation was dispatched.
      this.#rememberRepair(intent)
      recordEsiCoordinationFailure()
      throw new EsiResourceRevisionUnavailableError()
    }
  }

  async complete(intent: EsiResourceMutationIntent | undefined) {
    if (!intent) {
      return
    }
    for (let attempt = 1; attempt <= advanceAttempts; attempt += 1) {
      try {
        // oxlint-disable-next-line no-await-in-loop
        await this.coordination.completeResourceMutation(intent)
        this.repairs.delete(intent.token)
        return
      } catch {
        if (attempt < advanceAttempts) {
          // oxlint-disable-next-line no-await-in-loop
          await this.timing.wait(retryDelayMs * attempt)
        }
      }
    }
    this.invalidateLocalCache()
    this.#rememberRepair(intent)
    recordEsiCoordinationFailure()
    throw new EsiResourceRevisionUnavailableError()
  }

  #rememberRepair(intent: EsiResourceMutationIntent) {
    if (this.repairs.size < maximumLocalRepairs) {
      this.repairs.set(intent.token, intent)
    }
  }
}
