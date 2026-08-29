import { sql } from './db/client.js'
import { env, isSsoConfigured } from './env.js'
import { assertEsiOperationCatalogConfiguration } from './esi-resilience/catalog.js'
import { assertInstalledResourceDeclarations } from './platform/resource-declarations.js'
import { startWorkerPlatform } from './queue/platform.js'
import { assertWorkerStartupDependencies } from './worker-readiness.js'

export async function startWorker() {
  assertEsiOperationCatalogConfiguration({
    compatibilityDate: env.ESI_COMPATIBILITY_DATE,
    ssoEnabled: isSsoConfigured(),
    requestableScopes: env.EVE_SCOPES.split(/\s+/).filter(Boolean),
  })
  assertInstalledResourceDeclarations()
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

  const reason = await Promise.race([
    shutdown.then(() => 'signal' as const),
    platform.stopped.then(() => 'run-loop-stopped' as const),
  ])
  if (reason === 'run-loop-stopped')
    console.error('Worker processing loop ended; shutting down this replica')
  await platform.close(env.WORKER_SHUTDOWN_TIMEOUT_MS)
  await sql.end({ timeout: 5 })
  if (reason === 'run-loop-stopped') process.exitCode = 1
}

try {
  await startWorker()
} catch (error) {
  console.error('Worker startup failed', error instanceof Error ? error.message : 'unknown error')
  await sql.end({ timeout: 1 })
  process.exitCode = 1
}
