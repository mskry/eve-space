import { sql } from './db/client.js'
import { checkWorkerReadiness } from './worker-readiness.js'

checkWorkerReadiness()
  .then((readiness) => {
    if (!readiness.healthy) {
      console.error(`Worker unhealthy: ${readiness.reason}`)
      process.exitCode = 1
    }
  })
  .finally(() => sql.end({ timeout: 1 }))
