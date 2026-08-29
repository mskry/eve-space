import type {
  PlatformAuthenticatedSessionRouteEnv,
  PlatformOwnedCharacterRouteEnv,
} from '@eve-space/platform-module-contract'
import { Hono } from 'hono'
import { platformModuleRouteComposers } from '../../src/platform/module-route-composition.js'

const authenticatedSessionRoute = new Hono<PlatformAuthenticatedSessionRouteEnv>()
const ownedCharacterRoute = new Hono<PlatformOwnedCharacterRouteEnv>()

platformModuleRouteComposers['authenticated-session']('test', authenticatedSessionRoute)
platformModuleRouteComposers['owned-character']('test', ownedCharacterRoute)

// @ts-expect-error authenticated-session routes cannot require owned-character context
platformModuleRouteComposers['authenticated-session']('test', ownedCharacterRoute)
// @ts-expect-error owned-character routes cannot receive only authenticated-session context
platformModuleRouteComposers['owned-character']('test', authenticatedSessionRoute)
