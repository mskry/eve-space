import { createCoordinationRedisClient } from '../coordination-redis.js'
import { env } from '../env.js'

const retryDelayMs = 100

export function createWorkerRedisConnection(url = env.QUEUE_REDIS_URL) {
  return createCoordinationRedisClient(url, {
    maxRetriesPerRequest: null,
    retryStrategy: (attempt) => Math.min(attempt * retryDelayMs, 2_000),
  })
}
