import { env } from '../env.js'
import { createProducerRedisConnection, type QueueRedisConnection } from '../queue/redis.js'
import { getSharedCacheRedisConnection } from './cache-redis.js'
import type { EsiOperation } from './catalog.js'
import { acquireEsiRequestPermit, recordEsiResponse } from './cooldowns.js'
import { recordEsiRateMeasurement } from './rate-measurement.js'
import { recordEsiUpstreamOutcome } from './telemetry.js'

let coordinationConnection: QueueRedisConnection | undefined

export class EsiTransportError extends Error {
  constructor(
    cause: unknown,
    readonly status?: number,
  ) {
    super('ESI transport request failed', { cause })
    this.name = 'EsiTransportError'
  }
}

export function createEsiTransport(
  operation: EsiOperation,
  principal?: string,
): typeof globalThis.fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers)
    headers.set('User-Agent', env.ESI_USER_AGENT)
    headers.set('X-Compatibility-Date', env.ESI_COMPATIBILITY_DATE)
    const permit = await acquireEsiRequestPermit({
      connection: getCoordinationConnection(),
      operation,
      principal,
      concurrency: env.ESI_OPERATION_CONCURRENCY,
    })
    const renewal = setInterval(() => {
      void permit.renew().catch(() => {})
    }, 15_000)
    renewal.unref()
    try {
      let response: Response
      try {
        response = await globalThis.fetch(input, { ...init, headers })
      } catch (error) {
        throw new EsiTransportError(error)
      }
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
      return wrapEsiErrorResponseBody(response)
    } finally {
      clearInterval(renewal)
      await permit.release().catch(() => {})
    }
  }
}

function wrapEsiErrorResponseBody(response: Response) {
  if (response.ok || !response.body) return response
  return new Response(wrapStreamErrors(response.body, response.status), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

function wrapStreamErrors(body: ReadableStream<Uint8Array>, status: number) {
  const reader = body.getReader()
  let released = false
  const release = () => {
    if (released) return
    released = true
    reader.releaseLock()
  }
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read()
        if (result.done) {
          release()
          controller.close()
        } else controller.enqueue(result.value)
      } catch (error) {
        release()
        controller.error(new EsiTransportError(error, status))
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason)
      } finally {
        release()
      }
    },
  })
}

export function getCoordinationConnection() {
  coordinationConnection ??= createProducerRedisConnection()
  return coordinationConnection
}
