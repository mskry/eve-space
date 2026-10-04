import { EsiReadWaiters } from './read-waiters.js'
import { BoundedEsiL1Cache } from './l1-cache.js'
import type { EsiResourceMutationIntent, RuntimeLocalQuotaStatePort } from './runtime-ports.js'

export function createEsiExecutionRuntimeState(l1Capacity: number) {
  return new EsiExecutionRuntimeState(l1Capacity)
}

class EsiExecutionRuntimeState {
  readonly readWaiters = new EsiReadWaiters()
  readonly l1: BoundedEsiL1Cache
  namespace = 'unavailable'
  namespaceValidatedAt = 0
  namespaceInitialization: Promise<string> | undefined
  readonly localQuota: RuntimeLocalQuotaStatePort = {
    globalCooldownUntil: 0,
    groupCooldowns: new Map(),
    pacing: new Map(),
    pacingOverflowUntil: 0,
    inFlight: new Map(),
    operationCooldowns: new Map(),
  }
  readonly resourceRevisionRepairs = new Map<string, EsiResourceMutationIntent>()
  #completedErrors = new WeakSet<object>()

  constructor(l1Capacity: number) {
    this.l1 = new BoundedEsiL1Cache(l1Capacity)
  }

  markErrorCompleted(error: unknown) {
    if (typeof error === 'object' && error) {
      this.#completedErrors.add(error)
    }
  }

  isErrorCompleted(error: unknown) {
    return typeof error === 'object' && error !== null && this.#completedErrors.has(error)
  }

  clear() {
    this.l1.clear()
    this.namespace = 'unavailable'
    this.namespaceValidatedAt = 0
    this.namespaceInitialization = undefined
    this.localQuota.operationCooldowns.clear()
    this.localQuota.groupCooldowns.clear()
    this.localQuota.pacing.clear()
    this.localQuota.pacingOverflowUntil = 0
    this.localQuota.inFlight.clear()
    this.localQuota.globalCooldownUntil = 0
    this.resourceRevisionRepairs.clear()
    this.#completedErrors = new WeakSet()
  }
}
