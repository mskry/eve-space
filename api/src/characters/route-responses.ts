import type { Context } from 'hono'
import { ScopeRequiredError, TokenRefreshUnavailableError } from '../auth/tokens.js'
import { env } from '../env.js'
import { EsiQuotaError } from '../esi-resilience/cooldowns.js'

interface OwnedCharacterResourceErrorOptions {
  requiredScope: string
  scopeMessage: string
  unavailableMessage: string
  returnTo?: string
  preferConfiguredScope?: boolean
}

export function ownedCharacterResourceError(
  context: Context,
  error: unknown,
  characterId: number,
  options: OwnedCharacterResourceErrorOptions,
) {
  if (error instanceof EsiQuotaError) return esiCooldown(context, error)
  if (error instanceof TokenRefreshUnavailableError) return tokenRefreshUnavailable(context)
  if (error instanceof ScopeRequiredError) {
    return scopeRequired(context, characterId, options.scopeMessage, {
      requiredScope: options.preferConfiguredScope ? options.requiredScope : error.scope,
      returnTo: options.returnTo,
    })
  }

  const status = errorStatus(error)
  if (status === 401 || status === 403) {
    return reauthorizationRequired(context, characterId, {
      requiredScope: options.requiredScope,
      returnTo: options.returnTo,
    })
  }

  return context.json({ code: 'ESI_UNAVAILABLE', message: options.unavailableMessage }, 502)
}

export function tokenRefreshUnavailable(context: Context) {
  return context.json(
    {
      code: 'EVE_TOKEN_REFRESH_UNAVAILABLE',
      message: 'EVE token refresh is temporarily unavailable. Try again shortly.',
    },
    503,
  )
}

export function esiCooldown(context: Context, error: EsiQuotaError) {
  context.header('Retry-After', String(error.retryAfterSeconds))
  return context.json(
    {
      code: 'ESI_COOLDOWN',
      message: 'EVE Online ESI is temporarily rate limited.',
      retryAfterSeconds: error.retryAfterSeconds,
    },
    429,
  )
}

export function characterReauthorizationUrl(characterId: number, returnTo?: string) {
  const url = new URL(`/auth/eve/reauthorize/${characterId}`, env.EVE_CALLBACK_URL)
  if (returnTo) url.searchParams.set('returnTo', returnTo)
  return url.toString()
}

export function errorStatus(error: unknown) {
  return typeof error === 'object' && error && 'status' in error ? Number(error.status) : undefined
}

function scopeRequired(
  context: Context,
  characterId: number,
  message: string,
  options: { requiredScope: string; returnTo?: string },
) {
  return context.json(
    {
      code: 'EVE_SCOPE_REQUIRED',
      message,
      requiredScope: options.requiredScope,
      authorizeUrl: characterReauthorizationUrl(characterId, options.returnTo),
    },
    403,
  )
}

function reauthorizationRequired(
  context: Context,
  characterId: number,
  options: { requiredScope: string; returnTo?: string },
) {
  return context.json(
    {
      code: 'EVE_REAUTH_REQUIRED',
      message: 'EVE authorization is no longer valid.',
      requiredScope: options.requiredScope,
      authorizeUrl: characterReauthorizationUrl(characterId, options.returnTo),
    },
    403,
  )
}
