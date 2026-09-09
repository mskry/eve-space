import { env } from '../env.js'
import { getSharedCacheRedisConnection } from './cache-redis.js'
import type { EsiOperation } from './catalog.js'
import { recordEsiResponse } from './cooldowns.js'
import { acquireEsiRequestPermit, type EsiRequestPermit } from './permits.js'
import { recordEsiRateMeasurement } from './rate-measurement.js'
import { recordEsiUpstreamOutcome } from './telemetry-counters.js'
import { createRawEsiTransport, getCoordinationConnection } from './transport.js'

export function createEsiTransport(
  operation: EsiOperation,
  principal?: string,
): typeof globalThis.fetch {
  return async (input, init) => {
    const permit = await acquireEsiRequestPermit({
      connection: getCoordinationConnection(),
      operation,
      principal,
      concurrency: env.ESI_OPERATION_CONCURRENCY,
    })
    const permitLifecycle = new EsiRequestPermitLifecycle(permit)
    const transport = createRawEsiTransport({
      onResponseBodySettled: () => void permitLifecycle.release(),
    })
    try {
      const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
      const signal = callerSignal
        ? AbortSignal.any([callerSignal, permitLifecycle.signal])
        : permitLifecycle.signal
      const response = await transport(input, { ...init, signal })
      const cache = getSharedCacheRedisConnection()
      void Promise.all([
        recordEsiRateMeasurement(cache, {
          operation,
          principal,
          status: response.status,
        }),
        recordEsiUpstreamOutcome(
          cache,
          operation,
          response.status,
          response.headers.get('x-ratelimit-group'),
        ),
      ]).catch(() => {})
      await recordEsiResponse({
        connection: getCoordinationConnection(),
        operation,
        principal,
        status: response.status,
        headers: response.headers,
      }).catch(() => {})
      return response
    } catch (error) {
      await permitLifecycle.release()
      throw error
    }
  }
}

class EsiRequestPermitLifecycle {
  readonly #lossController = new AbortController()
  readonly #renewalTimer: ReturnType<typeof setInterval>
  #settled = false
  #renewalInFlight: Promise<void> | undefined
  #releasePromise: Promise<void> | undefined

  constructor(private readonly permit: EsiRequestPermit) {
    this.#renewalTimer = setInterval(() => this.#renew(), Math.floor(permit.ttlMs / 2))
    this.#renewalTimer.unref()
  }

  get signal() {
    return this.#lossController.signal
  }

  release() {
    if (this.#releasePromise) return this.#releasePromise
    this.#settled = true
    clearInterval(this.#renewalTimer)
    this.#releasePromise = (async () => {
      await this.#renewalInFlight?.catch(() => {})
      await this.permit.release().catch(() => {})
    })()
    return this.#releasePromise
  }

  #lose() {
    if (this.#settled) return
    this.#settled = true
    clearInterval(this.#renewalTimer)
    this.#lossController.abort(
      new DOMException('ESI concurrency permit ownership lost', 'AbortError'),
    )
  }

  #renew() {
    if (this.#settled || this.#renewalInFlight) return
    const pending = this.permit.renew().then(
      (renewed) => {
        if (!renewed) this.#lose()
      },
      () => this.#lose(),
    )
    this.#renewalInFlight = pending
    void pending.finally(() => {
      if (this.#renewalInFlight === pending) this.#renewalInFlight = undefined
      if (this.#settled && !this.#releasePromise) void this.release()
    })
  }
}
