import type { Context } from 'hono'
import { env } from '../env.js'
import type { EsiReadResultMetadata } from '../esi-gateway/feature-execution.js'
import type { CharacterResourceFailure } from './resource-failure.js'

interface OwnedCharacterResourceErrorOptions {
  scopeMessage: string
  unavailableMessage: string
  returnTo?: string
  cooldownMessage?: string
}

export function ownedCharacterResourceError(
  context: Context,
  failure: CharacterResourceFailure,
  characterId: number,
  options: OwnedCharacterResourceErrorOptions,
) {
  switch (failure.kind) {
    case 'cooldown':
      return options.cooldownMessage
        ? financeCooldown(context, failure.retryAfterSeconds, options.cooldownMessage)
        : esiCooldown(context, failure)
    case 'token-refresh-unavailable':
      return tokenRefreshUnavailable(context)
    case 'scope-required':
      return scopeRequired(context, characterId, options.scopeMessage, {
        requiredScope: failure.requiredScope,
        returnTo: options.returnTo,
      })
    case 'authorization-rejected':
      return reauthorizationRequired(context, characterId, {
        requiredScope: failure.requiredScope,
        returnTo: options.returnTo,
      })
    case 'unavailable':
      return context.json({ code: 'ESI_UNAVAILABLE', message: options.unavailableMessage }, 502)
  }
}

function tokenRefreshUnavailable(context: Context) {
  return context.json(
    {
      code: 'EVE_TOKEN_REFRESH_UNAVAILABLE',
      message: 'EVE token refresh is temporarily unavailable. Try again shortly.',
    },
    503,
  )
}

export function esiCooldown(context: Context, error: { readonly retryAfterSeconds: number }) {
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

export function toCharacterEsiResponse<Data extends EsiReadResultMetadata>(result: Data): Data {
  return result
}

export function characterReauthorizationUrl(characterId: number, returnTo?: string) {
  const url = new URL(`/auth/eve/reauthorize/${characterId}`, env.EVE_CALLBACK_URL)
  if (returnTo) url.searchParams.set('returnTo', returnTo)
  return url.toString()
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

function financeCooldown(context: Context, retryAfterSeconds: number, message: string) {
  context.header('Retry-After', String(retryAfterSeconds))
  return context.json(
    {
      code: 'ESI_QUOTA_EXHAUSTED',
      message,
      retryAfterSeconds,
    },
    429,
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
