import type {
  PlatformAuthenticatedSessionRouteEnv,
  PlatformOrganizationContributionAuthorization,
  PlatformOwnedCharacterRouteEnv,
} from '@eve-space/platform-module-contract'
import { Hono, type Schema } from 'hono'
import { privateNoStore } from '../http/private-response.js'
import { zValidator } from '../http/validation.js'
import { loadSession, requireSession } from '../middleware/auth-session.js'
import {
  exposeAuthenticatedSessionModuleContext,
  exposeOwnedCharacterModuleContext,
  requireModuleOrganizationAuthorization,
} from '../middleware/module-authorization.js'
import { requireInstalledModuleEnabled } from '../middleware/module-enablement.js'
import { loadOrganizationSession } from '../middleware/organization-session.js'
import { characterIdParams, loadOwnedCharacter } from '../middleware/owned-character.js'

function composeAuthenticatedSessionModuleRoute<
  RouteSchema extends Schema,
  RouteBasePath extends string,
>(
  moduleId: string,
  organization: PlatformOrganizationContributionAuthorization,
  route: Hono<PlatformAuthenticatedSessionRouteEnv, RouteSchema, RouteBasePath>,
) {
  return new Hono()
    .use('*', requireInstalledModuleEnabled(moduleId))
    .use('*', privateNoStore)
    .use('*', loadSession)
    .use('*', requireSession)
    .use('*', loadOrganizationSession)
    .use('*', requireModuleOrganizationAuthorization(organization))
    .use('*', exposeAuthenticatedSessionModuleContext(moduleId))
    .route('/', route)
}

function composeOwnedCharacterModuleRoute<RouteSchema extends Schema, RouteBasePath extends string>(
  moduleId: string,
  organization: PlatformOrganizationContributionAuthorization,
  route: Hono<PlatformOwnedCharacterRouteEnv, RouteSchema, RouteBasePath>,
) {
  return new Hono()
    .use('*', requireInstalledModuleEnabled(moduleId))
    .use('*', privateNoStore)
    .use('*', loadSession)
    .use('*', requireSession)
    .use('*', loadOrganizationSession)
    .use('*', requireModuleOrganizationAuthorization(organization))
    .use('*', zValidator('param', characterIdParams))
    .use('*', loadOwnedCharacter)
    .use('*', exposeOwnedCharacterModuleContext(moduleId))
    .route('/', route)
}

export const platformModuleRouteComposers = {
  'authenticated-session': composeAuthenticatedSessionModuleRoute,
  'owned-character': composeOwnedCharacterModuleRoute,
} as const
