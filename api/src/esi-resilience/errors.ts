import type { EsiResponseMetadata } from '@evespace/esi-client'
import { TokenRefreshUnavailableError } from '../auth/tokens.js'
import { EsiQuotaError } from './cooldowns.js'
import type { EsiOperationContract } from './contract-types.js'
import { esiCooldownFallbackSeconds } from './policy.js'
import { EsiTransportError } from './transport.js'
import type { EsiCachedResult } from './types.js'

const completedEsiOperationErrors = new WeakSet<object>()

export function markEsiOperationErrorCompleted(error: unknown) {
  if (typeof error === 'object' && error) completedEsiOperationErrors.add(error)
}

export function shouldRetryEsiError(error: unknown) {
  return (
    !(typeof error === 'object' && error && completedEsiOperationErrors.has(error)) &&
    isRetryableEsiError(error)
  )
}

function isRetryableEsiError(error: unknown) {
  const transportError = getEsiTransportError(error)
  if (transportError) {
    const status = transportError.status
    return status === undefined || status < 400 || (status >= 500 && status < 600)
  }
  const status = getErrorStatus(error)
  return isEsiHttpError(error) && status !== undefined && status >= 500 && status < 600
}

export function isStaleUsableForFailure(
  stale:
    | { readonly kind: 'bounded' | 'outage'; readonly milliseconds: number }
    | { readonly kind: 'none' },
  error: unknown,
) {
  if (stale.kind === 'none') return false
  if (stale.kind === 'bounded') return true
  const failure = classifyStaleRefreshFailure(error)
  return failure === 'esi-unavailable' || failure === 'esi-cooldown'
}

export function classifyStaleRefreshFailure(
  error: unknown,
): NonNullable<EsiCachedResult<unknown>['refreshFailureClass']> {
  if (error instanceof EsiQuotaError) return 'esi-cooldown'
  if (error instanceof TokenRefreshUnavailableError) return 'esi-unavailable'
  if (isRetryableEsiError(error)) return 'esi-unavailable'
  if (isEsiResponseContractError(error)) return 'response-invalid'
  return 'unknown'
}

export function getErrorStatus(error: unknown) {
  if (typeof error !== 'object' || !error || !('status' in error)) return undefined
  const status = Number(error.status)
  return Number.isFinite(status) ? status : undefined
}

export function getErrorMetadata(error: unknown): EsiResponseMetadata | undefined {
  if (typeof error !== 'object' || !error || !('metadata' in error)) return undefined
  return error.metadata as EsiResponseMetadata
}

export function toEsiQuotaError(error: unknown) {
  if (error instanceof EsiQuotaError || getErrorStatus(error) !== 429) return error
  const retryAfter = Number(getErrorMetadata(error)?.headers['retry-after'])
  return new EsiQuotaError(
    Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.max(1, Math.ceil(retryAfter))
      : esiCooldownFallbackSeconds,
  )
}

function getEsiTransportError(error: unknown) {
  if (error instanceof EsiTransportError) return error
  if (
    typeof error !== 'object' ||
    !error ||
    !('code' in error) ||
    error.code !== 'ESI_RESPONSE_PARSE_ERROR' ||
    !('cause' in error)
  )
    return undefined
  return error.cause instanceof EsiTransportError ? error.cause : undefined
}

function isEsiHttpError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ESI_HTTP_ERROR'
  )
}

export function shouldAdvanceRevisionAfterMutationError(
  policy: EsiOperationContract,
  error: unknown,
) {
  return (
    error instanceof EsiTransportError ||
    isEsiResponseContractError(error) ||
    (policy.mutation?.appliedOnMissing === true && getErrorStatus(error) === 404)
  )
}

function isEsiResponseContractError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ESI_RESPONSE_PARSE_ERROR' || error.code === 'ESI_RESPONSE_VALIDATION_ERROR')
  )
}
