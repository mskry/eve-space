import {
  closeCoordinationRedisConnection,
  createCoordinationRedisProbe,
  type CoordinationRedisConnection,
} from '../coordination-redis.js'
import { workerHeartbeatKey } from './namespaces.js'
import { workerHeartbeatStaleAfterMs } from './policy.js'

export type ScopedWorkerLiveness =
  | { readonly status: 'operational'; readonly heartbeatAt: string }
  | { readonly status: 'stale'; readonly heartbeatAt: null }
  | { readonly status: 'unavailable'; readonly heartbeatAt: null }

export async function probeScopedWorkerLiveness(workerId: string): Promise<ScopedWorkerLiveness> {
  let connection: CoordinationRedisConnection | undefined
  try {
    connection = createCoordinationRedisProbe()
    await connection.ping()
    return evaluateScopedWorkerLiveness(await connection.get(workerHeartbeatKey(workerId)))
  } catch {
    return { status: 'unavailable', heartbeatAt: null }
  } finally {
    if (connection) await closeCoordinationRedisConnection(connection).catch(() => {})
  }
}

export function evaluateScopedWorkerLiveness(
  heartbeat: string | null,
  now = Date.now(),
): ScopedWorkerLiveness {
  const decoded = decodeWorkerHeartbeat(heartbeat, now)
  if (!decoded || now - decoded.time > workerHeartbeatStaleAfterMs)
    return { status: 'stale', heartbeatAt: null }
  return { status: 'operational', heartbeatAt: decoded.heartbeatAt }
}

export function decodeWorkerHeartbeat(heartbeat: string | null, now = Date.now()) {
  if (!heartbeat) return null
  const time = Date.parse(heartbeat)
  if (
    !Number.isFinite(time) ||
    new Date(time).toISOString() !== heartbeat ||
    time > now + workerHeartbeatStaleAfterMs
  )
    return null
  return { heartbeatAt: heartbeat, time }
}
