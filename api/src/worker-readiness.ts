import { sql } from './db/client.js'
import { workerHeartbeatStaleAfterMs } from './queue/policy.js'
import { probeQueueStatus } from './queue/status.js'

export const expectedWorkerMigration = '010_domain_event_relay_safety.sql'

export class WorkerSchemaNotReadyError extends Error {
  constructor() {
    super(`Worker requires migration ${expectedWorkerMigration}`)
  }
}

export async function checkWorkerReadiness(connection = sql) {
  try {
    const [table] = await connection<{ exists: boolean }[]>`
      select exists(
        select 1 from information_schema.tables
        where table_schema = current_schema() and table_name = 'schema_migrations'
      ) as exists
    `
    if (!table?.exists) {
      return { healthy: false as const, reason: `Missing migration ${expectedWorkerMigration}` }
    }

    const [result] = await connection<{ applied: boolean }[]>`
      select exists(
        select 1 from schema_migrations where name = ${expectedWorkerMigration}
      ) as applied
    `

    if (result?.applied) return { healthy: true as const }
    return { healthy: false as const, reason: `Missing migration ${expectedWorkerMigration}` }
  } catch (error) {
    console.error('Worker database readiness check failed', error)
    return { healthy: false as const, reason: 'Database unavailable' }
  }
}

export async function assertWorkerReadiness(connection = sql) {
  const readiness = await checkWorkerReadiness(connection)
  if (!readiness.healthy) throw new WorkerSchemaNotReadyError()
}

async function checkSchemaAndQueueReachability(
  connection: typeof sql,
  queueProbe: typeof probeQueueStatus,
) {
  const readiness = await checkWorkerReadiness(connection)
  if (!readiness.healthy) return readiness
  const queue = await queueProbe()
  if (queue.status === 'unavailable')
    return { healthy: false as const, reason: 'Queue Redis unavailable' }
  return { healthy: true as const, queue }
}

/**
 * Startup precondition. Worker liveness is excluded deliberately: the heartbeat this worker is
 * about to publish cannot also gate its own start, or the first worker could never come up.
 */
export async function checkWorkerStartupDependencies(
  connection = sql,
  queueProbe: typeof probeQueueStatus = probeQueueStatus,
) {
  const dependencies = await checkSchemaAndQueueReachability(connection, queueProbe)
  if (!dependencies.healthy) return dependencies
  return { healthy: true as const }
}

/** Liveness check for an already-started worker; used by the container healthcheck command. */
export async function checkWorkerDependencies(
  connection = sql,
  queueProbe: typeof probeQueueStatus = probeQueueStatus,
) {
  const dependencies = await checkSchemaAndQueueReachability(connection, queueProbe)
  if (!dependencies.healthy) return dependencies
  const heartbeatAt = dependencies.queue.workerHeartbeatAt
  const heartbeatTime = heartbeatAt ? Date.parse(heartbeatAt) : Number.NaN
  if (Number.isNaN(heartbeatTime) || Date.now() - heartbeatTime > workerHeartbeatStaleAfterMs)
    return { healthy: false as const, reason: 'Worker heartbeat stale' }
  return { healthy: true as const }
}

export async function assertWorkerStartupDependencies(
  connection = sql,
  queueProbe: typeof probeQueueStatus = probeQueueStatus,
) {
  const readiness = await checkWorkerStartupDependencies(connection, queueProbe)
  if (!readiness.healthy) throw new Error(`Worker dependency unavailable: ${readiness.reason}`)
}

export async function assertWorkerDependencies(
  connection = sql,
  queueProbe: typeof probeQueueStatus = probeQueueStatus,
) {
  const readiness = await checkWorkerDependencies(connection, queueProbe)
  if (!readiness.healthy) throw new Error(`Worker dependency unavailable: ${readiness.reason}`)
}
