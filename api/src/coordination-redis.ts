import { Redis, type RedisOptions } from 'ioredis'
import { env } from './env.js'

const boundedRetryLimit = 3
const retryDelayMs = 100

export type CoordinationRedisConnection = Redis

export function createCoordinationRedisConnection(url = env.QUEUE_REDIS_URL) {
  return createCoordinationRedisClient(url, {
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) =>
      attempt > boundedRetryLimit ? null : Math.min(attempt * retryDelayMs, 1_000),
  })
}

export function createCoordinationRedisProbe(url = env.QUEUE_REDIS_URL) {
  return createCoordinationRedisClient(url, {
    commandTimeout: 1_000,
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) =>
      attempt > boundedRetryLimit ? null : Math.min(attempt * retryDelayMs, 1_000),
  })
}

export function createCoordinationRedisClient(url: string, options: RedisOptions) {
  const connection = new Redis(url, {
    connectTimeout: 1_000,
    lazyConnect: true,
    ...options,
  })
  connection.on('error', () => {})
  return connection
}

export async function closeCoordinationRedisConnection(connection: CoordinationRedisConnection) {
  if (connection.status === 'end') return
  if (connection.status === 'wait') {
    connection.disconnect()
    return
  }
  try {
    await connection.quit()
  } catch {
    connection.disconnect()
  }
}
