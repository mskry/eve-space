import { sql } from '../db/client.js'
import { recordDiagnostic } from '../logging.js'
import { probeScopedWorkerLiveness } from '../queue/worker-liveness.js'
import { workerId } from '../queue/worker-identity.js'
import { checkWorkerDependencies } from './readiness.js'

async function runWorkerHealthcheck() {
  try {
    // Scoped to this replica: a sibling's beat says nothing about the worker in this container.
    const readiness = await checkWorkerDependencies(() => probeScopedWorkerLiveness(workerId), sql)
    if (!readiness.healthy) {
      recordDiagnostic('worker.healthcheck.unhealthy', {
        context: { healthState: healthState(readiness.reason) },
      })
      process.exitCode = 1
    }
  } catch (error) {
    recordDiagnostic('worker.healthcheck.failed', { error })
    process.exitCode = 1
  } finally {
    await sql.end({ timeout: 1 }).catch((error) => {
      recordDiagnostic('worker.healthcheck.cleanup-failed', { error })
      process.exitCode = 1
    })
  }
}

function healthState(reason: string) {
  if (reason === 'Database unavailable') return 'database-unavailable'
  if (reason === 'Queue Redis unavailable') return 'queue-unavailable'
  if (reason === 'Worker heartbeat stale') return 'heartbeat-stale'
  return 'schema-not-ready'
}

await runWorkerHealthcheck()
