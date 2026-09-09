import { serve } from '@hono/node-server'
import { app } from './index.js'
import { sql } from './db/client.js'
import { env, isSsoConfigured } from './env.js'
import { closeSharedCacheRedisConnection } from './esi-resilience/cache-redis.js'
import { assertEsiOperationCatalogConfiguration } from './esi-resilience/catalog-access.js'
import { assertInstalledResourceDeclarations } from './platform/resource-declarations.js'
import { apiLogger } from './logging.js'

assertEsiOperationCatalogConfiguration({
  compatibilityDate: env.ESI_COMPATIBILITY_DATE,
  ssoEnabled: isSsoConfigured(),
  requestableScopes: env.EVE_SCOPES.split(/\s+/).filter(Boolean),
})
assertInstalledResourceDeclarations()

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  apiLogger.withMetadata({ port: info.port }).info('Hono API listening')
})

async function shutdown() {
  server.close()
  await closeSharedCacheRedisConnection()
  await sql.end({ timeout: 5 })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
