import type { PlatformCollectionStatus } from '@eve-space/platform-module-contract/server'
import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract/resources'
import type { PlatformEsiExecution } from '../esi-gateway/platform-execution.js'
import { platformResources } from './resources.js'
import { findInstalledResource } from './resource-identity.js'
import type { PlatformCollectionStateIdentity } from './collection-state.js'
import { upsertPlatformCollectionState } from './collection-state-store.js'
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
  result: Pick<PlatformEsiExecution<unknown>, 'validatedAt'>,
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

  return (options.upsertState ?? upsertPlatformCollectionState)({
    ...identity,
    nextEligibleAt,
    authorizationGeneration,
    ...options.managedAuthority,
    validatedAt,
    lastFailureClass: null,
  })
}

function projectCollectionStatus(
  identity: PlatformCollectionStateIdentity,
  eligibility: PlatformResourceEligibility,
): PlatformCollectionStatus {
  const validatedAt =
    'validatedAt' in eligibility ? (eligibility.validatedAt?.toISOString() ?? null) : null
  const lastFailureClass = 'lastFailureClass' in eligibility ? eligibility.lastFailureClass : null
  const authorizationGeneration =
    'authorizationGeneration' in eligibility ? eligibility.authorizationGeneration : null
  if (eligibility.status === 'authorization-required') {
    return {
      authorizationGeneration,
      lastFailureClass: 'authorization-required',
      reauthorizationPath: `/auth/eve/reauthorize/${encodeURIComponent(String(eligibility.authorizationCharacterId ?? identity.subjectId))}`,
      requiredScope: eligibility.requiredScope,
      status: 'authorization-required',
      validatedAt,
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
