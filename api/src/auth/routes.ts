import { Hono } from 'hono'
import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import {
  attachCharacter,
  CharacterTransferApprovalRequiredError,
  reauthorizeCharacter,
  saveLogin,
} from './character-lifecycle.js'
import { consumeOAuthState, storeOAuthState, type OAuthStateContext } from './oauth-state-store.js'
import { deleteSession, findSession } from './session-store.js'
import { getCharacterAffiliation } from '../characters/profile.js'
import { observeCharacterAffiliation } from '../characters/affiliation-sync.js'
import { env, isSsoConfigured } from '../env.js'
import { createAuthorizationUrl, exchangeAuthorizationCode, verifyAccessToken } from './sso.js'
import type { OwnedCharacterEnv } from '../middleware/owned-character.js'
import { characterIdParams, loadOwnedCharacter } from '../middleware/owned-character.js'
import { loadSession, sessionCookie } from '../middleware/auth-session.js'
import { createOpaqueToken, tokensMatch } from './security.js'
import { authRequiredBody, routeNotFoundBody } from '../http/contracts.js'
import { privateNoStore, setPrivateHeaders } from '../http/private-response.js'
import { requireTrustedMutationOrigin } from '../http/trusted-origin.js'
import { zValidator } from '../http/validation.js'
import { logSafeError } from '../logging.js'
import { loadCurrentOrganizationIdentity } from '../organization/context.js'
import { resolveOrganizationAuthorityCorporation } from '../organization/authority.js'
import {
  assertOrganizationOwnerDirectorRole,
  assertOrganizationOwnerScope,
  OrganizationAuthorityError,
} from '../organization/authority-policy.js'
import {
  characterCorporationRolesScope,
  getCharacterCorporationRoles,
} from '../characters/corporation-roles.js'
import {
  claimOrganizationOwnership,
  OrganizationOwnerClaimError,
} from '../organization/owner-claim.js'
import { loadTransferApprovalForStart } from './character-transfer-approvals.js'
import { CharacterTransferError, transferCharacter } from './character-transfer.js'

const oauthStateCookie = 'eve_space_oauth_state'
const sessionDurationSeconds = 7 * 24 * 60 * 60
const maxReturnPathDecodeDepth = 4
type CharacterAuthorization = Omit<Parameters<typeof attachCharacter>[0], 'userId'>
const callbackQuery = z.object({
  code: z.string().min(1, 'EVE SSO returned an empty authorization code.').optional(),
  error: z.string().min(1, 'EVE SSO returned an empty error code.').optional(),
  state: z.string().min(1, 'EVE SSO returned an empty state.').optional(),
})
const returnDestinationQuery = z.object({
  returnTo: z
    .string()
    .min(1, 'Return destination must not be empty.')
    .max(512, 'Return destination must not exceed 512 characters.')
    .optional(),
})
const localFixtureSessionForm = z.object({
  sessionToken: z.string().min(32).max(200),
})
const transferStartBody = z
  .object({
    approvalId: z.uuid('Transfer approval is invalid.'),
    secret: z.string().min(32, 'Transfer approval is invalid.').max(200),
  })
  .strict()
const invalidReturnDestination = new HTTPException(400, {
  message: 'Return destination must be a safe application route.',
})

