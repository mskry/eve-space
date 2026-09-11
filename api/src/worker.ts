import { sql } from './db/client.js'
import { env, isSsoConfigured } from './env.js'
import { closeSharedCacheRedisConnection } from './esi-resilience/cache-redis.js'
import { assertEsiOperationCatalogConfiguration } from './esi-resilience/catalog-access.js'
import { closeSharedCoordinationRedisConnection } from './esi-resilience/coordination-connection.js'
import { assertInstalledResourceDeclarations } from './platform/resource-declarations.js'
import { startWorkerPlatform } from './queue/platform.js'
import { markProcessShutdownFailed, waitForAbort } from './shutdown-deadline.js'
import { installShutdownSignalHandlers } from './shutdown-signals.js'
import { assertWorkerStartupDependencies } from './worker/readiness.js'
import { apiLogger, logSafeError } from './logging.js'
import type { WorkerPlatform } from './worker-platform.js'
import { createWorkerShutdownCoordinator } from './worker-shutdown.js'

export async function startWorker() {
  const startupController = new AbortController()
  let startupOperation: Promise<void> | undefined
  let platform: WorkerPlatform | undefined
  let resolveSignal!: () => void
  const signal = new Promise<void>((resolve) => {
    resolveSignal = resolve
  })
  const shutdown = createWorkerShutdownCoordinator({
    timeoutMs: env.WORKER_SHUTDOWN_TIMEOUT_MS,
    getStartupOperation: () => startupOperation,
    getPlatform: () => platform,
    closeCacheRedis: closeSharedCacheRedisConnection,
    closeCoordinationRedis: closeSharedCoordinationRedisConnection,
    closePostgres: (timeoutMs) => sql.end({ timeout: timeoutMs / 1_000 }),
    recordFailure: logSafeError,
    recordTimeout: () => apiLogger.error('Worker shutdown exceeded its timeout; forcing cleanup'),
    markFailed: markProcessShutdownFailed,
  })
  const disposeSignals = installShutdownSignalHandlers(() => {
    startupController.abort()
    resolveSignal()
    void shutdown()
  })

  try {
    assertEsiOperationCatalogConfiguration({
      compatibilityDate: env.ESI_COMPATIBILITY_DATE,
      ssoEnabled: isSsoConfigured(),
      requestableScopes: env.EVE_SCOPES.split(/\s+/).filter(Boolean),
    })
    assertInstalledResourceDeclarations()
    await runStartupOperation(
      assertWorkerStartupDependencies(),
      startupController.signal,
      (value) => {
        startupOperation = value
      },
    )
    const startingPlatform = startWorkerPlatform(startupController.signal).then((started) => {
      platform = started
    })
    await runStartupOperation(startingPlatform, startupController.signal, (value) => {
      startupOperation = value
    })
    if (!platform) throw new Error('Worker platform startup did not complete')
    apiLogger.info('Worker dependencies verified')

    const reason = await Promise.race([
      signal.then(() => 'signal' as const),
      platform.stopped.then(() => 'run-loop-stopped' as const),
    ])
    if (reason === 'run-loop-stopped') {
      apiLogger.error('Worker processing loop ended; shutting down this replica')
      markProcessShutdownFailed()
    }
    await shutdown()
  } catch (error) {
    if (!startupController.signal.aborted) {
      logSafeError('Worker startup failed', error)
      markProcessShutdownFailed()
    }
    await shutdown()
  } finally {
    disposeSignals()
  }
}

async function runStartupOperation(
  operation: Promise<unknown>,
  signal: AbortSignal,
  setOperation: (operation: Promise<void> | undefined) => void,
) {
  const settled = operation.then(
    () => undefined,
    () => undefined,
  )
  setOperation(settled)
  try {
    await waitForAbort(operation, signal)
  } finally {
    setOperation(undefined)
  }
}

await startWorker()
