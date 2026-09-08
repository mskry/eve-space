import type { UniverseTopologySnapshot } from './route-types.js'

interface UniverseTopologyStateView {
  snapshot: UniverseTopologySnapshot | undefined
  inFlight: Promise<UniverseTopologySnapshot> | undefined
  nextCheckAt: number
  failure: unknown
  generation: number
}

export class UniverseTopologyState {
  readonly #state: UniverseTopologyStateView = {
    snapshot: undefined,
    inFlight: undefined,
    nextCheckAt: 0,
    failure: undefined,
    generation: 0,
  }

  read(): Readonly<UniverseTopologyStateView> {
    return { ...this.#state }
  }

  begin(
    generation: number,
    operation: () => Promise<UniverseTopologySnapshot>,
  ): Promise<UniverseTopologySnapshot> | undefined {
    if (generation !== this.#state.generation || this.#state.inFlight) return undefined
    const promise = Promise.resolve().then(operation)
    this.#state.inFlight = promise
    void promise.then(
      () => this.#clearInFlight(promise),
      () => this.#clearInFlight(promise),
    )
    return promise
  }

  publish(snapshot: UniverseTopologySnapshot, generation: number, nextCheckAt: number) {
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

  fail(generation: number, failure: unknown, nextCheckAt: number) {
    if (generation !== this.#state.generation) return false
    this.#state.snapshot = undefined
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

  #clearInFlight(promise: Promise<UniverseTopologySnapshot>) {
    if (this.#state.inFlight === promise) this.#state.inFlight = undefined
  }
}

export const universeTopologyState = new UniverseTopologyState()
