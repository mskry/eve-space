import type {
  PlatformInstalledResourceDescriptor,
  PlatformResourceSubject,
} from '@eve-space/platform-module-contract'
import { CharacterTokenNotFoundError } from '../auth/store.js'
import { getEsiOperationContract, type EsiOperation } from '../esi-resilience/catalog.js'
import { platformResources } from './resources.js'
import { findInstalledResource } from './resource-declarations.js'
import { getCharacterAuthorizationForLifecycle, ScopeRequiredError } from '../auth/tokens.js'
import type { PlatformCollectionStateIdentity } from './collection-state.js'
import { toPlatformResourceSubject } from './core-resources.js'
import {
  resolveInstalledResourceEligibility,
  type PlatformResourceIneligibleStatus,
} from './resource-eligibility.js'

type ResourceExecutionNoopReason = 'already-current' | PlatformResourceIneligibleStatus
type CharacterAuthorization = Awaited<ReturnType<typeof getCharacterAuthorizationForLifecycle>>
type PlatformResourceExecutionNoop = {
  readonly outcome: 'noop'
  readonly reason: ResourceExecutionNoopReason
}

export type PlatformResourceExecutionGuard =
  | PlatformResourceExecutionNoop
  | {
      readonly outcome: 'ready'
      readonly resource: PlatformInstalledResourceDescriptor
      readonly subject: PlatformResourceSubject
      readonly authorization: CharacterAuthorization | null
      readonly authorizationCharacterId: number | null
      readonly authorizationCharacterLifecycleId: string | null
    }

interface ResourceExecutionGuardOptions {
  readonly resources?: readonly PlatformInstalledResourceDescriptor[]
  readonly resolveEligibility?: typeof resolveInstalledResourceEligibility
  readonly loadCharacterAuthorization?: typeof getCharacterAuthorizationForLifecycle
}

export async function guardInstalledResourceExecution(
  identity: PlatformCollectionStateIdentity,
  options: ResourceExecutionGuardOptions = {},
): Promise<PlatformResourceExecutionGuard> {
  const resources = options.resources ?? platformResources
  const resolveEligibility = options.resolveEligibility ?? resolveInstalledResourceEligibility
  let eligibility = await resolveEligibility(identity, { resources })
  if (eligibility.status !== 'eligible') return { outcome: 'noop', reason: eligibility.status }
  if (!eligibility.due) return { outcome: 'noop', reason: 'already-current' }

  const resource = findInstalledResource(identity, resources)
  if (!resource) return { outcome: 'noop', reason: 'resource-unavailable' }
  const subject = toPlatformResourceSubject(
    identity as Parameters<typeof toPlatformResourceSubject>[0],
  )
  if (!subject) return { outcome: 'noop', reason: 'obsolete' }

  const operation = getEsiOperationContract(resource.operationId as EsiOperation)
  if (operation.authorization.kind === 'public')
    return {
      outcome: 'ready',
      resource,
      subject,
      authorization: null,
      authorizationCharacterId: null,
      authorizationCharacterLifecycleId: null,
    }

  const authorizationCharacterId =
    eligibility.authorizationCharacterId ??
    (subject.kind === 'character' ? subject.characterId : null)
  const authorizationCharacterLifecycleId =
    eligibility.authorizationCharacterLifecycleId ??
    (subject.kind === 'character' ? subject.lifecycleId : null)
  if (!authorizationCharacterId || !authorizationCharacterLifecycleId)
    return { outcome: 'noop', reason: 'authorization-required' }

  let authorization: CharacterAuthorization
  try {
    authorization = await (
      options.loadCharacterAuthorization ?? getCharacterAuthorizationForLifecycle
    )(authorizationCharacterId, authorizationCharacterLifecycleId, operation.authorization.scope)
  } catch (error) {
    return mapCharacterAuthorizationError(error, subject.kind)
  }

  const ready = {
    outcome: 'ready',
    resource,
    subject,
    authorization,
    authorizationCharacterId,
    authorizationCharacterLifecycleId,
  } as const
  if (authorization.tokenVersion === eligibility.authorizationGeneration) return ready

  eligibility = await resolveEligibility(identity, { resources })
  if (eligibility.status !== 'eligible') return { outcome: 'noop', reason: eligibility.status }
  if (!eligibility.due) return { outcome: 'noop', reason: 'already-current' }
  const refreshedAuthorizationCharacterId =
    eligibility.authorizationCharacterId ??
    (subject.kind === 'character' ? subject.characterId : null)
  const refreshedAuthorizationCharacterLifecycleId =
    eligibility.authorizationCharacterLifecycleId ??
    (subject.kind === 'character' ? subject.lifecycleId : null)
  if (
    authorization.tokenVersion !== eligibility.authorizationGeneration ||
    authorizationCharacterId !== refreshedAuthorizationCharacterId ||
    authorizationCharacterLifecycleId !== refreshedAuthorizationCharacterLifecycleId
  )
    return { outcome: 'noop', reason: 'obsolete' }

  return ready
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
