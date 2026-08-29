import type {
  PlatformAuthenticatedSessionRouteEnv,
  PlatformOwnedCharacterRouteEnv,
} from '@eve-space/platform-module-contract'
import { createMiddleware } from 'hono/factory'
import { authRequiredBody } from '../http/contracts.js'
import { createOwnedCharacterCoreReads } from '../platform/core-read-capabilities.js'
import type { SessionEnv } from './auth-session.js'
import type { OwnedCharacterEnv } from './owned-character.js'

type AuthenticatedSessionModuleEnv = {
  Variables: SessionEnv['Variables'] & PlatformAuthenticatedSessionRouteEnv['Variables']
}

type OwnedCharacterModuleEnv = {
  Variables: OwnedCharacterEnv['Variables'] & PlatformOwnedCharacterRouteEnv['Variables']
}

export const exposeAuthenticatedSessionModuleContext =
  createMiddleware<AuthenticatedSessionModuleEnv>(async (context, next) => {
    const session = context.var.session
    if (!session) return context.json(authRequiredBody, 401)

    context.set('platform', {
      authorization: {
        strategy: 'authenticated-session',
        userId: session.userId,
      },
    })
    await next()
  })

export const exposeOwnedCharacterModuleContext = createMiddleware<OwnedCharacterModuleEnv>(
  async (context, next) => {
    const session = context.var.session
    if (!session) return context.json(authRequiredBody, 401)

    const { characterId, subjectLifecycleId } = context.var.ownedCharacter
    context.set('platform', {
      authorization: {
        strategy: 'owned-character',
        userId: session.userId,
        characterId,
        subjectLifecycleId,
      },
      coreReads: createOwnedCharacterCoreReads({
        userId: session.userId,
        characterId,
        subjectLifecycleId,
      }),
    })
    await next()
  },
)
