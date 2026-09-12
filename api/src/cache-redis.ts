import { Redis, type RedisOptions } from 'ioredis'
import { env } from './env.js'
import { closeRedisConnection } from './redis-close.js'

const retryBaseDelayMs = 100
const retryMaxDelayMs = 2_000
const timeoutMs = 1_000

export type CacheRedisConnection = Redis

let sharedCacheConnection: CacheRedisConnection | undefined
const initialConnections = new WeakMap<CacheRedisConnection, Promise<void>>()
let cacheConnectionErrorObserver: ((code: string) => void) | undefined

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
    cacheConnectionErrorObserver?.(error.code ?? 'UNKNOWN')
  })
  const initialConnection = connection.connect()
  initialConnections.set(connection, initialConnection)
  void initialConnection.catch(() => {})
  return connection
}

export function observeCacheRedisConnectionErrors(observer: (code: string) => void): void {
  cacheConnectionErrorObserver = observer
}

export function getSharedCacheRedisConnection(): CacheRedisConnection {
  sharedCacheConnection ??= createCacheRedisConnection()
  return sharedCacheConnection
}

export function waitForCacheRedisConnection(connection: CacheRedisConnection): Promise<void> {
  if (connection.status === 'ready') return Promise.resolve()
  return initialConnections.get(connection) ?? connection.connect()
}

export function closeCacheRedisConnection(
  connection: CacheRedisConnection,
  closeTimeoutMs?: number,
): Promise<void> {
  return closeRedisConnection(connection, closeTimeoutMs)
}

export async function closeSharedCacheRedisConnection(closeTimeoutMs?: number): Promise<void> {
  const connection = sharedCacheConnection
  sharedCacheConnection = undefined
  if (connection) await closeCacheRedisConnection(connection, closeTimeoutMs)
}
