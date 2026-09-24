import { sql } from './db/client.js'
import { closeSharedCacheRedisConnection } from './cache-redis.js'
import { closeSharedCoordinationRedisConnection } from './coordination-redis.js'
import { assertCoreDataProductCatalogConfiguration } from './core-data/product-catalog.js'
import { assertCoreDataCoverageManifest } from './core-data/coverage-validation.js'
import { env, isSsoConfigured } from './env.js'
import {
  assertEsiCatalogConfiguration,
  coreEsiOperationIds,
} from './esi-gateway/catalog-interface.js'
import { closeProductionEsiExecutionRuntime } from './esi-gateway/runtime-lifecycle.js'
import { assertInstalledResourceDeclarations } from './platform/resource-declarations.js'
import { startWorkerPlatform } from './queue/platform.js'
import { markProcessShutdownFailed, waitForAbort } from './shutdown-deadline.js'
import { installShutdownSignalHandlers } from './shutdown-signals.js'
import { assertWorkerStartupDependencies } from './worker/readiness.js'
import { recordDiagnostic } from './logging.js'
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
    closeCacheRedis: closeSharedCacheRedisConnection,
    closeCoordinationRedis: closeSharedCoordinationRedisConnection,
    closeEsiRuntime: closeProductionEsiExecutionRuntime,
    closePostgres: (timeoutMs) => sql.end({ timeout: timeoutMs / 1000 }),
    getPlatform: () => platform,
    getStartupOperation: () => startupOperation,
    markFailed: markProcessShutdownFailed,
    recordFailure: (component, error) =>
      recordDiagnostic('worker.shutdown.failed', { context: { component }, error }),
    recordTimeout: () => recordDiagnostic('worker.shutdown.timed-out'),
    timeoutMs: env.WORKER_SHUTDOWN_TIMEOUT_MS,
  })
  const disposeSignals = installShutdownSignalHandlers(() => {
    startupController.abort()
    resolveSignal()
    void shutdown()
  })

  try {
    assertCoreDataProductCatalogConfiguration()
    assertCoreDataCoverageManifest({ esiOperationIds: coreEsiOperationIds })
    assertEsiCatalogConfiguration({
      compatibilityDate: env.ESI_COMPATIBILITY_DATE,
      requestableScopes: env.EVE_SCOPES.split(/\s+/).filter(Boolean),
      ssoEnabled: isSsoConfigured(),
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
    if (!platform) {
      throw new Error('Worker platform startup did not complete')
    }
    recordDiagnostic('worker.dependencies.verified')

    const reason = await Promise.race([
      signal.then(() => ({ type: 'signal' as const })),
      platform.stopped.then(
        () => ({ type: 'run-loop-stopped' as const }),
        (error: unknown) => ({ error, type: 'run-loop-failed' as const }),
      ),
    ])
    if (reason.type !== 'signal') {
      if (reason.type === 'run-loop-failed') {
        recordDiagnostic('worker.run-loop.failed', { error: reason.error })
      } else {
        recordDiagnostic('worker.processing-loop.stopped')
      }
      markProcessShutdownFailed()
    }
    await shutdown()
  } catch (error) {
    if (!startupController.signal.aborted) {
      recordDiagnostic('worker.startup.failed', { error })
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
    () => {},
    () => {},
  )
  setOperation(settled)
  try {
    await waitForAbort(operation, signal)
  } finally {
    setOperation(undefined)
  }
}

await startWorker()
