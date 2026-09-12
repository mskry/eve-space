import { createServer, type Server } from 'node:http'
import { serve } from '@hono/node-server'
import { createApiShutdownCoordinator } from './api-shutdown.js'
import { app } from './index.js'
import { closeSharedCacheRedisConnection } from './cache-redis.js'
import { closeSharedCoordinationRedisConnection } from './coordination-redis.js'
import { sql } from './db/client.js'
import { env, isSsoConfigured } from './env.js'
import { assertEsiCatalogConfiguration } from './esi-gateway/catalog-interface.js'
import { closeProductionEsiExecutionRuntime } from './esi-gateway/runtime-lifecycle.js'
import { assertInstalledResourceDeclarations } from './platform/resource-declarations.js'
import { apiLogger, logSafeError } from './logging.js'
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
    recordFailure: logSafeError,
    recordTimeout: () => apiLogger.error('API shutdown exceeded its timeout; forcing cleanup'),
    markFailed: markProcessShutdownFailed,
  })
  const dispose = () => {
    disposeSignals?.()
    server?.removeListener('error', handleServerError)
  }
  const handleServerError = (error: Error) => {
    logSafeError('API server failed', error)
    markProcessShutdownFailed()
    void shutdown().finally(dispose)
  }

  try {
    assertEsiCatalogConfiguration({
      compatibilityDate: env.ESI_COMPATIBILITY_DATE,
      ssoEnabled: isSsoConfigured(),
      requestableScopes: env.EVE_SCOPES.split(/\s+/).filter(Boolean),
    })
    assertInstalledResourceDeclarations()
    const startedServer = serve({ createServer, fetch: app.fetch, port: env.PORT }, (info) => {
      apiLogger.withMetadata({ port: info.port }).info('Hono API listening')
    }) as Server
    server = startedServer
    startedServer.on('error', handleServerError)
    disposeSignals = installShutdownSignalHandlers(() => {
      void shutdown().finally(dispose)
    })
  } catch (error) {
    logSafeError('API startup failed', error)
    markProcessShutdownFailed()
    await shutdown()
    dispose()
  }
}

await startApi()
