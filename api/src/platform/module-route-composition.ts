import type {
  PlatformAuthenticatedSessionRouteEnv,
  PlatformOwnedCharacterRouteEnv,
} from '@eve-space/platform-module-contract'
import { Hono, type Schema } from 'hono'
import { zValidator } from '../http/validation.js'
import { loadSession, requireSession } from '../middleware/auth-session.js'
import {
  exposeAuthenticatedSessionModuleContext,
  exposeOwnedCharacterModuleContext,
} from '../middleware/module-authorization.js'
import { requireInstalledModuleEnabled } from '../middleware/module-enablement.js'
import { characterIdParams, loadOwnedCharacter } from '../middleware/owned-character.js'

function composeAuthenticatedSessionModuleRoute<
  RouteSchema extends Schema,
  RouteBasePath extends string,
>(moduleId: string, route: Hono<PlatformAuthenticatedSessionRouteEnv, RouteSchema, RouteBasePath>) {
  return new Hono()
    .use('*', requireInstalledModuleEnabled(moduleId))
    .use('*', loadSession)
    .use('*', requireSession)
    .use('*', exposeAuthenticatedSessionModuleContext)
    .route('/', route)
}

function composeOwnedCharacterModuleRoute<RouteSchema extends Schema, RouteBasePath extends string>(
  moduleId: string,
  route: Hono<PlatformOwnedCharacterRouteEnv, RouteSchema, RouteBasePath>,
) {
  return new Hono()
    .use('*', requireInstalledModuleEnabled(moduleId))
    .use('*', loadSession)
    .use('*', requireSession)
    .use('*', zValidator('param', characterIdParams))
    .use('*', loadOwnedCharacter)
    .use('*', exposeOwnedCharacterModuleContext)
    .route('/', route)
}

export const platformModuleRouteComposers = {
  'authenticated-session': composeAuthenticatedSessionModuleRoute,
  'owned-character': composeOwnedCharacterModuleRoute,
} as const
