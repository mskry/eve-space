import type {
  PlatformAuthenticatedSessionRouteEnv,
  PlatformOwnedCharacterRouteEnv,
} from '@eve-space/platform-module-contract'
import type { InferResponseType } from 'hono/client'
import { hc } from 'hono/client'
import { Hono } from 'hono'
import { platformModuleRouteComposers } from '../../src/platform/module-route-composition.js'

const authenticatedSessionRoute = new Hono<PlatformAuthenticatedSessionRouteEnv>().get(
  '/status',
  (context) => context.json({ status: 'ok' as const }),
)
const ownedCharacterRoute = new Hono<PlatformOwnedCharacterRouteEnv>().get(
  '/character',
  (context) => context.json({ characterId: context.var.platform.authorization.characterId }),
)
const organization = { audience: 'member', requiredPermission: 'test.view' } as const

const composedAuthenticatedRoute = platformModuleRouteComposers['authenticated-session'](
  'test',
  organization,
  authenticatedSessionRoute,
)
const composedOwnedCharacterRoute = platformModuleRouteComposers['owned-character'](
  'test',
  organization,
  ownedCharacterRoute,
)
const authenticatedClient = hc<typeof composedAuthenticatedRoute>('http://localhost')
const ownedCharacterClient = hc<typeof composedOwnedCharacterRoute>('http://localhost')
type AuthenticatedStatus = InferResponseType<typeof authenticatedClient.status.$get, 200>
type OwnedCharacter = InferResponseType<typeof ownedCharacterClient.character.$get, 200>
const authenticatedStatus: AuthenticatedStatus = { status: 'ok' }
const ownedCharacter: OwnedCharacter = { characterId: 9001 }
// @ts-expect-error the composed authenticated response must retain its literal status
const invalidAuthenticatedStatus: AuthenticatedStatus = { status: 'not-ok' }
// @ts-expect-error the composed owned-character response must retain its numeric identity
const invalidOwnedCharacter: OwnedCharacter = { characterId: '9001' }
void authenticatedStatus
void ownedCharacter
void invalidAuthenticatedStatus
void invalidOwnedCharacter

// @ts-expect-error authenticated-session routes cannot require owned-character context
platformModuleRouteComposers['authenticated-session']('test', organization, ownedCharacterRoute)
// @ts-expect-error owned-character routes cannot receive only authenticated-session context
platformModuleRouteComposers['owned-character']('test', organization, authenticatedSessionRoute)
