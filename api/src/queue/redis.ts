import { Redis } from 'ioredis'
import { env } from '../env.js'

const producerRetryLimit = 3
const retryDelayMs = 100

export type QueueRedisConnection = Redis

export function createProducerRedisConnection(url = env.QUEUE_REDIS_URL) {
  return createBoundedRedisConnection(url)
}

export function createProbeRedisConnection(url = env.QUEUE_REDIS_URL) {
  return createBoundedRedisConnection(url, 1_000)
}

function createBoundedRedisConnection(url: string, commandTimeout?: number) {
  const connection = new Redis(url, {
    connectTimeout: 1_000,
    commandTimeout,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) =>
      attempt > producerRetryLimit ? null : Math.min(attempt * retryDelayMs, 1_000),
  })
  // Callers return controlled availability outcomes; never leak Redis URLs in event logs.
  connection.on('error', () => {})
  return connection
}

export function createWorkerRedisConnection(url = env.QUEUE_REDIS_URL) {
  const connection = new Redis(url, {
    connectTimeout: 1_000,
    lazyConnect: true,
    // BullMQ's blocking worker connection must not give up individual commands.
    maxRetriesPerRequest: null,
    retryStrategy: (attempt) => Math.min(attempt * retryDelayMs, 2_000),
  })
  connection.on('error', () => {})
  return connection
}

export async function closeQueueRedisConnection(connection: QueueRedisConnection) {
  if (connection.status === 'end') return
  try {
    await connection.quit()
  } catch {
    connection.disconnect()
  }
}
