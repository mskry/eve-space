import {
  closeCoordinationRedisConnection,
  createCoordinationRedisProbe,
  type CoordinationRedisConnection,
} from '../coordination-redis.js'
import { env } from '../env.js'
import { isNonnegativeSafeInteger } from '../type-guards.js'
import {
  affiliationPlannerOutcomeKey,
  outboxRelayOutcomeKey,
  outboxRelayStateKey,
  plannerStateKey,
  schedulerOutcomeKey,
  workerHeartbeatKey,
  workerRegistryKey,
} from './namespaces.js'
import { workerHeartbeatStaleAfterMs } from './policy.js'
import {
  decodeAffiliationPlannerOutcome,
  decodeOutboxRelayOutcome,
  type AffiliationPlannerOutcome,
  type OutboxRelayOutcome,
} from './outcomes.js'
import { createOperationsQueueHandle, type OperationsQueueHandle } from './operations-queue.js'
import { decodeWorkerHeartbeat } from './worker-liveness.js'

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
  memoryUsedBytes: number | null
  memoryMaxBytes: number | null
  memoryUsedPercent: number | null
  plannerPaused: boolean
  outboxRelayPaused: boolean
  latestOutboxRelayOutcome: OutboxRelayOutcome | null
  latestSchedulerOutcome: 'registered' | null
  latestAffiliationPlannerOutcome: AffiliationPlannerOutcome | null
}

export async function probeQueueStatus(): Promise<QueueStatus> {
  let connection: CoordinationRedisConnection | undefined
  let handle: OperationsQueueHandle | undefined
  try {
    connection = createCoordinationRedisProbe()
    handle = createOperationsQueueHandle({ connection })
    const { queue } = handle
    await connection.ping()
    const [
      counts,
      waiting,
      prioritized,
      delayed,
      beats,
      plannerState,
      outboxRelayState,
      outboxRelayOutcome,
      schedulerOutcome,
      affiliationPlannerOutcome,
      memoryInfo,
      maxMemoryConfiguration,
    ] = await Promise.all([
      queue.getJobCounts('waiting', 'delayed', 'prioritized', 'active', 'failed'),
      queue.getJobs(['waiting'], 0, 0, true),
      queue.getJobs(['prioritized'], 0, env.QUEUE_HIGH_WATER_MARK, true),
      // Admission bounds normal depth; cap inspection as a final safeguard if producers race.
      queue.getJobs(['delayed'], 0, env.QUEUE_HIGH_WATER_MARK, true),
      readWorkerHeartbeats(connection),
      connection.get(plannerStateKey),
      connection.get(outboxRelayStateKey),
      connection.get(outboxRelayOutcomeKey),
      connection.get(schedulerOutcomeKey),
      connection.get(affiliationPlannerOutcomeKey),
      connection.info('memory'),
      connection.config('GET', 'maxmemory'),
    ])
    const now = Date.now()
    const heartbeat = summarizeHeartbeats(beats, now)
    const oldest = [...waiting, ...prioritized].reduce<(typeof waiting)[number] | undefined>(
      (current, job) => (!current || job.timestamp < current.timestamp ? job : current),
      undefined,
    )
    const depth = (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.prioritized ?? 0)
    const oldestWaitingAgeSeconds = oldest
      ? Math.max(0, Math.floor((now - oldest.timestamp) / 1_000))
      : null
    const workerStale = heartbeat.workers === 0
    const lagged = (oldestWaitingAgeSeconds ?? 0) > env.QUEUE_LAG_DEGRADED_SECONDS
    const memoryUsedBytes = parseMemoryInfo(memoryInfo, 'used_memory')
    const memoryMaxBytes = parseMaxMemory(maxMemoryConfiguration)
    const memoryUsedPercent =
      memoryMaxBytes > 0 ? Math.round((memoryUsedBytes / memoryMaxBytes) * 10_000) / 100 : null
    const memoryPressure = memoryUsedPercent !== null && memoryUsedPercent >= 90
    return {
      status: workerStale || lagged || memoryPressure ? 'degraded' : 'operational',
      workerHeartbeatAt: heartbeat.latest,
      workers: heartbeat.workers,
      depth,
      oldestWaitingAgeSeconds,
      active: counts.active ?? 0,
      retrying: delayed.filter((job) => job.attemptsMade > 0).length,
      failed: counts.failed ?? 0,
      memoryUsedBytes,
      memoryMaxBytes,
      memoryUsedPercent,
      plannerPaused: plannerState === 'paused',
      outboxRelayPaused: outboxRelayState === 'paused',
      latestOutboxRelayOutcome: decodeOutboxRelayOutcome(outboxRelayOutcome),
      latestSchedulerOutcome: schedulerOutcome === 'registered' ? 'registered' : null,
      latestAffiliationPlannerOutcome: decodeAffiliationPlannerOutcome(affiliationPlannerOutcome),
    }
  } catch {
    return unavailableQueueStatus()
  } finally {
    if (handle) await handle.close().catch(() => {})
    else if (connection) await closeCoordinationRedisConnection(connection).catch(() => {})
  }
}

function unavailableQueueStatus(): QueueStatus {
  return {
    status: 'unavailable',
    workerHeartbeatAt: null,
    workers: null,
    depth: null,
    oldestWaitingAgeSeconds: null,
    active: null,
    retrying: null,
    failed: null,
    memoryUsedBytes: null,
    memoryMaxBytes: null,
    memoryUsedPercent: null,
    plannerPaused: false,
    outboxRelayPaused: false,
    latestOutboxRelayOutcome: null,
    latestSchedulerOutcome: null,
    latestAffiliationPlannerOutcome: null,
  }
}

function parseMemoryInfo(info: string, metric: string) {
  const prefix = `${metric}:`
  const line = info.split('\n').find((candidate) => candidate.startsWith(prefix))
  const value = line ? Number(line.slice(prefix.length).trim()) : Number.NaN
  if (!isNonnegativeSafeInteger(value)) throw new Error(`Invalid Redis ${metric}`)
  return value
}

function parseMaxMemory(configuration: string[]) {
  const value = Number(configuration.at(-1))
  if (!isNonnegativeSafeInteger(value)) throw new Error('Invalid Redis maxmemory')
  return value
}

async function readWorkerHeartbeats(connection: CoordinationRedisConnection) {
  const registered = await connection.smembers(workerRegistryKey)
  if (registered.length === 0) return []
  return connection.mget(registered.map(workerHeartbeatKey))
}

function summarizeHeartbeats(beats: (string | null)[], now: number) {
  let latest: string | null = null
  let latestTime = Number.NEGATIVE_INFINITY
  let workers = 0
  for (const beat of beats) {
    const decoded = decodeWorkerHeartbeat(beat, now)
    if (!decoded || now - decoded.time > workerHeartbeatStaleAfterMs) continue
    workers += 1
    if (decoded.time > latestTime) {
      latest = decoded.heartbeatAt
      latestTime = decoded.time
    }
  }
  return { latest, workers }
}
