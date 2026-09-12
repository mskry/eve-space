import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract'
import { EveSsoTokenRefreshError } from '../auth/sso.js'
import { TokenRefreshUnavailableError } from '../auth/token-errors.js'
import { classifyEsiRefreshFailure, EsiQuotaError } from '../esi-gateway/failures.js'
import type { PlatformEsiExecution } from '../esi-gateway/platform-execution.js'
import type {
  PlatformCollectionFailureClass,
  PlatformCollectionStateIdentity,
} from './collection-state.js'
import { upsertPlatformCollectionState } from './collection-state-store.js'
import { resolveInstalledResourceEligibility } from './resource-eligibility.js'
import { findInstalledResource } from './resource-identity.js'
import { platformResources } from './resources.js'

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

class PlatformResourceEsiUnavailableError extends Error {
  constructor() {
    super('Platform resource ESI refresh was unavailable')
    this.name = 'PlatformResourceEsiUnavailableError'
  }
}

export function assertPlatformResourceRefreshSucceeded(result: PlatformEsiExecution<unknown>) {
  if (result.refreshFailureClass === 'esi-cooldown') {
    const retryAt = result.retryAt ? new Date(result.retryAt) : new Date(Date.now() + 1_000)
    throw new EsiQuotaError(
      Math.max(1, Math.ceil((retryAt.getTime() - Date.now()) / 1_000)),
      Date.now(),
      retryAt,
    )
  }
  if (result.refreshFailureClass === 'esi-unavailable')
    throw new PlatformResourceEsiUnavailableError()
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
  const resources = options.resources ?? platformResources
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
  const esiFailure = classifyEsiRefreshFailure(error)
  if (
    error instanceof PlatformResourceEsiUnavailableError ||
    error instanceof TokenRefreshUnavailableError ||
    esiFailure === 'esi-unavailable'
  )
    return {
      failureClass: 'esi-unavailable',
      nextEligibleAt: new Date(now.getTime() + transientFailureBackoffMilliseconds),
    } as const
  if (esiFailure === 'response-invalid' || error instanceof PlatformResourceResponseInvalidError)
    return permanentFailure('response-invalid')
  if (error instanceof PlatformResourceMappingError) return permanentFailure('mapping-failed')
  if (error instanceof PlatformResourcePersistenceError)
    return permanentFailure('persistence-failed')
  return permanentFailure('unknown')
}

function permanentFailure(failureClass: PlatformCollectionFailureClass) {
  return { failureClass, nextEligibleAt: null }
}
