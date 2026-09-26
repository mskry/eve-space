import type { EsiCacheEnvelope } from './types.js'

export class BoundedEsiL1Cache {
  readonly #entries = new Map<string, EsiCacheEnvelope<unknown>>()

  constructor(private readonly capacity: number) {}

  get(key: string): EsiCacheEnvelope<unknown> | undefined {
    const entry = this.#entries.get(key)
    if (!entry) {
      return undefined
    }
    this.#entries.delete(key)
    this.#entries.set(key, entry)
    return entry
  }

  set<Data>(key: string, envelope: EsiCacheEnvelope<Data>) {
    this.#entries.delete(key)
    this.#entries.set(key, envelope)
    if (this.#entries.size <= this.capacity) {
      return
    }
    const oldest = this.#entries.keys().next().value
    if (oldest !== undefined) {
      this.#entries.delete(oldest)
    }
  }

  delete(key: string) {
    this.#entries.delete(key)
  }

  clear() {
    this.#entries.clear()
  }
}
