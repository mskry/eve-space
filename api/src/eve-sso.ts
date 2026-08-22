import { createRemoteJWKSet, jwtVerify } from 'jose'
import { z } from 'zod'
import { getSsoConfig } from './env.js'

const metadataSchema = z.object({
  issuer: z.string().url(),
  authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  jwks_uri: z.string().url(),
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

const scopesSchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((scopes) => {
    if (!scopes) return []
    return typeof scopes === 'string' ? scopes.split(/\s+/).filter(Boolean) : scopes
  })

const claimsSchema = z
  .object({
    sub: z.string().regex(/^CHARACTER:EVE:\d+$/),
    name: z.string().min(1),
    scp: scopesSchema,
  })
  .passthrough()

const metadataUrl = 'https://login.eveonline.com/.well-known/oauth-authorization-server'
const refreshTimeoutMs = 10_000
let metadataPromise: ReturnType<typeof loadMetadata> | undefined

async function loadMetadata() {
  const response = await fetch(metadataUrl)
  if (!response.ok) throw new Error(`EVE SSO metadata returned HTTP ${response.status}`)
  return metadataSchema.parse(await response.json())
}

function getEveMetadata() {
  metadataPromise ??= loadMetadata()
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
  const response = await fetch(metadata.token_endpoint, {
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

  if (!response.ok) throw new Error(`EVE token exchange returned HTTP ${response.status}`)
  return tokenResponseSchema.parse(await response.json())
}

export async function refreshAccessToken(refreshToken: string) {
  const config = getSsoConfig()
  const metadata = await getEveMetadata()
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
  const response = await fetch(metadata.token_endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    signal: AbortSignal.timeout(refreshTimeoutMs),
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  if (!response.ok) throw new Error(`EVE token refresh returned HTTP ${response.status}`)
  return refreshResponseSchema.parse(await response.json())
}

export async function verifyAccessToken(accessToken: string) {
  const config = getSsoConfig()
  const metadata = await getEveMetadata()
  const jwks = createRemoteJWKSet(new URL(metadata.jwks_uri))
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
