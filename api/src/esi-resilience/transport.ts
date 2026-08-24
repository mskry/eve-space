import { env } from '../env.js'
import { createProducerRedisConnection, type QueueRedisConnection } from '../queue/redis.js'
import { acquireEsiRequestPermit, recordEsiResponse } from './cooldowns.js'
import { getEsiOperationPolicy, type EsiOperation } from './policy.js'
import { recordEsiUpstreamOutcome } from './telemetry.js'

let coordinationConnection: QueueRedisConnection | undefined

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
      concurrency: getEsiOperationPolicy(operation).concurrency,
    })
    const renewal = setInterval(() => {
      void permit.renew().catch(() => {})
    }, 15_000)
    renewal.unref()
    try {
      const response = await globalThis.fetch(input, { ...init, headers })
      await Promise.all([
        recordEsiResponse({
          connection: getCoordinationConnection(),
          operation,
          principal,
          status: response.status,
          headers: response.headers,
        }),
        ...(permit.coordinationAvailable
          ? [recordEsiUpstreamOutcome(getCoordinationConnection(), operation, response.status)]
          : []),
      ]).catch(() => {})
      return response
    } finally {
      clearInterval(renewal)
      await permit.release().catch(() => {})
    }
  }
}

export function getCoordinationConnection() {
  coordinationConnection ??= createProducerRedisConnection()
  return coordinationConnection
}