export const ssoRoutes = new Hono<OwnedCharacterEnv>()
  .get('/config', (context) =>
    context.json({
      configured: isSsoConfigured(),
      loginUrl: new URL('/auth/eve/start', env.EVE_CALLBACK_URL).toString(),
      attachUrl: new URL('/auth/eve/attach', env.EVE_CALLBACK_URL).toString(),
    }),
  )
  .get(
    '/eve/start',
    async (context, next) => {
      assertUniqueQueryParameters(context.req.url)
      await next()
    },
    zValidator('query', returnDestinationQuery),
    loadSession,
    async (context) => {
      const { returnTo } = context.req.valid('query')
      const session = context.var.session
      if (session) {
        setPrivateHeaders(context)
        return startAuthorization(context, { intent: 'attach', userId: session.userId })
      }
      return startAuthorization(context, {
        intent: 'login',
        ...(returnTo ? { returnPath: normalizeLoginReturnPath(returnTo) } : {}),
      })
    },
  )
  .get('/eve/attach', loadSession, async (context) => {
    const session = context.var.session
    setPrivateHeaders(context)
    if (!session)
      return context.json({ code: 'AUTH_REQUIRED', message: 'Log in with EVE Online first.' }, 401)
    return startAuthorization(context, { intent: 'attach', userId: session.userId })
  })
  .post(
    '/eve/transfer',
    privateNoStore,
    requireTrustedMutationOrigin,
    loadSession,
    async (context, next) => {
      if (!context.var.session) return context.json(authRequiredBody, 401)
      await next()
    },
    zValidator('json', transferStartBody),
    async (context) => {
      const binding = await loadTransferApprovalForStart({
        ...context.req.valid('json'),
        destinationUserId: context.var.session!.userId,
      })
      if (!binding)
        return context.json(
          {
            code: 'TRANSFER_APPROVAL_UNUSABLE',
            message: 'Transfer approval is no longer usable.',
          },
          409,
        )
      const { authorizationUrl } = await prepareAuthorization(context, {
        intent: 'transfer',
        ...binding,
      })
      return context.json({ authorizationUrl: authorizationUrl.toString() }, 200)
    },
  )
  .get(
    '/eve/claim-organization-owner/:characterId',
    zValidator('param', characterIdParams),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      setPrivateHeaders(context)
      const organization = await loadCurrentOrganizationIdentity()
      return startAuthorization(context, {
        intent: 'claim-organization-owner',
        userId: context.var.session!.userId,
        characterId: context.var.ownedCharacter.characterId,
        organizationId: organization.organizationId,
        organizationVersion: organization.organizationVersion,
      })
    },
  )
  .get(
    '/eve/reauthorize/:characterId',
    zValidator('param', characterIdParams),
    async (context, next) => {
      assertUniqueQueryParameters(context.req.url)
      await next()
    },
    zValidator('query', returnDestinationQuery),
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
      return redirectForIntent(
        context,
        stateContext,
        stateContext.intent === 'transfer' ? 'approval-unusable' : 'error',
      )

    try {
      const tokens = await exchangeAuthorizationCode(code, context.req.raw.signal)
      const identity = await verifyAccessToken(tokens.access_token, context.req.raw.signal)
      if (
        (stateContext.intent === 'reauthorize' ||
          stateContext.intent === 'claim-organization-owner' ||
          stateContext.intent === 'transfer') &&
        identity.characterId !== stateContext.characterId
      ) {
        return redirectForIntent(
          context,
          stateContext,
          stateContext.intent === 'transfer' ? 'approval-unusable' : 'error',
        )
      }
      const affiliation =
        stateContext.intent === 'claim-organization-owner'
          ? await observeCharacterAffiliation(identity.characterId)
          : await getCharacterAffiliation(identity.characterId)
      if (!affiliation) throw new OrganizationAuthorityError('stale-affiliation')
      if (stateContext.intent === 'claim-organization-owner' && affiliation.stale)
        throw new OrganizationAuthorityError('stale-affiliation')
      const authorization = {
        ...identity,
        corporationId: affiliation.corporationId,
        allianceId: affiliation.allianceId,
        affiliationCheckedAt: affiliation.affiliationCheckedAt,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
      }

      await saveAuthorizationForIntent(context, stateContext, authorization)

      return redirectForIntent(context, stateContext, 'success', identity.characterId)
    } catch (error) {
      return redirectForCallbackError(context, stateContext, error)
    }
  })
  .post(
    '/local-fixture-session',
    async (context, next) => {
      setPrivateHeaders(context)
      if (env.NODE_ENV !== 'development') return context.json(routeNotFoundBody, 404)
      await next()
    },
    zValidator('form', localFixtureSessionForm),
    async (context) => {
      const { sessionToken } = context.req.valid('form')
      if (!(await findSession(sessionToken))) return context.json(authRequiredBody, 401)
      setCookie(context, sessionCookie, sessionToken, sessionCookieOptions(sessionDurationSeconds))
      return context.redirect(new URL('/', env.WEB_ORIGIN).toString(), 303)
    },
  )
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

function redirectForCallbackError(
  context: Context,
  stateContext: OAuthStateContext,
  error: unknown,
) {
  if (stateContext.intent === 'attach' && error instanceof CharacterTransferApprovalRequiredError)
    return redirectForIntent(context, stateContext, 'approval-required')
  if (stateContext.intent === 'transfer' && error instanceof CharacterTransferError)
    return redirectForIntent(context, stateContext, error.code)
  logSafeError('EVE SSO callback failed', error)
  return redirectForIntent(context, stateContext, 'error')
}

async function startAuthorization(context: Context, stateContext: OAuthStateContext) {
  const { authorizationUrl } = await prepareAuthorization(context, stateContext)
  return context.redirect(authorizationUrl.toString())
}

async function prepareAuthorization(context: Context, stateContext: OAuthStateContext) {
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
  return { authorizationUrl: await createAuthorizationUrl(state, context.req.raw.signal) }
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
      await attachCharacter({
        ...authorization,
        userId: stateContext.userId,
        sessionToken: getCookie(context, sessionCookie)!,
      })
      return
    case 'reauthorize':
      await reauthorizeCharacter({
        ...authorization,
        userId: stateContext.userId,
        expectedCharacterId: stateContext.characterId,
        sessionToken: getCookie(context, sessionCookie)!,
      })
      return
    case 'claim-organization-owner':
      await saveOrganizationOwnerClaim(
        stateContext,
        authorization,
        getCookie(context, sessionCookie)!,
      )
      return
    case 'transfer':
      await transferCharacter({
        approvalId: stateContext.approvalId,
        sourceUserId: stateContext.sourceUserId,
        sourceSubjectLifecycleId: stateContext.sourceSubjectLifecycleId,
        destinationUserId: stateContext.userId,
        characterId: stateContext.characterId,
        destinationSessionToken: getCookie(context, sessionCookie)!,
        authorization,
      })
      return
  }
}

