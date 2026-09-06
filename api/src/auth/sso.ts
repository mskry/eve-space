import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose'
import { z } from 'zod'
import { env, getSsoConfig } from '../env.js'
import { SsoHttpError, SsoTokenRejectedError, SsoTransportError } from './sso-errors.js'

const metadataSchema = z.object({
  issuer: z.url(),
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  jwks_uri: z.url(),
})

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  token_type: z.string(),
})

const refreshResponseSchema = tokenResponseSchema.extend({
  refresh_token: z.string().min(1).optional(),
})

const oauthErrorSchema = z.object({ error: z.string() })

const scopesSchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((scopes) => {
    if (!scopes) return []
    return typeof scopes === 'string' ? scopes.split(/\s+/).filter(Boolean) : scopes
  })

const claimsSchema = z.looseObject({
  sub: z.string().regex(/^CHARACTER:EVE:\d+$/),
  name: z.string().min(1),
  scp: scopesSchema,
})

const metadataUrl = 'https://login.eveonline.com/.well-known/oauth-authorization-server'
// The token call is the slow leg and gets the full budget. Discovery and JWKS are small, cached
// process-wide after the first success, and share half of it each, so a refresh holding the
// per-character advisory lock costs at most 2 x EVE_SSO_TIMEOUT_MS -- the bound `env.ts` enforces
// against TOKEN_REFRESH_LOCK_TIMEOUT_MS.
const tokenTimeoutMs = env.EVE_SSO_TIMEOUT_MS
const discoveryTimeoutMs = Math.ceil(env.EVE_SSO_TIMEOUT_MS / 2)
let metadataPromise: ReturnType<typeof loadMetadata> | undefined

async function loadMetadata() {
  const response = await fetchSso(metadataUrl, {
    signal: AbortSignal.timeout(discoveryTimeoutMs),
  })
  if (!response.ok) throw new SsoHttpError('EVE SSO metadata', response.status)
  return metadataSchema.parse(await readJson(response))
}

function getEveMetadata() {
  // Cache the success only; a retained rejection would fail every later SSO call in this process.
  metadataPromise ??= loadMetadata().catch((error: unknown) => {
    metadataPromise = undefined
    throw error
  })
  return metadataPromise
}

export async function createAuthorizationUrl(state: string) {
  const config = getSsoConfig()
  const metadata = await getEveMetadata()
  const url = new URL(metadata.authorization_endpoint)

  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.callbackUrl)
  url.searchParams.set('state', state)
  if (config.scopes.length) url.searchParams.set('scope', config.scopes.join(' '))

  return url
}

export async function exchangeAuthorizationCode(code: string) {
  const config = getSsoConfig()
  const metadata = await getEveMetadata()
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
  const response = await fetchSso(metadata.token_endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
    }),
  })

  if (!response.ok) throw new SsoHttpError('EVE token exchange', response.status)
  return tokenResponseSchema.parse(await readJson(response))
}

export async function refreshAccessToken(refreshToken: string) {
  const config = getSsoConfig()
  const metadata = await getEveMetadata()
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
  const response = await fetchSso(metadata.token_endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    signal: AbortSignal.timeout(tokenTimeoutMs),
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  if (!response.ok) await throwRefreshError(response)
  return refreshResponseSchema.parse(await readJson(response))
}

export async function verifyAccessToken(accessToken: string) {
  const config = getSsoConfig()
  const metadata = await getEveMetadata()
  const jwks = createRemoteJWKSet(new URL(metadata.jwks_uri), {
    timeoutDuration: discoveryTimeoutMs,
    [customFetch]: fetchJwks,
  })
  const { payload } = await jwtVerify(accessToken, jwks, {
    issuer: [metadata.issuer, 'https://login.eveonline.com/', 'login.eveonline.com'],
    audience: 'EVE Online',
  })

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  if (!audiences.includes('EVE Online') || !audiences.includes(config.clientId)) {
    throw new Error('EVE access token has an invalid audience')
  }

  const claims = claimsSchema.parse(payload)

  return {
    characterId: Number(claims.sub.split(':').at(-1)),
    characterName: claims.name,
    scopes: claims.scp,
  }
}

async function fetchSso(input: string | URL, init?: RequestInit) {
  try {
    return await fetch(input, init)
  } catch (cause) {
    throw new SsoTransportError(cause)
  }
}

async function readResponseBody(response: Response) {
  try {
    return await response.text()
  } catch (cause) {
    throw new SsoTransportError(cause)
  }
}

async function readJson(response: Response) {
  return JSON.parse(await readResponseBody(response)) as unknown
}

// Intermediaries answer 4xx with empty or HTML bodies, so an unparseable body must degrade to the
// status-based classification instead of throwing a SyntaxError past isTransientSsoError.
async function readErrorJson(response: Response) {
  const body = await readResponseBody(response)
  try {
    return JSON.parse(body) as unknown
  } catch {
    return undefined
  }
}

async function throwRefreshError(response: Response): Promise<never> {
  if (response.status === 400 || response.status === 401 || response.status === 403) {
    const parsed = oauthErrorSchema.safeParse(await readErrorJson(response))
    if (parsed.success && ['invalid_grant', 'invalid_token'].includes(parsed.data.error))
      throw new SsoTokenRejectedError(response.status)
  }
  throw new SsoHttpError('EVE token refresh', response.status)
}

async function fetchJwks(url: string, options: Parameters<typeof fetch>[1]) {
  const response = await fetchSso(url, options)
  if (!response.ok) throw new SsoHttpError('EVE SSO JWKS', response.status)
  const body = await readResponseBody(response)
  // The body is already decoded here, so the upstream transfer headers no longer describe it.
  const headers = new Headers(response.headers)
  headers.delete('content-encoding')
  headers.delete('content-length')
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
