import type {
  PlatformInstalledResourceDescriptor,
  PlatformResourceSubject,
} from '@eve-space/platform-module-contract'
import { CharacterTokenNotFoundError } from '../auth/character-token-store.js'
import {
  getCharacterAuthorizationForLifecycle,
  getCharacterCacheAuthorizationForLifecycle,
  ScopeRequiredError,
} from '../auth/tokens.js'
import { getEsiOperationContract } from '../esi-resilience/catalog-access.js'
import type { EsiOperation } from '../esi-resilience/catalog.js'
import type { PlatformCollectionStateIdentity } from './collection-state.js'
import {
  resolveInstalledResourceEligibility,
  type PlatformResourceEligibility,
  type PlatformResourceIneligibleStatus,
} from './resource-eligibility.js'
import { findInstalledResource } from './resource-identity.js'
import { toPlatformResourceSubject } from './resource-subject.js'
import { platformResources } from './resources.js'

type ResourceExecutionNoopReason = 'already-current' | PlatformResourceIneligibleStatus
type CharacterAuthorization = { readonly tokenVersion: number }
type EligibleResource = Extract<PlatformResourceEligibility, { status: 'eligible' }>
type PlatformResourceExecutionNoop = {
  readonly outcome: 'noop'
  readonly reason: ResourceExecutionNoopReason
}
type ResourceExecutionEligibility =
  | PlatformResourceExecutionNoop
  | { readonly outcome: 'eligible'; readonly eligibility: EligibleResource }

export type PlatformResourceExecutionGuard =
  | PlatformResourceExecutionNoop
  | {
      readonly outcome: 'ready'
      readonly resource: PlatformInstalledResourceDescriptor
      readonly subject?: PlatformResourceSubject
      readonly characterId?: number
      readonly authorization: CharacterAuthorization | null
      readonly authorizationCharacterId?: number | null
      readonly authorizationCharacterLifecycleId?: string | null
    }

interface ResourceExecutionGuardOptions {
  readonly signal?: AbortSignal
  readonly resources?: readonly PlatformInstalledResourceDescriptor[]
  readonly resolveEligibility?: typeof resolveInstalledResourceEligibility
  readonly loadCharacterCacheAuthorization?: typeof getCharacterCacheAuthorizationForLifecycle
  readonly loadCharacterAuthorization?: typeof getCharacterAuthorizationForLifecycle
}

export async function guardInstalledResourceExecution(
  identity: PlatformCollectionStateIdentity,
  options: ResourceExecutionGuardOptions = {},
): Promise<PlatformResourceExecutionGuard> {
  options.signal?.throwIfAborted()
  const resources = options.resources ?? platformResources
  const resolveEligibility = options.resolveEligibility ?? resolveInstalledResourceEligibility
  const initialEligibility = classifyExecutionEligibility(
    await resolveEligibility(identity, { resources, signal: options.signal }),
  )
  options.signal?.throwIfAborted()
  if (initialEligibility.outcome === 'noop') return initialEligibility
  const eligibility = initialEligibility.eligibility

  const resource = findInstalledResource(identity, resources)
  if (!resource) return { outcome: 'noop', reason: 'resource-unavailable' }
  const subject = toPlatformResourceSubject(
    identity as Parameters<typeof toPlatformResourceSubject>[0],
  )
  if (!subject) return { outcome: 'noop', reason: 'obsolete' }

  const operation = getEsiOperationContract(resource.operationId as EsiOperation)
  if (operation.authorization.kind === 'public')
    return createReadyResourceExecution(resource, subject, null)

  const { authorizationCharacterId, authorizationCharacterLifecycleId } =
    resolveAuthorizationIdentity(eligibility, subject)
  if (!authorizationCharacterId || !authorizationCharacterLifecycleId)
    return { outcome: 'noop', reason: 'authorization-required' }

  let authorization: CharacterAuthorization
  try {
    const loadAuthorization =
      options.loadCharacterCacheAuthorization ??
      options.loadCharacterAuthorization ??
      getCharacterCacheAuthorizationForLifecycle
    authorization = options.signal
      ? await loadAuthorization(
          authorizationCharacterId,
          authorizationCharacterLifecycleId,
          operation.authorization.scope,
          options.signal,
        )
      : await loadAuthorization(
          authorizationCharacterId,
          authorizationCharacterLifecycleId,
          operation.authorization.scope,
        )
    options.signal?.throwIfAborted()
  } catch (error) {
    options.signal?.throwIfAborted()
    return mapCharacterAuthorizationError(error, subject.kind)
  }

  const ready = createReadyResourceExecution(
    resource,
    subject,
    authorization,
    authorizationCharacterId,
    authorizationCharacterLifecycleId,
  )
  if (authorization.tokenVersion === eligibility.authorizationGeneration) return ready

  const refreshedEligibility = classifyExecutionEligibility(
    await resolveEligibility(identity, { resources, signal: options.signal }),
  )
  options.signal?.throwIfAborted()
  if (refreshedEligibility.outcome === 'noop') return refreshedEligibility
  const refreshed = refreshedEligibility.eligibility
  const refreshedAuthorization = resolveAuthorizationIdentity(refreshed, subject)
  if (
    authorization.tokenVersion !== refreshed.authorizationGeneration ||
    authorizationCharacterId !== refreshedAuthorization.authorizationCharacterId ||
    authorizationCharacterLifecycleId !== refreshedAuthorization.authorizationCharacterLifecycleId
  )
    return { outcome: 'noop', reason: 'obsolete' }

  return ready
}

function classifyExecutionEligibility(
  eligibility: PlatformResourceEligibility,
): ResourceExecutionEligibility {
  if (eligibility.status !== 'eligible') return { outcome: 'noop', reason: eligibility.status }
  if (!eligibility.due) return { outcome: 'noop', reason: 'already-current' }
  return { outcome: 'eligible', eligibility }
}

function resolveAuthorizationIdentity(
  eligibility: EligibleResource,
  subject: PlatformResourceSubject,
) {
  const subjectAuthorization =
    subject.kind === 'character'
      ? {
          authorizationCharacterId: subject.characterId,
          authorizationCharacterLifecycleId: subject.lifecycleId,
        }
      : { authorizationCharacterId: null, authorizationCharacterLifecycleId: null }
  return {
    authorizationCharacterId:
      eligibility.authorizationCharacterId ?? subjectAuthorization.authorizationCharacterId,
    authorizationCharacterLifecycleId:
      eligibility.authorizationCharacterLifecycleId ??
      subjectAuthorization.authorizationCharacterLifecycleId,
  }
}

function createReadyResourceExecution(
  resource: PlatformInstalledResourceDescriptor,
  subject: PlatformResourceSubject,
  authorization: CharacterAuthorization | null,
  authorizationCharacterId: number | null = null,
  authorizationCharacterLifecycleId: string | null = null,
): PlatformResourceExecutionGuard {
  return {
    outcome: 'ready',
    resource,
    subject,
    ...(subject.kind === 'character' ? { characterId: subject.characterId } : {}),
    authorization,
    authorizationCharacterId,
    authorizationCharacterLifecycleId,
  }
}

function mapCharacterAuthorizationError(
  error: unknown,
  subjectKind: PlatformResourceSubject['kind'],
): PlatformResourceExecutionNoop {
  if (error instanceof ScopeRequiredError)
    return { outcome: 'noop', reason: 'authorization-required' }
  if (error instanceof CharacterTokenNotFoundError)
    return {
      outcome: 'noop',
      reason: subjectKind === 'corporation' ? 'authorization-required' : 'obsolete',
    }
  throw error
}
