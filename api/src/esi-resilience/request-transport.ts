import { env } from '../env.js'
import { getSharedCacheRedisConnection } from './cache-redis.js'
import type { EsiOperation } from './catalog.js'
import { recordEsiResponse } from './cooldowns.js'
import { acquireEsiRequestPermit } from './permits.js'
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
    const renewal = setInterval(
      () => {
        void permit.renew().catch(() => {})
      },
      Math.floor(permit.ttlMs / 2),
    )
    renewal.unref()
    let permitReleased = false
    const releasePermit = async () => {
      if (permitReleased) return
      permitReleased = true
      clearInterval(renewal)
      await permit.release().catch(() => {})
    }
    const transport = createRawEsiTransport({
      onResponseBodySettled: () => void releasePermit(),
    })
    try {
      const response = await transport(input, init)
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
      await releasePermit()
      throw error
    }
  }
}
