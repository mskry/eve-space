import type { PlatformCollectionStatus } from '@eve-space/platform-module-contract/server'
import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract/resources'
import type { PlatformEsiExecution } from '../esi-gateway/platform-execution.js'
import { platformResources } from './resources.js'
import { findInstalledResource } from './resource-identity.js'
import type { PlatformCollectionStateIdentity } from './collection-state.js'
import { upsertPlatformCollectionState } from './collection-state-store.js'
import { currentObservationDisplayStatus } from './current-observation-status.js'
import {
  resolveInstalledResourceEligibility,
  type PlatformManagedCollectionAuthority,
  type PlatformResourceEligibility,
} from './resource-eligibility.js'

interface CollectionStatusOptions {
  readonly resources?: readonly PlatformInstalledResourceDescriptor[]
  readonly resolveEligibility?: typeof resolveInstalledResourceEligibility
}

interface CollectionSuccessOptions {
  readonly resources?: readonly PlatformInstalledResourceDescriptor[]
  readonly upsertState?: typeof upsertPlatformCollectionState
  readonly managedAuthority?: PlatformManagedCollectionAuthority | null
}

export async function getInstalledResourceCollectionStatus(
  identity: PlatformCollectionStateIdentity,
  options: CollectionStatusOptions = {},
): Promise<PlatformCollectionStatus> {
  const resources = options.resources ?? platformResources
  const eligibility = await (options.resolveEligibility ?? resolveInstalledResourceEligibility)(
    identity,
    { resources },
  )
  return projectCollectionStatus(identity, eligibility)
}

export async function recordInstalledResourceCollectionSuccess(
  identity: PlatformCollectionStateIdentity,
  result: Pick<PlatformEsiExecution<unknown>, 'validatedAt'> &
    Partial<Pick<PlatformEsiExecution<unknown>, 'cachedUntil'>>,
  authorizationGeneration: number | null,
  options: CollectionSuccessOptions = {},
) {
  const resource = findInstalledResource(identity, options.resources ?? platformResources)
  if (!resource) {
    throw new Error('Installed platform resource is unavailable')
  }
  const validatedAt = new Date(result.validatedAt)
  if (Number.isNaN(validatedAt.getTime())) {
    throw new TypeError('ESI representation validation time is invalid')
  }
  const nextEligibleAt = new Date(
    validatedAt.getTime() + resource.materializationIntervalSeconds * 1000,
  )
  const observation = resource.freshness === 'representation-expiry'
  const cachedUntil = observation && result.cachedUntil ? new Date(result.cachedUntil) : null
  if (cachedUntil && (!Number.isFinite(cachedUntil.getTime()) || cachedUntil < validatedAt)) {
    throw new TypeError('ESI representation expiry is invalid')
  }

  return (options.upsertState ?? upsertPlatformCollectionState)({
    ...identity,
    nextEligibleAt,
    authorizationGeneration,
    ...options.managedAuthority,
    validatedAt,
    ...(observation && { cachedUntil }),
    lastFailureClass: null,
  })
}

const collectionStatusMetadata = (eligibility: PlatformResourceEligibility) => ({
  validatedAt:
    'validatedAt' in eligibility ? (eligibility.validatedAt?.toISOString() ?? null) : null,
  lastFailureClass: 'lastFailureClass' in eligibility ? eligibility.lastFailureClass : null,
  authorizationGeneration:
    'authorizationGeneration' in eligibility ? eligibility.authorizationGeneration : null,
})

function projectCollectionStatus(
  identity: PlatformCollectionStateIdentity,
  eligibility: PlatformResourceEligibility,
): PlatformCollectionStatus {
  const { validatedAt, lastFailureClass, authorizationGeneration } =
    collectionStatusMetadata(eligibility)
  if (eligibility.status === 'authorization-required') {
    const authorizationReason = eligibility.authorizationReason ?? 'scope-missing'
    return {
      authorizationGeneration,
      authorizationReason,
      lastFailureClass: 'authorization-required',
      ...(authorizationReason === 'scope-missing' && {
        reauthorizationPath: `/auth/eve/reauthorize/${encodeURIComponent(String(eligibility.authorizationCharacterId ?? identity.subjectId))}`,
      }),
      ...(eligibility.requiredRolePredicates && {
        requiredRolePredicates: eligibility.requiredRolePredicates,
      }),
      requiredScope: eligibility.requiredScope,
      status: 'authorization-required',
      validatedAt,
    }
  }
  if (eligibility.observationState && 'validatedAt' in eligibility) {
    return {
      authorizationGeneration,
      lastFailureClass,
      status: currentObservationDisplayStatus(eligibility.observationState, lastFailureClass),
      validatedAt,
      cachedUntil: eligibility.cachedUntil?.toISOString() ?? null,
    }
  }
  if (eligibility.status !== 'eligible') {
    return {
      authorizationGeneration,
      lastFailureClass,
      status: 'unavailable',
      validatedAt,
    }
  }
  if (validatedAt) {
    return {
      authorizationGeneration,
      lastFailureClass,
      status: eligibility.due || lastFailureClass ? 'stale' : 'current',
      validatedAt,
    }
  }
  if (lastFailureClass) {
    return {
      authorizationGeneration,
      lastFailureClass,
      status: 'unavailable',
      validatedAt: null,
    }
  }
  return {
    authorizationGeneration,
    lastFailureClass: null,
    status: 'never-collected',
    validatedAt: null,
  }
}
