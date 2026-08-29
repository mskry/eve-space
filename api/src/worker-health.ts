import { sql } from './db/client.js'
import { probeQueueStatus } from './queue/status.js'
import { workerId } from './queue/worker-identity.js'
import { checkWorkerDependencies } from './worker-readiness.js'

async function runWorkerHealthcheck() {
  try {
    // Scoped to this replica: a sibling's beat says nothing about the worker in this container.
    const readiness = await checkWorkerDependencies(sql, () => probeQueueStatus(workerId))
    if (!readiness.healthy) {
      console.error(`Worker unhealthy: ${readiness.reason}`)
      process.exitCode = 1
    }
  } catch {
    console.error('Worker unhealthy: dependency probe failed')
    process.exitCode = 1
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {
      process.exitCode = 1
    })
  }
}

await runWorkerHealthcheck()
