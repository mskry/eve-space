import { sql } from '../db/client.js'
import {
  installedModuleIds,
  installedModuleMigrations,
} from '../generated/platform/installed-module-migrations.js'
import { workerHeartbeatStaleAfterMs } from '../queue/policy.js'
import { probeQueueStatus } from '../queue/status.js'

export interface WorkerMigrationRequirement {
  readonly module: string
  readonly name: string
}

export const expectedWorkerMigration = '001_initial.sql'
const workerMigrationRequirements: readonly WorkerMigrationRequirement[] = [
  { module: 'core', name: expectedWorkerMigration },
  ...installedModuleMigrations.map(({ moduleId, name }) => ({ module: moduleId, name })),
]

export class WorkerSchemaNotReadyError extends Error {
  constructor(
    requirement: WorkerMigrationRequirement = workerMigrationRequirements[0]!,
    reason?: string,
  ) {
    super(
      reason
        ? `Worker schema not ready: ${reason}`
        : `Worker requires migration ${formatMigration(requirement)}`,
    )
  }
}

export async function checkWorkerReadiness(
  connection = sql,
  requirements: readonly WorkerMigrationRequirement[] = workerMigrationRequirements,
  moduleIds: readonly string[] = installedModuleIds,
) {
  try {
    const [ledger] = await connection<{ exists: boolean; qualified: boolean }[]>`
      select
        exists(
          select 1 from information_schema.tables
          where table_schema = 'public' and table_name = 'schema_migrations'
        ) as exists,
        exists(
          select 1 from information_schema.columns
          where table_schema = 'public'
            and table_name = 'schema_migrations'
            and column_name = 'module'
        ) as qualified
    `
    const firstRequirement = requirements[0]
    if (!ledger?.exists || !ledger.qualified) {
      return firstRequirement
        ? {
            healthy: false as const,
            reason: `Missing migration ${formatMigration(firstRequirement)}`,
            missing: firstRequirement,
          }
        : { healthy: true as const }
    }

    const applied = await connection<{ module: string; name: string }[]>`
      select module, name from public.schema_migrations
    `
    const appliedIdentities = new Set(applied.map(formatMigration))
    const missing = requirements.find(
      (requirement) => !appliedIdentities.has(formatMigration(requirement)),
    )

    if (missing)
      return {
        healthy: false as const,
        reason: `Missing migration ${formatMigration(missing)}`,
        missing,
      }

    if (moduleIds.length > 0) {
      const provisioned = await connection<{ module_id: string }[]>`
        select module_id from public.module_schema_provisioning
      `
      const provisionedIds = new Set(provisioned.map(({ module_id }) => module_id))
      const missingProvisioning = moduleIds.find((moduleId) => !provisionedIds.has(moduleId))
      if (missingProvisioning)
        return {
          healthy: false as const,
          reason: `Missing module provisioning ${missingProvisioning}`,
          missingProvisioning,
        }
    }

    return { healthy: true as const }
  } catch (error) {
    console.error('Worker database readiness check failed', error)
    return { healthy: false as const, reason: 'Database unavailable' }
  }
}

export async function assertWorkerReadiness(connection = sql) {
  const readiness = await checkWorkerReadiness(connection)
  if (!readiness.healthy)
    throw new WorkerSchemaNotReadyError(
      'missing' in readiness ? readiness.missing : undefined,
      readiness.reason,
    )
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

function formatMigration({ module, name }: WorkerMigrationRequirement) {
  return `${module}/${name}`
}
