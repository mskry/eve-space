import { Redis } from 'ioredis'
import { env } from '../env.js'

const retryLimit = 3
const retryDelayMs = 100

export type CacheRedisConnection = Redis

let sharedCacheConnection: CacheRedisConnection | undefined

export function createCacheRedisConnection(url = env.CACHE_REDIS_URL) {
  const connection = new Redis(url, {
    connectTimeout: 1_000,
    commandTimeout: 1_000,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) =>
      attempt > retryLimit ? null : Math.min(attempt * retryDelayMs, 1_000),
  })
  // Cache availability is represented by controlled outcomes, never by a connection URL in logs.
  connection.on('error', () => {})
  return connection
}

export function getSharedCacheRedisConnection() {
  sharedCacheConnection ??= createCacheRedisConnection()
  return sharedCacheConnection
}

export async function closeCacheRedisConnection(connection: CacheRedisConnection) {
  if (connection.status === 'end') return
  try {
    await connection.quit()
  } catch {
    connection.disconnect()
  }
}
