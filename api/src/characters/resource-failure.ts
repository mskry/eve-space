import { ScopeRequiredError, TokenRefreshUnavailableError } from '../auth/token-errors.js'
import { EsiQuotaError } from '../esi-gateway/failures.js'

export type CharacterResourceFailure =
  | { kind: 'cooldown'; retryAfterSeconds: number }
  | { kind: 'token-refresh-unavailable' }
  | { kind: 'scope-required'; requiredScope: string }
  | { kind: 'authorization-rejected'; requiredScope: string }
  | { kind: 'unavailable' }

interface CharacterResourceFailureOptions {
  configuredScope: string
  preferConfiguredScope?: boolean
}

export function classifyCharacterResourceFailure(
  error: unknown,
  options: CharacterResourceFailureOptions,
): CharacterResourceFailure {
  if (error instanceof EsiQuotaError)
    return { kind: 'cooldown', retryAfterSeconds: error.retryAfterSeconds }
  if (error instanceof TokenRefreshUnavailableError) return { kind: 'token-refresh-unavailable' }
  if (error instanceof ScopeRequiredError) {
    return {
      kind: 'scope-required',
      requiredScope: options.preferConfiguredScope ? options.configuredScope : error.scope,
    }
  }
  if (isRejectedAuthorization(error))
    return { kind: 'authorization-rejected', requiredScope: options.configuredScope }
  return { kind: 'unavailable' }
}

function isRejectedAuthorization(error: unknown) {
  if (typeof error !== 'object' || error === null || !('status' in error)) return false
  const status = httpStatus(error.status)
  return status === 401 || status === 403
}

function httpStatus(value: unknown) {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined
  const status = Number(value)
  return Number.isFinite(status) ? status : undefined
}
