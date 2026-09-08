import type { StaticLocationSnapshot } from './static-location-types.js'

export interface StaticLocationCacheView {
  snapshot: StaticLocationSnapshot | undefined
  inFlight: Promise<StaticLocationSnapshot> | undefined
  nextCheckAt: number
  failure: unknown
  generation: number
}

export class StaticLocationCacheState {
  readonly #state: StaticLocationCacheView = {
    snapshot: undefined,
    inFlight: undefined,
    nextCheckAt: 0,
    failure: undefined,
    generation: 0,
  }

  read(): Readonly<StaticLocationCacheView> {
    return { ...this.#state }
  }

  begin(
    generation: number,
    operation: () => Promise<StaticLocationSnapshot>,
  ): Promise<StaticLocationSnapshot> | undefined {
    if (generation !== this.#state.generation || this.#state.inFlight) return undefined
    const promise = Promise.resolve().then(operation)
    this.#state.inFlight = promise
    void promise.then(
      () => this.#clearInFlight(promise),
      () => this.#clearInFlight(promise),
    )
    return promise
  }

  publish(snapshot: StaticLocationSnapshot, generation: number, nextCheckAt: number) {
    if (generation !== this.#state.generation) return false
    this.#state.snapshot = snapshot
    this.#state.nextCheckAt = nextCheckAt
    this.#state.failure = undefined
    return true
  }

  retain(generation: number, failure: unknown, nextCheckAt: number) {
    if (generation !== this.#state.generation) return false
    this.#state.nextCheckAt = nextCheckAt
    this.#state.failure = failure
    return true
  }

  reset() {
    this.#state.snapshot = undefined
    this.#state.inFlight = undefined
    this.#state.nextCheckAt = 0
    this.#state.failure = undefined
    this.#state.generation += 1
  }

  #clearInFlight(promise: Promise<StaticLocationSnapshot>) {
    if (this.#state.inFlight === promise) this.#state.inFlight = undefined
  }
}

export const staticLocationCacheState = new StaticLocationCacheState()
