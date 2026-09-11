import {
  closeCoordinationRedisConnection,
  createCoordinationRedisConnection,
  type CoordinationRedisConnection,
} from '../coordination-redis.js'

let coordinationConnection: CoordinationRedisConnection | undefined
let pendingClose: Promise<void> | undefined

export function getCoordinationConnection(): CoordinationRedisConnection {
  if (pendingClose) throw new Error('Coordination Redis connection is closing')
  coordinationConnection ??= createCoordinationRedisConnection()
  return coordinationConnection
}

export function closeSharedCoordinationRedisConnection(timeoutMs?: number): Promise<void> {
  if (pendingClose) return pendingClose
  if (!coordinationConnection) return Promise.resolve()
  pendingClose = closeCoordinationRedisConnection(coordinationConnection, timeoutMs).finally(() => {
    coordinationConnection = undefined
    pendingClose = undefined
  })
  return pendingClose
}
