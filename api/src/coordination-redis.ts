import { Redis, type RedisOptions } from 'ioredis'
import { env } from './env.js'
import { closeRedisConnection } from './redis-close.js'

const boundedRetryLimit = 3
const retryDelayMs = 100

export type CoordinationRedisConnection = Redis

let sharedCoordinationConnection: CoordinationRedisConnection | undefined
let pendingSharedClose: Promise<void> | undefined

export function createCoordinationRedisConnection(url = env.QUEUE_REDIS_URL) {
  return createCoordinationRedisClient(url, {
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) =>
      attempt > boundedRetryLimit ? null : Math.min(attempt * retryDelayMs, 1_000),
  })
}

export function getSharedCoordinationRedisConnection(): CoordinationRedisConnection {
  if (pendingSharedClose) throw new Error('Coordination Redis connection is closing')
  sharedCoordinationConnection ??= createCoordinationRedisConnection()
  return sharedCoordinationConnection
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

export function closeCoordinationRedisConnection(
  connection: CoordinationRedisConnection,
  timeoutMs?: number,
) {
  return closeRedisConnection(connection, timeoutMs)
}

export function closeSharedCoordinationRedisConnection(timeoutMs?: number): Promise<void> {
  if (pendingSharedClose) return pendingSharedClose
  if (!sharedCoordinationConnection) return Promise.resolve()
  pendingSharedClose = closeCoordinationRedisConnection(
    sharedCoordinationConnection,
    timeoutMs,
  ).finally(() => {
    sharedCoordinationConnection = undefined
    pendingSharedClose = undefined
  })
  return pendingSharedClose
}
