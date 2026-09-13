import { createServer, type Server } from 'node:http'
import { serve } from '@hono/node-server'
import { createApiShutdownCoordinator } from './api-shutdown.js'
import { app } from './index.js'
import { closeSharedCacheRedisConnection } from './cache-redis.js'
import { closeSharedCoordinationRedisConnection } from './coordination-redis.js'
import { assertCoreDataProductCatalogConfiguration } from './core-data/product-catalog.js'
import { assertCoreDataCoverageManifest } from './core-data/coverage-validation.js'
import { sql } from './db/client.js'
import { env, isSsoConfigured } from './env.js'
import {
  assertEsiCatalogConfiguration,
  coreEsiOperationIds,
} from './esi-gateway/catalog-interface.js'
import { closeProductionEsiExecutionRuntime } from './esi-gateway/runtime-lifecycle.js'
import { assertInstalledResourceDeclarations } from './platform/resource-declarations.js'
import { recordDiagnostic } from './logging.js'
import { markProcessShutdownFailed } from './shutdown-deadline.js'
import { installShutdownSignalHandlers } from './shutdown-signals.js'

export async function startApi() {
  let server: Server | undefined
  let disposeSignals: (() => void) | undefined
  const shutdown = createApiShutdownCoordinator({
    timeoutMs: env.API_SHUTDOWN_TIMEOUT_MS,
    getServer: () => server,
    closeEsiRuntime: closeProductionEsiExecutionRuntime,
    closeCacheRedis: closeSharedCacheRedisConnection,
    closeCoordinationRedis: closeSharedCoordinationRedisConnection,
    closePostgres: (timeoutMs) => sql.end({ timeout: timeoutMs / 1_000 }),
    recordFailure: (component, error) =>
      recordDiagnostic('api.shutdown.failed', { context: { component }, error }),
    recordTimeout: () => recordDiagnostic('api.shutdown.timed-out'),
    markFailed: markProcessShutdownFailed,
  })
  const dispose = () => {
    disposeSignals?.()
    server?.removeListener('error', handleServerError)
  }
  const handleServerError = (error: Error) => {
    recordDiagnostic('api.server.failed', { error })
    markProcessShutdownFailed()
    void shutdown().finally(dispose)
  }

  try {
    assertCoreDataProductCatalogConfiguration()
    assertCoreDataCoverageManifest({ esiOperationIds: coreEsiOperationIds })
    assertEsiCatalogConfiguration({
      compatibilityDate: env.ESI_COMPATIBILITY_DATE,
      ssoEnabled: isSsoConfigured(),
      requestableScopes: env.EVE_SCOPES.split(/\s+/).filter(Boolean),
    })
    assertInstalledResourceDeclarations()
    const startedServer = serve({ createServer, fetch: app.fetch, port: env.PORT }, (info) => {
      recordDiagnostic('api.runtime.started', { context: { port: info.port } })
    }) as Server
    server = startedServer
    startedServer.on('error', handleServerError)
    disposeSignals = installShutdownSignalHandlers(() => {
      void shutdown().finally(dispose)
    })
  } catch (error) {
    recordDiagnostic('api.startup.failed', { error })
    markProcessShutdownFailed()
    await shutdown()
    dispose()
  }
}

await startApi()