async function saveOrganizationOwnerClaim(
  state: Extract<OAuthStateContext, { intent: 'claim-organization-owner' }>,
  authorization: CharacterAuthorization,
  sessionToken: string,
) {
  const organization = await loadCurrentOrganizationIdentity()
  if (
    organization.organizationId !== state.organizationId ||
    organization.organizationVersion !== state.organizationVersion
  )
    throw new OrganizationOwnerClaimError('stale-organization')

  assertOrganizationOwnerScope(characterCorporationRolesScope, authorization.scopes)
  const authorityCorporationId = await resolveOrganizationAuthorityCorporation(
    organization,
    authorization,
  )
  const { affiliationCheckedAt, subjectLifecycleId } = await reauthorizeCharacter({
    ...authorization,
    userId: state.userId,
    expectedCharacterId: state.characterId,
    sessionToken,
  })
  const roles = await getCharacterCorporationRoles(state.characterId, subjectLifecycleId)
  assertOrganizationOwnerDirectorRole(roles)
  await claimOrganizationOwnership({
    userId: state.userId,
    characterId: state.characterId,
    subjectLifecycleId,
    organizationId: state.organizationId,
    organizationVersion: state.organizationVersion,
    authorityCorporationId,
    observedCorporationId: authorization.corporationId,
    observedAllianceId: authorization.allianceId,
    affiliationCheckedAt,
    requiredScope: characterCorporationRolesScope,
  })
}

function redirectForIntent(
  context: Context,
  state: OAuthStateContext,
  status:
    | 'success'
    | 'cancelled'
    | 'approval-required'
    | 'approval-unusable'
    | 'main-character'
    | 'authority-evidence'
    | 'corporation-source'
    | 'error',
  characterId?: number,
) {
  if (state.intent === 'login') {
    const destination = new URL('/auth', env.WEB_ORIGIN)
    destination.searchParams.set(
      'auth',
      status === 'success' || status === 'cancelled' ? status : 'error',
    )
    if (status === 'success' && characterId)
      destination.searchParams.set('character', String(characterId))
    if (state.returnPath) destination.searchParams.set('redirect', state.returnPath)
    return context.redirect(destination.toString())
  }

  if (state.intent === 'claim-organization-owner') {
    const destination = new URL('/settings/integrations', env.WEB_ORIGIN)
    destination.searchParams.set(
      'organizationOwner',
      status === 'success' || status === 'cancelled' ? status : 'error',
    )
    return context.redirect(destination.toString())
  }

  const stateDestination = new URL(
    state.intent === 'attach' || state.intent === 'transfer'
      ? '/characters'
      : (state.returnPath ?? `/characters/${state.characterId}`),
    env.WEB_ORIGIN,
  )
  const destination = new URL(
    `${stateDestination.pathname}${stateDestination.search}`,
    env.WEB_ORIGIN,
  )
  destination.searchParams.set(
    state.intent === 'attach' || state.intent === 'transfer' ? 'attach' : 'reauthorize',
    status,
  )
  if (
    (state.intent === 'attach' || state.intent === 'transfer') &&
    status === 'success' &&
    characterId
  )
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

  assertReturnPathLayers(value, checkSafeReturnPathLayer)
  const destination = parseLocalReturnDestination(value)
  assertCharacterReturnDestination(destination, characterId)
  assertUniqueQueryParameters(destination.toString())

  const normalized = `${destination.pathname}${destination.search}`
  if (normalized.length > 512) throw invalidReturnDestination
  return normalized
}

function normalizeLoginReturnPath(value: string) {
  if (!value.startsWith('/') || value.startsWith('//')) throw invalidReturnDestination

  const destination = parseLocalReturnDestination(value)
  assertReturnPathLayers(value, checkNonAuthorizationLayer)
  assertUniqueQueryParameters(destination.toString())

  const normalized = `${destination.pathname}${destination.search}${destination.hash}`
  if (normalized.length > 512) throw invalidReturnDestination
  return normalized
}

// A downstream consumer may decode a return path again, so every decoding layer must also be safe.
function assertReturnPathLayers(value: string, checkLayer: (layer: string) => string) {
  let layer = value
  for (let depth = 0; depth <= maxReturnPathDecodeDepth; depth += 1) {
    const checked = checkLayer(layer)
    if (!/%[\dA-Fa-f]{2}/.test(checked)) return
    if (depth === maxReturnPathDecodeDepth) throw invalidReturnDestination
    try {
      layer = decodeURIComponent(checked)
    } catch {
      throw invalidReturnDestination
    }
  }
}

function checkNonAuthorizationLayer(value: string) {
  const destination = parseLocalReturnDestination(value)
  if (['/auth', '/auth/'].includes(destination.pathname)) throw invalidReturnDestination
  return destination.pathname
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

function checkSafeReturnPathLayer(value: string) {
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

  return value
}
