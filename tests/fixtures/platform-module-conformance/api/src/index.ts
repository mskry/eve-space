import type { PlatformModuleRouteCapabilities } from '@eve-space/platform-module-contract'
import { Hono } from 'hono'
import { conformanceRoutes } from '../../features/conformance/server/src/routes.js'

function createFixtureApi(capabilities: PlatformModuleRouteCapabilities<unknown>) {
  return new Hono().route(
    '/api/modules/conformance/characters/:characterId',
    conformanceRoutes(capabilities),
  )
}

export type AppType = ReturnType<typeof createFixtureApi>
