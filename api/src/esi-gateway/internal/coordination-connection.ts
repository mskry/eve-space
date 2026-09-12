import {
  closeSharedCoordinationRedisConnection as closeSharedConnection,
  getSharedCoordinationRedisConnection as getSharedConnection,
  type CoordinationRedisConnection,
} from '../../coordination-redis.js'

export function getCoordinationConnection(): CoordinationRedisConnection {
  return getSharedConnection()
}

export function closeSharedCoordinationRedisConnection(timeoutMs?: number): Promise<void> {
  return closeSharedConnection(timeoutMs)
}
