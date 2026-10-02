import type {
  PlatformAuthenticatedSessionRouteContext,
  PlatformAuthorizedOrganizationContext,
  PlatformOwnedCharacterRouteContext,
  PlatformOnDemandStructureRequester,
} from '@eve-space/platform-module-contract/server'
import { createOwnedCharacterCoreReads } from './core-read-capabilities.js'
import { createPlatformModuleCollectionStatusReads } from './module-collection-status-capabilities.js'

export const createAuthenticatedSessionModuleContext = (
  moduleId: string,
  userId: string,
  organization: PlatformAuthorizedOrganizationContext,
  sectionId?: string,
): PlatformAuthenticatedSessionRouteContext =>
  Object.freeze({
    authorization: Object.freeze({ strategy: 'authenticated-session', userId }),
    collectionStatus: createPlatformModuleCollectionStatusReads({
      moduleId,
      organizationVersion: organization.organizationVersion,
      sectionId,
    }),
    organization,
  })

export const createOwnedCharacterModuleContext = (
  moduleId: string,
  binding: Pick<
    PlatformOwnedCharacterRouteContext['authorization'],
    'userId' | 'characterId' | 'subjectLifecycleId'
  >,
  organization: PlatformAuthorizedOrganizationContext,
  sectionId?: string,
  onDemand?: PlatformOnDemandStructureRequester,
): PlatformOwnedCharacterRouteContext => {
  const authority = Object.freeze({
    ...binding,
    organizationVersion: organization.organizationVersion,
  })
  return Object.freeze({
    authorization: Object.freeze({ ...binding, strategy: 'owned-character' }),
    collectionStatus: createPlatformModuleCollectionStatusReads({
      moduleId,
      sectionId,
      organizationVersion: organization.organizationVersion,
      characters: [
        { characterId: authority.characterId, subjectLifecycleId: authority.subjectLifecycleId },
      ],
    }),
    organization,
    coreReads: createOwnedCharacterCoreReads(Object.freeze({ ...binding })),
    ...(onDemand && {
      onDemandStructure: Object.freeze({
        currentGeneration: () => onDemand.currentGeneration(authority),
        request: (structureId: number) => onDemand.request(authority, structureId),
      }),
    }),
  })
}
