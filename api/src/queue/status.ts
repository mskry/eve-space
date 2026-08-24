import { Queue } from 'bullmq'
import { env } from '../env.js'
import { closeQueueRedisConnection, createProbeRedisConnection } from './redis.js'
import {
  operationsQueueName,
  outboxRelayOutcomeKey,
  outboxRelayStateKey,
  plannerStateKey,
  queuePrefix,
  schedulerOutcomeKey,
  workerHeartbeatKey,
  workerRegistryKey,
} from './namespaces.js'
import type { QueueRedisConnection } from './redis.js'
import { workerHeartbeatStaleAfterMs } from './policy.js'

export interface QueueStatus {
  status: 'operational' | 'degraded' | 'unavailable'
  workerHeartbeatAt: string | null
  /** Replicas with a live beat, so one healthy sibling cannot stand in for a stuck one. */
  workers: number | null
  depth: number | null
  oldestWaitingAgeSeconds: number | null
  active: number | null
  retrying: number | null
  failed: number | null
  plannerPaused: boolean
  outboxRelayPaused: boolean
  latestOutboxRelayOutcome: OutboxRelayOutcome | null
  latestSchedulerOutcome: 'registered' | null
}

export interface OutboxRelayOutcome {
  outcome: 'idle' | 'published' | 'partial-failure' | 'failed' | 'paused'
  category: 'queue-unavailable' | 'queue-rejected' | 'invalid-event' | 'unknown' | null
  recordedAt: string
}

/**
 * @param scopedWorkerId Restricts liveness to one replica's beat; the healthcheck passes its own
 * id, while `/api/status` omits it and reports the freshest beat in the deployment.
 */
export async function probeQueueStatus(scopedWorkerId?: string): Promise<QueueStatus> {
  const connection = createProbeRedisConnection()
  const queue = new Queue(operationsQueueName, {
    connection,
    prefix: queuePrefix,
    skipWaitingForReady: true,
  })
  try {
    await connection.ping()
    const [
      counts,
      waiting,
      delayed,
      beats,
      plannerState,
      outboxRelayState,
      outboxRelayOutcome,
      schedulerOutcome,
    ] = await Promise.all([
      queue.getJobCounts('waiting', 'delayed', 'active', 'failed'),
      queue.getJobs(['waiting'], 0, 0, true),
      // Admission bounds normal depth; cap inspection as a final safeguard if producers race.
      queue.getJobs(['delayed'], 0, env.QUEUE_HIGH_WATER_MARK, true),
      readWorkerHeartbeats(connection, scopedWorkerId),
      connection.get(plannerStateKey),
      connection.get(outboxRelayStateKey),
      connection.get(outboxRelayOutcomeKey),
      connection.get(schedulerOutcomeKey),
    ])
    const heartbeat = latestHeartbeat(beats)
    const oldest = waiting[0]
    const depth = (counts.waiting ?? 0) + (counts.delayed ?? 0)
    const oldestWaitingAgeSeconds = oldest
      ? Math.max(0, Math.floor((Date.now() - oldest.timestamp) / 1_000))
      : null
    const heartbeatTime = heartbeat ? Date.parse(heartbeat) : Number.NaN
    const workerStale =
      !heartbeat ||
      Number.isNaN(heartbeatTime) ||
      Date.now() - heartbeatTime > workerHeartbeatStaleAfterMs
    const lagged = (oldestWaitingAgeSeconds ?? 0) > env.QUEUE_LAG_DEGRADED_SECONDS
    return {
      status: workerStale || lagged ? 'degraded' : 'operational',
      workerHeartbeatAt: heartbeat,
      workers: beats.filter((beat) => beat !== null).length,
      depth,
      oldestWaitingAgeSeconds,
      active: counts.active ?? 0,
      retrying: delayed.filter((job) => job.attemptsMade > 0).length,
      failed: counts.failed ?? 0,
      plannerPaused: plannerState === 'paused',
      outboxRelayPaused: outboxRelayState === 'paused',
      latestOutboxRelayOutcome: parseOutboxRelayOutcome(outboxRelayOutcome),
      latestSchedulerOutcome: schedulerOutcome === 'registered' ? 'registered' : null,
    }
  } catch {
    return {
      status: 'unavailable',
      workerHeartbeatAt: null,
      workers: null,
      depth: null,
      oldestWaitingAgeSeconds: null,
      active: null,
      retrying: null,
      failed: null,
      plannerPaused: false,
      outboxRelayPaused: false,
      latestOutboxRelayOutcome: null,
      latestSchedulerOutcome: null,
    }
  } finally {
    await Promise.allSettled([queue.close(), closeQueueRedisConnection(connection)])
  }
}

function parseOutboxRelayOutcome(value: string | null): OutboxRelayOutcome | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null) return null
    const outcome = 'outcome' in parsed ? parsed.outcome : null
    const category = 'category' in parsed ? parsed.category : null
    const recordedAt = 'recordedAt' in parsed ? parsed.recordedAt : null
    if (
      !['idle', 'published', 'partial-failure', 'failed', 'paused'].includes(outcome as string) ||
      ![null, 'queue-unavailable', 'queue-rejected', 'invalid-event', 'unknown'].includes(
        category as string | null,
      ) ||
      typeof recordedAt !== 'string' ||
      Number.isNaN(Date.parse(recordedAt))
    )
      return null
    return { outcome, category, recordedAt } as OutboxRelayOutcome
  } catch {
    return null
  }
}

async function readWorkerHeartbeats(connection: QueueRedisConnection, scopedWorkerId?: string) {
  if (scopedWorkerId) return connection.mget([workerHeartbeatKey(scopedWorkerId)])
  const registered = await connection.smembers(workerRegistryKey)
  if (registered.length === 0) return []
  return connection.mget(registered.map(workerHeartbeatKey))
}

function latestHeartbeat(beats: (string | null)[]) {
  let latest: string | null = null
  let latestTime = Number.NEGATIVE_INFINITY
  let unparseable: string | null = null
  for (const beat of beats) {
    if (!beat) continue
    const time = Date.parse(beat)
    if (Number.isNaN(time)) {
      unparseable ??= beat
      continue
    }
    if (time > latestTime) {
      latest = beat
      latestTime = time
    }
  }
  // Reported anyway when it is all there is: stale either way, and the raw value is diagnosable.
  return latest ?? unparseable
}
