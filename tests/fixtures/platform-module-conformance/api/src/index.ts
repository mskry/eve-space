import { Hono } from 'hono'
import { conformanceRoutes } from '../../features/conformance/server/src/routes.js'

function createFixtureApi(capabilities: Parameters<typeof conformanceRoutes>[0]) {
  return new Hono().route(
    '/api/modules/conformance/characters/:characterId',
    conformanceRoutes(capabilities),
  )
}

export type AppType = ReturnType<typeof createFixtureApi>
