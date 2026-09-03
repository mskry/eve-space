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
} from './store.js'
import type { OAuthStateContext } from './store.js'
import { getCharacterAffiliation } from '../characters/profile.js'
import { env, isSsoConfigured } from '../env.js'
import { createAuthorizationUrl, exchangeAuthorizationCode, verifyAccessToken } from './sso.js'
import type { OwnedCharacterEnv } from '../middleware/owned-character.js'
import { characterIdParams, loadOwnedCharacter } from '../middleware/owned-character.js'
import { loadSession, sessionCookie } from '../middleware/auth-session.js'
import { createOpaqueToken, tokensMatch } from './security.js'
import { setPrivateHeaders } from '../http/private-response.js'
import { zValidator } from '../http/validation.js'

const oauthStateCookie = 'eve_space_oauth_state'
const sessionDurationSeconds = 7 * 24 * 60 * 60
type CharacterAuthorization = Omit<Parameters<typeof attachCharacter>[0], 'userId'>
const callbackQuery = z.object({
  code: z.string().min(1, 'EVE SSO returned an empty authorization code.').optional(),
  error: z.string().min(1, 'EVE SSO returned an empty error code.').optional(),
  state: z.string().min(1, 'EVE SSO returned an empty state.').optional(),
})
const reauthorizationQuery = z.object({
  returnTo: z
    .string()
    .min(1, 'Return destination must not be empty.')
    .max(512, 'Return destination must not exceed 512 characters.')
    .optional(),
})
const invalidReturnDestination = new HTTPException(400, {
  message: 'Return destination must be a safe route for this character.',
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
    async (context, next) => {
      assertUniqueQueryParameters(context.req.url)
      await next()
    },
    zValidator('query', reauthorizationQuery),
    async (context, next) => {
      const { returnTo } = context.req.valid('query')
      if (returnTo) {
        normalizeCharacterReturnPath(returnTo, context.req.valid('param').characterId)
      }
      await next()
    },
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const session = context.var.session
      const { returnTo } = context.req.valid('query')
      return startAuthorization(context, {
        intent: 'reauthorize',
        userId: session!.userId,
        characterId: context.var.ownedCharacter.characterId,
        ...(returnTo
          ? {
              returnPath: normalizeCharacterReturnPath(
                returnTo,
                context.var.ownedCharacter.characterId,
              ),
            }
          : {}),
      })
    },
  )
  .get('/eve/callback', zValidator('query', callbackQuery), async (context) => {
    const { error: authorizationError, code, state } = context.req.valid('query')
    const cookieState = getCookie(context, oauthStateCookie)
    const stateContext = await consumeValidOAuthState(state, cookieState)

    deleteCookie(context, oauthStateCookie, {
      path: '/auth/eve/callback',
      secure: env.SESSION_COOKIE_SECURE,
    })
    if (!stateContext) return redirectForIntent(context, { intent: 'login' }, 'error')
    if (authorizationError) return redirectForIntent(context, stateContext, 'cancelled')
    if (!code) return redirectForIntent(context, stateContext, 'error')

    if (!(await hasBoundSession(context, stateContext)))
      return redirectForIntent(context, stateContext, 'error')

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

      await saveAuthorizationForIntent(context, stateContext, authorization)

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

async function consumeValidOAuthState(state: string | undefined, cookieState: string | undefined) {
  if (!state || !tokensMatch(state, cookieState)) return null
  return consumeOAuthState(state)
}

async function hasBoundSession(context: Context, stateContext: OAuthStateContext) {
  if (stateContext.intent === 'login') return true

  const sessionToken = getCookie(context, sessionCookie)
  if (!sessionToken) return false

  const session = await findSession(sessionToken)
  return session?.userId === stateContext.userId
}

async function saveAuthorizationForIntent(
  context: Context,
  stateContext: OAuthStateContext,
  authorization: CharacterAuthorization,
) {
  switch (stateContext.intent) {
    case 'login': {
      const sessionToken = createOpaqueToken()
      await saveLogin({
        ...authorization,
        sessionToken,
        sessionExpiresAt: new Date(Date.now() + sessionDurationSeconds * 1000),
      })
      setCookie(context, sessionCookie, sessionToken, sessionCookieOptions(sessionDurationSeconds))
      return
    }
    case 'attach':
      await attachCharacter({ ...authorization, userId: stateContext.userId })
      return
    case 'reauthorize':
      await reauthorizeCharacter({
        ...authorization,
        userId: stateContext.userId,
        expectedCharacterId: stateContext.characterId,
      })
  }
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

  const stateDestination = new URL(
    state.intent === 'attach'
      ? '/characters'
      : (state.returnPath ?? `/characters/${state.characterId}`),
    env.WEB_ORIGIN,
  )
  const destination = new URL(
    `${stateDestination.pathname}${stateDestination.search}`,
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

function assertUniqueQueryParameters(url: string) {
  const names = new Set<string>()
  for (const name of new URL(url).searchParams.keys()) {
    if (names.has(name)) throw invalidReturnDestination
    names.add(name)
  }
}

function normalizeCharacterReturnPath(value: string, characterId: number) {
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('+')) {
    throw invalidReturnDestination
  }

  assertSafelyDecodedReturnPath(value)
  const destination = parseLocalReturnDestination(value)
  assertCharacterReturnDestination(destination, characterId)
  assertUniqueQueryParameters(destination.toString())

  const normalized = `${destination.pathname}${destination.search}`
  if (normalized.length > 512) throw invalidReturnDestination
  return normalized
}

function assertSafelyDecodedReturnPath(value: string) {
  let decoded = value
  for (let depth = 0; depth < 4; depth += 1) {
    assertSafeReturnPathLayer(decoded)
    if (!/%[\dA-Fa-f]{2}/.test(decoded)) break
    try {
      decoded = decodeURIComponent(decoded)
    } catch {
      throw invalidReturnDestination
    }
    if (depth === 3 && /%[\dA-Fa-f]{2}/.test(decoded)) throw invalidReturnDestination
  }
}

function parseLocalReturnDestination(value: string) {
  let destination: URL
  try {
    destination = new URL(value, 'https://application.local')
  } catch {
    throw invalidReturnDestination
  }

  if (destination.origin !== 'https://application.local') throw invalidReturnDestination
  return destination
}

function assertCharacterReturnDestination(destination: URL, characterId: number) {
  const characterRoot = `/characters/${characterId}`
  if (
    destination.pathname !== characterRoot &&
    !destination.pathname.startsWith(`${characterRoot}/`)
  ) {
    throw invalidReturnDestination
  }
}

function assertSafeReturnPathLayer(value: string) {
  if (
    [...value].some((character) => {
      const codePoint = character.codePointAt(0)!
      return /\s/u.test(character) || codePoint <= 31 || codePoint === 127
    }) ||
    /[\\#]/u.test(value) ||
    /%(?:2f|5c|23)/i.test(value) ||
    /%(?![\dA-Fa-f]{2})/.test(value)
  ) {
    throw invalidReturnDestination
  }

  const path = value.split('?', 1)[0]!
  if (path.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw invalidReturnDestination
  }
}
