import {
  closeSharedCacheRedisConnection,
  getSharedCacheRedisConnection,
  waitForCacheRedisConnection,
} from '../esi-resilience/cache-redis.js'
import { readEsiRateMeasurement } from '../esi-resilience/rate-measurement.js'

const connection = getSharedCacheRedisConnection()

try {
  await waitForCacheRedisConnection(connection)
  const measurement = await readEsiRateMeasurement(connection, {
    windowOffset: process.argv.includes('--current') ? 0 : 1,
  })
  process.stdout.write(`${JSON.stringify(measurement, null, 2)}\n`)
} finally {
  await closeSharedCacheRedisConnection()
}
