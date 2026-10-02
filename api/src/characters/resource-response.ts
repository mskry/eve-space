import type { CharacterResourceFailure } from './resource-failure.js'
import type { ReadAdmissionDenial } from '../auth/read-policy.js'

export interface OwnedCharacterResourceErrorOptions {
  readonly scopeMessage: string
  readonly unavailableMessage: string
  readonly returnTo?: string
  readonly cooldownMessage?: string
}

export const characterReauthorizationUrlFor = (
  callbackUrl: string,
  characterId: number,
  returnTo?: string,
) => {
  const url = new URL(`/auth/eve/reauthorize/${characterId}`, callbackUrl)
  if (returnTo) url.searchParams.set('returnTo', returnTo)
  return url.toString()
}

export const characterCooldownResponse = (retryAfterSeconds: number, message?: string) => ({
  status: 429 as const,
  body: {
    code: message ? 'ESI_QUOTA_EXHAUSTED' : 'ESI_COOLDOWN',
    message: message ?? 'EVE Online ESI is temporarily rate limited.',
    retryAfterSeconds,
  },
})

export const characterResourceResponse = (
  failure: CharacterResourceFailure,
  characterId: number,
  callbackUrl: string,
  options: OwnedCharacterResourceErrorOptions,
) => {
  switch (failure.kind) {
    case 'cooldown':
      return characterCooldownResponse(failure.retryAfterSeconds, options.cooldownMessage)
    case 'token-refresh-unavailable':
      return {
        status: 503 as const,
        body: {
          code: 'EVE_TOKEN_REFRESH_UNAVAILABLE',
          message: 'EVE token refresh is temporarily unavailable. Try again shortly.',
        },
      }
    case 'scope-required':
      return {
        status: 403 as const,
        body: {
          code: 'EVE_SCOPE_REQUIRED',
          message: options.scopeMessage,
          requiredScope: failure.requiredScope,
          authorizeUrl: characterReauthorizationUrlFor(callbackUrl, characterId, options.returnTo),
        },
      }
    case 'authorization-rejected':
      return {
        status: 403 as const,
        body: {
          code: 'EVE_REAUTH_REQUIRED',
          message: 'EVE authorization is no longer valid.',
          requiredScope: failure.requiredScope,
          authorizeUrl: characterReauthorizationUrlFor(callbackUrl, characterId, options.returnTo),
        },
      }
    case 'unavailable':
      return {
        status: 502 as const,
        body: { code: 'ESI_UNAVAILABLE', message: options.unavailableMessage },
      }
  }
}

export const characterAssetPaginationResponse = {
  status: 502 as const,
  body: {
    code: 'ESI_RESPONSE_INVALID',
    message: 'EVE Online returned invalid asset pagination metadata.',
  },
}

export const characterReadAdmissionResponse = (
  denial: ReadAdmissionDenial,
  characterId: number,
  callbackUrl: string,
  options: OwnedCharacterResourceErrorOptions,
) => {
  const requiredScope = denial.body.requiredScope
  if (requiredScope && denial.body.code === 'EVE_SCOPE_REQUIRED')
    return characterResourceResponse(
      { kind: 'scope-required', requiredScope },
      characterId,
      callbackUrl,
      options,
    )
  if (requiredScope && denial.body.code === 'EVE_REAUTH_REQUIRED')
    return characterResourceResponse(
      { kind: 'authorization-rejected', requiredScope },
      characterId,
      callbackUrl,
      options,
    )
  return { status: denial.status, body: denial.body }
}
