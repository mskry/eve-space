import type { PlatformInstalledOnDemandResourceDescriptor } from '@eve-space/platform-module-contract/installed'
import type { PlatformOnDemandStructureAuthority } from '@eve-space/platform-module-contract/server'
import { findOwnedCharacter } from '../auth/character-lifecycle.js'
import { CharacterTokenNotFoundError } from '../auth/character-token-store.js'
import { ScopeRequiredError } from '../auth/token-errors.js'
import { getCharacterAuthorizationForLifecycle } from '../auth/tokens.js'
import {
  assertRegisteredEsiOperation,
  getEsiOperationAuthorization,
} from '../esi-gateway/catalog-interface.js'
import { authorizeOrganizationContribution } from '../organization/module-authorization.js'
import { loadOrganizationSessionContext } from '../organization/session-context.js'
import { platformResources } from './resources.js'

const resolveStructureScope = (descriptor: PlatformInstalledOnDemandResourceDescriptor) => {
  const resource = platformResources.find(
    ({ moduleId, resourceId }) =>
      moduleId === descriptor.moduleId && resourceId === descriptor.resourceId,
  )
  if (
    resource?.subjectKind !== 'character' ||
    resource.eligibility.kind !== 'current-owned-character' ||
    resource.scheduled !== false
  )
    throw new Error('On-demand structure resource is not installed')
  assertRegisteredEsiOperation(resource.operationId)
  const authorization = getEsiOperationAuthorization(resource.operationId)
  if (authorization.kind !== 'oauth') throw new Error('Structure resource requires OAuth')
  return authorization.requiredScope
}

export const getStructureAuthorization = async (
  descriptor: PlatformInstalledOnDemandResourceDescriptor,
  authority: PlatformOnDemandStructureAuthority,
) => {
  const character = await findOwnedCharacter(authority.userId, authority.characterId)
  if (character?.subjectLifecycleId !== authority.subjectLifecycleId) return null
  const organization = await loadOrganizationSessionContext(authority.userId)
  if (organization.organizationVersion !== authority.organizationVersion) return null
  const admission = await authorizeOrganizationContribution(
    authority.userId,
    organization,
    descriptor,
  )
  if (!admission.authorized || admission.context.entitlementScope !== 'all') return null
  try {
    return await getCharacterAuthorizationForLifecycle(
      authority.characterId,
      authority.subjectLifecycleId,
      resolveStructureScope(descriptor),
    )
  } catch (error) {
    if (error instanceof ScopeRequiredError || error instanceof CharacterTokenNotFoundError) {
      return null
    }
    throw error
  }
}
