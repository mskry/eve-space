import type {
  PlatformCollectionStatus,
  PlatformInstalledResourceDescriptor,
} from '@eve-space/platform-module-contract'
import { platformResources } from './resources.js'
import type { EsiCachedResult } from '../esi-resilience/types.js'
import { findInstalledResource } from './resource-identity.js'
import type { PlatformCollectionStateIdentity } from './collection-state.js'
import { upsertPlatformCollectionState } from './collection-state-store.js'
import {
  resolveInstalledResourceEligibility,
  type PlatformResourceEligibility,
} from './resource-eligibility.js'

interface CollectionStatusOptions {
  readonly resources?: readonly PlatformInstalledResourceDescriptor[]
  readonly resolveEligibility?: typeof resolveInstalledResourceEligibility
}

interface CollectionSuccessOptions {
  readonly resources?: readonly PlatformInstalledResourceDescriptor[]
  readonly upsertState?: typeof upsertPlatformCollectionState
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
  result: Pick<EsiCachedResult<unknown>, 'validatedAt'>,
  authorizationGeneration: number | null,
  options: CollectionSuccessOptions = {},
) {
  const resource = findInstalledResource(identity, options.resources ?? platformResources)
  if (!resource) throw new Error('Installed platform resource is unavailable')
  const validatedAt = new Date(result.validatedAt)
  if (Number.isNaN(validatedAt.getTime()))
    throw new Error('ESI representation validation time is invalid')
  const nextEligibleAt = new Date(
    validatedAt.getTime() + resource.materializationIntervalSeconds * 1_000,
  )

  return (options.upsertState ?? upsertPlatformCollectionState)({
    ...identity,
    nextEligibleAt,
    authorizationGeneration,
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
  if (eligibility.status === 'authorization-required')
    return {
      status: 'authorization-required',
      authorizationGeneration,
      validatedAt,
      lastFailureClass: 'authorization-required',
      requiredScope: eligibility.requiredScope,
      reauthorizationPath: `/auth/eve/reauthorize/${encodeURIComponent(String(eligibility.authorizationCharacterId ?? identity.subjectId))}`,
    }
  if (eligibility.status !== 'eligible')
    return {
      status: 'unavailable',
      authorizationGeneration,
      validatedAt,
      lastFailureClass,
    }
  if (validatedAt)
    return {
      status: eligibility.due || lastFailureClass ? 'stale' : 'current',
      authorizationGeneration,
      validatedAt,
      lastFailureClass,
    }
  if (lastFailureClass)
    return {
      status: 'unavailable',
      authorizationGeneration,
      validatedAt: null,
      lastFailureClass,
    }
  return {
    status: 'never-collected',
    authorizationGeneration,
    validatedAt: null,
    lastFailureClass: null,
  }
}
