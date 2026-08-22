import { sql } from './db/client.js'
import { assertWorkerReadiness } from './worker-readiness.js'

async function startWorker() {
  await assertWorkerReadiness()
  console.log('Worker database readiness verified')

  await new Promise<void>((resolve) => {
    process.once('SIGINT', resolve)
    process.once('SIGTERM', resolve)
  })
  await sql.end({ timeout: 5 })
}

startWorker().catch(async (error) => {
  console.error('Worker startup failed', error)
  await sql.end({ timeout: 1 })
  process.exitCode = 1
})
