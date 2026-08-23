import { sql } from './db/client.js'
import { env } from './env.js'
import { startWorkerPlatform } from './queue/platform.js'
import { assertWorkerStartupDependencies } from './worker-readiness.js'

export async function startWorker() {
  let shutdownRequested = false
  const shutdown = new Promise<void>((resolve) => {
    const requestShutdown = () => {
      shutdownRequested = true
      resolve()
    }
    process.once('SIGINT', requestShutdown)
    process.once('SIGTERM', requestShutdown)
  })
  await assertWorkerStartupDependencies()
  if (shutdownRequested) {
    await sql.end({ timeout: 5 })
    return
  }
  const platform = await startWorkerPlatform()
  console.log('Worker dependencies verified')

  await shutdown
  await platform.close(env.WORKER_SHUTDOWN_TIMEOUT_MS)
  await sql.end({ timeout: 5 })
}

startWorker().catch(async (error) => {
  console.error('Worker startup failed', error instanceof Error ? error.message : 'unknown error')
  await sql.end({ timeout: 1 })
  process.exitCode = 1
})
