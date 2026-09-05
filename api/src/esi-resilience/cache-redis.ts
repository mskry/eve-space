import { Redis, type RedisOptions } from 'ioredis'
import { env } from '../env.js'
import { recordCacheConnectionError } from './telemetry-counters.js'

const retryBaseDelayMs = 100
const retryMaxDelayMs = 2_000
const timeoutMs = 1_000

export type CacheRedisConnection = Redis

let sharedCacheConnection: CacheRedisConnection | undefined
const initialConnections = new WeakMap<CacheRedisConnection, Promise<void>>()

const cacheRedisOptions: RedisOptions = {
  connectTimeout: timeoutMs,
  commandTimeout: timeoutMs,
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  retryStrategy: (attempt) => Math.min(attempt * retryBaseDelayMs, retryMaxDelayMs),
}

export function createCacheRedisConnection(url = env.CACHE_REDIS_URL): CacheRedisConnection {
  const connection = new Redis(url, cacheRedisOptions)
  connection.on('error', (error: NodeJS.ErrnoException) => {
    recordCacheConnectionError(error.code ?? 'UNKNOWN')
  })
  const initialConnection = connection.connect()
  initialConnections.set(connection, initialConnection)
  void initialConnection.catch(() => {})
  return connection
}

export function getSharedCacheRedisConnection(): CacheRedisConnection {
  sharedCacheConnection ??= createCacheRedisConnection()
  return sharedCacheConnection
}

export function waitForCacheRedisConnection(connection: CacheRedisConnection): Promise<void> {
  if (connection.status === 'ready') return Promise.resolve()
  return initialConnections.get(connection) ?? connection.connect()
}

export async function closeCacheRedisConnection(connection: CacheRedisConnection): Promise<void> {
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

export async function closeSharedCacheRedisConnection(): Promise<void> {
  const connection = sharedCacheConnection
  sharedCacheConnection = undefined
  if (connection) await closeCacheRedisConnection(connection)
}
