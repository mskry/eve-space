import { BoundedEsiL1Cache } from './l1-cache.js'
import type { BoundedStringSetPort, RuntimeLocalQuotaStatePort } from './runtime-ports.js'

const maximumUnrepairedRevisions = 1_000

export function createEsiExecutionRuntimeState(l1Capacity: number) {
  return new EsiExecutionRuntimeState(l1Capacity)
}

class EsiExecutionRuntimeState {
  readonly l1: BoundedEsiL1Cache
  namespace = 'unavailable'
  namespaceValidatedAt = 0
  namespaceInitialization: Promise<string> | undefined
  readonly localQuota: RuntimeLocalQuotaStatePort = {
    operationCooldowns: new Map(),
    groupCooldowns: new Map(),
    inFlight: new Map(),
    globalCooldownUntil: 0,
  }
  readonly unrepairedResourceRevisions: BoundedStringSetPort = new BoundedStringSet(
    maximumUnrepairedRevisions,
  )
  #completedErrors = new WeakSet<object>()

  constructor(l1Capacity: number) {
    this.l1 = new BoundedEsiL1Cache(l1Capacity)
  }

  markErrorCompleted(error: unknown) {
    if (typeof error === 'object' && error) this.#completedErrors.add(error)
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
    this.localQuota.inFlight.clear()
    this.localQuota.globalCooldownUntil = 0
    this.unrepairedResourceRevisions.clear()
    this.#completedErrors = new WeakSet()
  }
}

class BoundedStringSet implements BoundedStringSetPort {
  readonly #values = new Set<string>()
  #overflowed = false

  constructor(private readonly capacity: number) {}

  has(value: string) {
    return this.#overflowed || this.#values.has(value)
  }

  add(value: string) {
    this.#values.delete(value)
    this.#values.add(value)
    if (this.#values.size <= this.capacity) return
    // Losing a repair marker could expose stale private data, so overflow fails closed for all keys.
    this.#overflowed = true
    const oldest = this.#values.values().next().value
    if (oldest !== undefined) this.#values.delete(oldest)
  }

  delete(value: string) {
    this.#values.delete(value)
  }

  clear() {
    this.#values.clear()
    this.#overflowed = false
  }
}
