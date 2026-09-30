import type { PlatformInstalledOnDemandResourceDescriptor } from '@eve-space/platform-module-contract/installed'
import type { PlatformStructureWorkIdentity } from '@eve-space/platform-module-contract/resources'
import { installedModuleOnDemandResources } from '../generated/platform/installed-module-on-demand.js'
import { processInstalledResourceRefresh } from './resource-refresh.js'
import { getStructureAuthorization } from './structure-authority.js'

export const processInstalledStructureRefresh = async (
  payload: PlatformStructureWorkIdentity,
  signal: AbortSignal,
) => {
  signal.throwIfAborted()
  const descriptors: Readonly<Record<string, PlatformInstalledOnDemandResourceDescriptor>> =
    installedModuleOnDemandResources
  const descriptor = descriptors[`${payload.moduleId}/${payload.routeId}`]
  if (descriptor?.resourceId !== payload.resourceId) return
  if (descriptor.admissionScope !== payload.admissionScope || payload.subjectKind !== 'character')
    return
  const characterId = Number(payload.subjectId)
  if (!Number.isSafeInteger(characterId) || characterId <= 0) return
  const authority = {
    userId: payload.userId,
    characterId,
    subjectLifecycleId: payload.subjectLifecycleId,
    organizationVersion: payload.organizationVersion,
  }
  const current = await getStructureAuthorization(descriptor, authority)
  if (current?.tokenVersion !== payload.authorizationGeneration) return
  const identity = {
    moduleId: payload.moduleId,
    resourceId: payload.resourceId,
    subjectKind: payload.subjectKind,
    subjectId: payload.subjectId,
    subjectLifecycleId: payload.subjectLifecycleId,
  }
  await processInstalledResourceRefresh(identity, {
    selector: { structureId: payload.structureId },
    expectedAuthorizationGeneration: payload.authorizationGeneration,
    expectedOrganizationVersion: payload.organizationVersion,
    signal,
    beforeApply: async () => {
      const rechecked = await getStructureAuthorization(descriptor, authority)
      return rechecked?.tokenVersion === payload.authorizationGeneration
    },
  })
}
