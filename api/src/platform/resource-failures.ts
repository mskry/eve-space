import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract'
import { EveSsoTokenRefreshError } from '../auth/sso.js'
import { TokenRefreshUnavailableError } from '../auth/tokens.js'
import { EsiQuotaError } from '../esi-resilience/cooldowns.js'
import { EsiTransportError } from '../esi-resilience/transport.js'
import type { EsiCachedResult } from '../esi-resilience/types.js'
import type {
  PlatformCollectionFailureClass,
  PlatformCollectionStateIdentity,
} from './collection-state.js'
import { upsertPlatformCollectionState } from './collection-state-store.js'
import { findInstalledResource } from './resource-declarations.js'
import { resolveInstalledResourceEligibility } from './resource-eligibility.js'

const transientFailureBackoffMilliseconds = 5 * 60 * 1_000

export class PlatformResourceMappingError extends Error {
  constructor(cause: unknown) {
    super('Platform resource mapping failed', { cause })
    this.name = 'PlatformResourceMappingError'
  }
}

export class PlatformResourcePersistenceError extends Error {
  constructor(cause: unknown) {
    super('Platform resource persistence failed', { cause })
    this.name = 'PlatformResourcePersistenceError'
  }
}

export class PlatformResourceAuthorizationError extends Error {
  constructor(cause: unknown) {
    super('Platform resource authorization failed', { cause })
    this.name = 'PlatformResourceAuthorizationError'
  }
}

class PlatformResourceResponseInvalidError extends Error {
  constructor() {
    super('Platform resource ESI response was invalid')
    this.name = 'PlatformResourceResponseInvalidError'
  }
}

export function assertPlatformResourceRefreshSucceeded(result: EsiCachedResult<unknown>) {
  if (result.refreshFailureClass === 'esi-cooldown') {
    const retryAt = result.retryAt ? new Date(result.retryAt) : new Date(Date.now() + 1_000)
    throw new EsiQuotaError(
      Math.max(1, Math.ceil((retryAt.getTime() - Date.now()) / 1_000)),
      Date.now(),
      retryAt,
    )
  }
  if (result.refreshFailureClass === 'esi-unavailable')
    throw new EsiTransportError(new Error('ESI refresh returned a stale fallback'))
  if (result.refreshFailureClass === 'response-invalid')
    throw new PlatformResourceResponseInvalidError()
  if (result.refreshFailureClass === 'unknown') throw new Error('ESI refresh failed permanently')
}

interface ResourceFailureOptions {
  readonly resources?: readonly PlatformInstalledResourceDescriptor[]
  readonly now?: Date
  readonly resolveEligibility?: typeof resolveInstalledResourceEligibility
  readonly upsertState?: typeof upsertPlatformCollectionState
}

export async function recordInstalledResourceCollectionFailure(
  identity: PlatformCollectionStateIdentity,
  error: unknown,
  options: ResourceFailureOptions = {},
) {
  const resources = options.resources
  const resource = findInstalledResource(identity, resources)
  if (!resource) return null
  const now = options.now ?? new Date()
  const transition = classifyPlatformResourceFailure(error, now)
  const eligibility = await (options.resolveEligibility ?? resolveInstalledResourceEligibility)(
    identity,
    { resources: [resource], now },
  )
  if (
    !('authorizationGeneration' in eligibility) ||
    eligibility.status === 'authorization-required'
  )
    return transition

  await (options.upsertState ?? upsertPlatformCollectionState)({
    ...identity,
    nextEligibleAt: transition.nextEligibleAt,
    authorizationGeneration: eligibility.authorizationGeneration,
    validatedAt: eligibility.validatedAt,
    lastFailureClass: transition.failureClass,
  })
  return transition
}

export function classifyPlatformResourceFailure(error: unknown, now = new Date()) {
  if (
    error instanceof PlatformResourceAuthorizationError ||
    (error instanceof EveSsoTokenRefreshError && error.authorizationRevoked)
  )
    return { failureClass: 'authorization-required', nextEligibleAt: null } as const
  if (error instanceof EsiQuotaError)
    return { failureClass: 'esi-cooldown', nextEligibleAt: error.retryAt } as const
  if (
    error instanceof EsiTransportError ||
    error instanceof TokenRefreshUnavailableError ||
    (getErrorCode(error) === 'ESI_HTTP_ERROR' && getErrorStatus(error) >= 500)
  )
    return {
      failureClass: 'esi-unavailable',
      nextEligibleAt: new Date(now.getTime() + transientFailureBackoffMilliseconds),
    } as const
  if (
    getErrorCode(error) === 'ESI_RESPONSE_PARSE_ERROR' ||
    getErrorCode(error) === 'ESI_RESPONSE_VALIDATION_ERROR' ||
    error instanceof PlatformResourceResponseInvalidError
  )
    return permanentFailure('response-invalid')
  if (error instanceof PlatformResourceMappingError) return permanentFailure('mapping-failed')
  if (error instanceof PlatformResourcePersistenceError)
    return permanentFailure('persistence-failed')
  return permanentFailure('unknown')
}

function permanentFailure(failureClass: PlatformCollectionFailureClass) {
  return { failureClass, nextEligibleAt: null }
}

function getErrorCode(error: unknown) {
  return typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

function getErrorStatus(error: unknown) {
  return typeof error === 'object' && error && 'status' in error ? Number(error.status) : 0
}
