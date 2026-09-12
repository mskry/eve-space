import {
  classifyEsiFailure as classifySdkEsiFailure,
  EsiHttpError,
  EsiNotModifiedError,
  EsiResponseParseError,
  EsiResponseValidationError,
  EsiTransportError,
} from '@evespace/esi-client'
import { TokenRefreshUnavailableError } from '../../auth/token-errors.js'
import type { EsiOperationContract } from './contract-types.js'
import { esiCooldownFallbackSeconds } from './policy.js'
import { EsiQuotaError } from './quota-error.js'
import type { EsiCachedResult } from './types.js'

export type EsiFailure =
  | {
      readonly kind: 'quota'
      readonly retryAfterSeconds: number
      readonly retryAt: string
    }
  | { readonly kind: 'authorization'; readonly status: 401 | 403 }
  | { readonly kind: 'unavailable'; readonly status?: number }
  | { readonly kind: 'response-invalid'; readonly status?: number }
  | { readonly kind: 'http'; readonly status: number }
  | { readonly kind: 'unknown' }

interface CompletedEsiOperationErrors {
  markErrorCompleted(error: unknown): void
  isErrorCompleted(error: unknown): boolean
}

export function shouldRetryEsiError(error: unknown, completedErrors: CompletedEsiOperationErrors) {
  return (
    !completedErrors.isErrorCompleted(error) &&
    classifyEsiOperationFailure(error).kind === 'unavailable'
  )
}

export function classifyEsiOperationFailure(error: unknown): EsiFailure {
  if (error instanceof EsiQuotaError)
    return {
      kind: 'quota',
      retryAfterSeconds: error.retryAfterSeconds,
      retryAt: error.retryAt.toISOString(),
    }

  const status = getEsiFailureStatus(error)
  if (status === 401 || status === 403) return { kind: 'authorization', status }
  if (error instanceof TokenRefreshUnavailableError) return unavailableFailure(status)

  const sdkFailure = classifySdkEsiFailure(error)
  if (sdkFailure === 'invalid-response') return invalidResponseFailure(status)
  if (isTransientUnavailableFailure(error, sdkFailure, status)) return unavailableFailure(status)
  const quotaFailure = getQuotaFailure(error, status)
  if (quotaFailure) return quotaFailure
  if (status !== undefined) return { kind: 'http', status }
  return { kind: 'unknown' }
}

export function classifyEsiRefreshFailure(
  error: unknown,
): NonNullable<EsiCachedResult<unknown>['refreshFailureClass']> {
  const failure = classifyEsiOperationFailure(error)
  if (failure.kind === 'quota') return 'esi-cooldown'
  if (failure.kind === 'unavailable') return 'esi-unavailable'
  if (failure.kind === 'response-invalid') return 'response-invalid'
  return 'unknown'
}

export function getEsiFailureStatus(error: unknown) {
  if (error instanceof EsiNotModifiedError) return error.status
  if (
    error instanceof EsiHttpError ||
    error instanceof EsiResponseParseError ||
    error instanceof EsiResponseValidationError ||
    error instanceof EsiTransportError
  )
    return error.status
  return undefined
}

export function isEsiAuthorizationFailure(error: unknown) {
  return classifyEsiOperationFailure(error).kind === 'authorization'
}

export function isEsiMutationOutcomeUnknown(error: unknown) {
  return error instanceof EsiTransportError || classifySdkEsiFailure(error) === 'invalid-response'
}

export function isStaleUsableForFailure(
  stale:
    | { readonly kind: 'bounded' | 'outage'; readonly milliseconds: number }
    | { readonly kind: 'none' },
  error: unknown,
) {
  if (stale.kind === 'none') return false
  if (stale.kind === 'bounded') return true
  const failure = classifyEsiRefreshFailure(error)
  return failure === 'esi-unavailable' || failure === 'esi-cooldown'
}

export function toEsiQuotaError(error: unknown, now = Date.now()) {
  if (error instanceof EsiQuotaError) return error
  const failure = classifyEsiOperationFailure(error)
  return failure.kind === 'quota' ? new EsiQuotaError(failure.retryAfterSeconds, now) : error
}

export function shouldAdvanceRevisionAfterMutationError(
  policy: EsiOperationContract,
  error: unknown,
) {
  const failure = classifyEsiOperationFailure(error)
  return (
    isEsiMutationOutcomeUnknown(error) ||
    (policy.mutation?.appliedOnMissing === true &&
      failure.kind === 'http' &&
      failure.status === 404)
  )
}

function unavailableFailure(status: number | undefined): EsiFailure {
  return status === undefined ? { kind: 'unavailable' } : { kind: 'unavailable', status }
}

function invalidResponseFailure(status: number | undefined): EsiFailure {
  return status === undefined ? { kind: 'response-invalid' } : { kind: 'response-invalid', status }
}

function isTransientUnavailableFailure(
  error: unknown,
  sdkFailure: string,
  status: number | undefined,
) {
  return (
    sdkFailure === 'transient' &&
    !(error instanceof EsiTransportError && status !== undefined && status >= 400 && status < 500)
  )
}

function getQuotaFailure(error: unknown, status: number | undefined): EsiFailure | undefined {
  if (status !== 429) return undefined
  const retryAfter = error instanceof EsiHttpError ? error.metadata.retryAfterSeconds : undefined
  const retryAfterSeconds =
    retryAfter !== undefined && retryAfter > 0
      ? Math.max(1, Math.ceil(retryAfter))
      : esiCooldownFallbackSeconds
  return {
    kind: 'quota',
    retryAfterSeconds,
    retryAt: new Date(Date.now() + retryAfterSeconds * 1_000).toISOString(),
  }
}
