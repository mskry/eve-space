import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract'
import { CharacterTokenNotFoundError } from '../auth-store.js'
import { getEsiOperationContract, type EsiOperation } from '../esi-resilience/catalog.js'
import { installedModuleResources } from '../generated/platform/installed-module-worker.js'
import { findInstalledResource } from './resource-declarations.js'
import { getCharacterAuthorizationForLifecycle, ScopeRequiredError } from '../token-service.js'
import type { PlatformCollectionStateIdentity } from './collection-state.js'
import {
  resolveInstalledResourceEligibility,
  type PlatformResourceIneligibleStatus,
} from './resource-eligibility.js'

type ResourceExecutionNoopReason = 'already-current' | PlatformResourceIneligibleStatus
type CharacterAuthorization = Awaited<ReturnType<typeof getCharacterAuthorizationForLifecycle>>

export type PlatformResourceExecutionGuard =
  | { readonly outcome: 'noop'; readonly reason: ResourceExecutionNoopReason }
  | {
      readonly outcome: 'ready'
      readonly resource: PlatformInstalledResourceDescriptor
      readonly characterId: number
      readonly authorization: CharacterAuthorization | null
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
  const resources = options.resources ?? installedModuleResources
  const resolveEligibility = options.resolveEligibility ?? resolveInstalledResourceEligibility
  let eligibility = await resolveEligibility(identity, { resources })
  if (eligibility.status !== 'eligible') return { outcome: 'noop', reason: eligibility.status }
  if (!eligibility.due) return { outcome: 'noop', reason: 'already-current' }

  // Everything below resolves the subject as a character ID and takes the character
  // authorization path, so a resource declared for any other subject kind cannot run here.
  const resource =
    identity.subjectKind === 'character' ? findInstalledResource(identity, resources) : undefined
  if (!resource) return { outcome: 'noop', reason: 'resource-unavailable' }

  const characterId = Number(identity.subjectId)
  if (!Number.isSafeInteger(characterId) || characterId <= 0)
    return { outcome: 'noop', reason: 'obsolete' }

  const operation = getEsiOperationContract(resource.operationId as EsiOperation)
  if (operation.authorization.kind === 'public')
    return { outcome: 'ready', resource, characterId, authorization: null }

  let authorization: CharacterAuthorization
  try {
    authorization = await (
      options.loadCharacterAuthorization ?? getCharacterAuthorizationForLifecycle
    )(characterId, identity.subjectLifecycleId, operation.authorization.scope)
  } catch (error) {
    if (error instanceof ScopeRequiredError)
      return { outcome: 'noop', reason: 'authorization-required' }
    if (error instanceof CharacterTokenNotFoundError) return { outcome: 'noop', reason: 'obsolete' }
    throw error
  }

  if (authorization.tokenVersion !== eligibility.authorizationGeneration) {
    eligibility = await resolveEligibility(identity, { resources })
    if (eligibility.status !== 'eligible') return { outcome: 'noop', reason: eligibility.status }
    if (!eligibility.due) return { outcome: 'noop', reason: 'already-current' }
    if (authorization.tokenVersion !== eligibility.authorizationGeneration)
      return { outcome: 'noop', reason: 'obsolete' }
  }

  return { outcome: 'ready', resource, characterId, authorization }
}
