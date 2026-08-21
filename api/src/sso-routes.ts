import { Hono } from 'hono'
import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import {
  attachCharacter,
  CharacterOwnershipConflictError,
  consumeOAuthState,
  deleteSession,
  findSession,
  reauthorizeCharacter,
  saveLogin,
  storeOAuthState,
} from './auth-store.js'
import type { OAuthStateContext } from './auth-store.js'
import { getCharacterAffiliation } from './character-profile.js'
import { env, isSsoConfigured } from './env.js'
import { createAuthorizationUrl, exchangeAuthorizationCode, verifyAccessToken } from './eve-sso.js'
import type { OwnedCharacterEnv } from './middleware/owned-character.js'
import { characterIdParams, loadOwnedCharacter } from './middleware/owned-character.js'
import { loadSession, sessionCookie } from './middleware/auth-session.js'
import { createOpaqueToken, tokensMatch } from './security.js'
import { zValidator } from './validation.js'

const oauthStateCookie = 'eve_space_oauth_state'
const sessionDurationSeconds = 7 * 24 * 60 * 60
const callbackQuery = z.object({
  code: z.string().min(1, 'EVE SSO returned an empty authorization code.').optional(),
  error: z.string().min(1, 'EVE SSO returned an empty error code.').optional(),
  state: z.string().min(1, 'EVE SSO returned an empty state.').optional(),
})

export const ssoRoutes = new Hono<OwnedCharacterEnv>()
  .get('/config', (context) =>
    context.json({
      configured: isSsoConfigured(),
      loginUrl: new URL('/auth/eve/start', env.EVE_CALLBACK_URL).toString(),
      attachUrl: new URL('/auth/eve/attach', env.EVE_CALLBACK_URL).toString(),
    }),
  )
  .get('/eve/start', async (context) => startAuthorization(context, { intent: 'login' }))
  .get('/eve/attach', loadSession, async (context) => {
    const session = context.var.session
    setPrivateHeaders(context)
    if (!session)
      return context.json({ code: 'AUTH_REQUIRED', message: 'Log in with EVE Online first.' }, 401)
    return startAuthorization(context, { intent: 'attach', userId: session.userId })
  })
  .get(
    '/eve/reauthorize/:characterId',
    zValidator('param', characterIdParams),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const session = context.var.session
      return startAuthorization(context, {
        intent: 'reauthorize',
        userId: session!.userId,
        characterId: context.var.ownedCharacter.characterId,
      })
    },
  )
  .get('/eve/callback', zValidator('query', callbackQuery), async (context) => {
    const { error: authorizationError, code, state } = context.req.valid('query')
    const cookieState = getCookie(context, oauthStateCookie)
    const stateContext =
      state && tokensMatch(state, cookieState) ? await consumeOAuthState(state) : null

    deleteCookie(context, oauthStateCookie, {
      path: '/auth/eve/callback',
      secure: env.SESSION_COOKIE_SECURE,
    })
    if (!stateContext) return redirectForIntent(context, { intent: 'login' }, 'error')
    if (authorizationError) return redirectForIntent(context, stateContext, 'cancelled')
    if (!code) return redirectForIntent(context, stateContext, 'error')

    let boundSession: Awaited<ReturnType<typeof findSession>> = null
    if (stateContext.intent !== 'login') {
      const sessionToken = getCookie(context, sessionCookie)
      boundSession = sessionToken ? await findSession(sessionToken) : null
      if (!boundSession || boundSession.userId !== stateContext.userId)
        return redirectForIntent(context, stateContext, 'error')
    }

    try {
      const tokens = await exchangeAuthorizationCode(code)
      const identity = await verifyAccessToken(tokens.access_token)
      if (
        stateContext.intent === 'reauthorize' &&
        identity.characterId !== stateContext.characterId
      ) {
        return redirectForIntent(context, stateContext, 'error')
      }
      const affiliation = await getCharacterAffiliation(identity.characterId)
      const authorization = {
        ...identity,
        ...affiliation,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
      }

      if (stateContext.intent === 'login') {
        const sessionToken = createOpaqueToken()
        await saveLogin({
          ...authorization,
          sessionToken,
          sessionExpiresAt: new Date(Date.now() + sessionDurationSeconds * 1000),
        })
        setCookie(
          context,
          sessionCookie,
          sessionToken,
          sessionCookieOptions(sessionDurationSeconds),
        )
      } else if (stateContext.intent === 'attach') {
        await attachCharacter({ ...authorization, userId: stateContext.userId })
      } else {
        await reauthorizeCharacter({
          ...authorization,
          userId: stateContext.userId,
          expectedCharacterId: stateContext.characterId,
        })
      }

      return redirectForIntent(context, stateContext, 'success', identity.characterId)
    } catch (error) {
      if (error instanceof CharacterOwnershipConflictError)
        return redirectForIntent(context, stateContext, 'conflict')
      console.error(
        'EVE SSO callback failed',
        error instanceof Error ? error.message : 'Unknown error',
      )
      return redirectForIntent(context, stateContext, 'error')
    }
  })
  .get('/session', async (context) => {
    setPrivateHeaders(context)
    const sessionToken = getCookie(context, sessionCookie)
    if (!sessionToken) return context.json({ authenticated: false as const })

    const session = await findSession(sessionToken)
    if (!session) {
      deleteCookie(context, sessionCookie, { path: '/', secure: env.SESSION_COOKIE_SECURE })
      return context.json({ authenticated: false as const })
    }
    return context.json({ authenticated: true as const, account: session })
  })
  .post('/logout', async (context) => {
    setPrivateHeaders(context)
    const sessionToken = getCookie(context, sessionCookie)
    if (sessionToken) await deleteSession(sessionToken)
    deleteCookie(context, sessionCookie, { path: '/', secure: env.SESSION_COOKIE_SECURE })
    return context.body(null, 204)
  })

