import type { PlatformResourceImplementation } from '@eve-space/platform-module-contract/resources'
import { eq, inArray } from 'drizzle-orm'
import type { DatabaseTransaction } from '../db/client.js'
import {
  deploymentModules,
  platformCollectionState,
  platformResourcePurgeWork,
} from '../db/schema.js'
import { installedModuleResources } from '../generated/platform/installed-module-worker.js'

const maintainableInstalledResources = installedModuleResources.filter((resource) => {
  const implementation = resource.implementation as PlatformResourceImplementation
  return Boolean(implementation.maintain)
})
const maintainableResourceKeys = new Set(
  maintainableInstalledResources.map(({ moduleId, resourceId }) => `${moduleId}/${resourceId}`),
)

export async function enqueueInstalledResourceLifecyclePurges(
  transaction: DatabaseTransaction,
  subjectLifecycleId: string,
) {
  const authorities = await transaction
    .select({
      authorizationGeneration: platformCollectionState.authorizationGeneration,
      characterId: platformCollectionState.subjectId,
      characterLifecycleId: platformCollectionState.subjectLifecycleId,
      disclosureVersion: platformCollectionState.disclosureVersion,
      managedMemberLifecycleId: platformCollectionState.managedMemberLifecycleId,
      moduleId: platformCollectionState.moduleId,
      organizationVersion: platformCollectionState.organizationVersion,
      resourceId: platformCollectionState.resourceId,
      sectionActivationVersion: platformCollectionState.sectionActivationVersion,
      targetUserId: platformCollectionState.targetUserId,
    })
    .from(platformCollectionState)
    .where(eq(platformCollectionState.subjectLifecycleId, subjectLifecycleId))
  const work = authorities.flatMap((authority) => {
    if (!maintainableResourceKeys.has(`${authority.moduleId}/${authority.resourceId}`)) {
      return []
    }
    if (
      authority.targetUserId === null ||
      authority.organizationVersion === null ||
      authority.managedMemberLifecycleId === null ||
      authority.authorizationGeneration === null ||
      authority.disclosureVersion === null ||
      authority.sectionActivationVersion === null
    ) {
      return []
    }
    const characterId = Number(authority.characterId)
    if (!Number.isSafeInteger(characterId) || characterId < 1) {
      return []
    }
    return [
      {
        authorizationGeneration: authority.authorizationGeneration,
        characterId,
        characterLifecycleId: authority.characterLifecycleId,
        disclosureVersion: authority.disclosureVersion,
        managedMemberLifecycleId: authority.managedMemberLifecycleId,
        mode: 'authority' as const,
        moduleId: authority.moduleId,
        organizationVersion: authority.organizationVersion,
        resourceId: authority.resourceId,
        sectionActivationVersion: authority.sectionActivationVersion,
        targetUserId: authority.targetUserId,
      },
    ]
  })
  if (work.length > 0) {
    await transaction.insert(platformResourcePurgeWork).values(work)
  }
}

export async function enqueueInstalledResourceAccountPurges(
  transaction: DatabaseTransaction,
  targetUserId: string,
) {
  const moduleIds = [...new Set(maintainableInstalledResources.map(({ moduleId }) => moduleId))]
  if (moduleIds.length === 0) {
    return
  }
  const installedModules = await transaction
    .select({ moduleId: deploymentModules.moduleId })
    .from(deploymentModules)
    .where(inArray(deploymentModules.moduleId, moduleIds))
  const installedModuleIds = new Set(installedModules.map(({ moduleId }) => moduleId))
  const work = maintainableInstalledResources
    .filter(({ moduleId }) => installedModuleIds.has(moduleId))
    .map((resource) => ({
      mode: 'account' as const,
      moduleId: resource.moduleId,
      resourceId: resource.resourceId,
      targetUserId,
    }))
  if (work.length > 0) {
    await transaction.insert(platformResourcePurgeWork).values(work)
  }
}