async function startAuthorization(context: Context, stateContext: OAuthStateContext) {
  if (!isSsoConfigured()) {
    throw new HTTPException(503, { message: 'EVE SSO credentials have not been configured.' })
  }

  const state = createOpaqueToken()
  await storeOAuthState(state, stateContext)
  setCookie(context, oauthStateCookie, state, {
    path: '/auth/eve/callback',
    httpOnly: true,
    secure: env.SESSION_COOKIE_SECURE,
    sameSite: 'Lax',
    priority: 'High',
    maxAge: 10 * 60,
  })
  return context.redirect((await createAuthorizationUrl(state)).toString())
}

function redirectForIntent(
  context: Context,
  state: OAuthStateContext,
  status: 'success' | 'cancelled' | 'conflict' | 'error',
  characterId?: number,
) {
  if (state.intent === 'login') {
    const destination = new URL('/auth', env.WEB_ORIGIN)
    destination.searchParams.set('auth', status === 'conflict' ? 'error' : status)
    if (status === 'success' && characterId)
      destination.searchParams.set('character', String(characterId))
    return context.redirect(destination.toString())
  }

  const destination = new URL(
    state.intent === 'attach' ? '/characters' : `/characters/${state.characterId}`,
    env.WEB_ORIGIN,
  )
  destination.searchParams.set(state.intent === 'attach' ? 'attach' : 'reauthorize', status)
  if (state.intent === 'attach' && status === 'success' && characterId)
    destination.searchParams.set('character', String(characterId))
  return context.redirect(destination.toString())
}

function sessionCookieOptions(maxAge: number) {
  return {
    path: '/',
    httpOnly: true,
    secure: env.SESSION_COOKIE_SECURE,
    sameSite: 'Lax' as const,
    priority: 'High' as const,
    maxAge,
  }
}

function setPrivateHeaders(context: Context) {
  context.header('Cache-Control', 'private, no-store')
  context.header('Vary', 'Cookie')
}
