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
      moduleId: platformCollectionState.moduleId,
      resourceId: platformCollectionState.resourceId,
      targetUserId: platformCollectionState.targetUserId,
      organizationVersion: platformCollectionState.organizationVersion,
      managedMemberLifecycleId: platformCollectionState.managedMemberLifecycleId,
      characterId: platformCollectionState.subjectId,
      characterLifecycleId: platformCollectionState.subjectLifecycleId,
      authorizationGeneration: platformCollectionState.authorizationGeneration,
      disclosureVersion: platformCollectionState.disclosureVersion,
      sectionActivationVersion: platformCollectionState.sectionActivationVersion,
    })
    .from(platformCollectionState)
    .where(eq(platformCollectionState.subjectLifecycleId, subjectLifecycleId))
  const work = authorities.flatMap((authority) => {
    if (!maintainableResourceKeys.has(`${authority.moduleId}/${authority.resourceId}`)) return []
    if (
      authority.targetUserId === null ||
      authority.organizationVersion === null ||
      authority.managedMemberLifecycleId === null ||
      authority.authorizationGeneration === null ||
      authority.disclosureVersion === null ||
      authority.sectionActivationVersion === null
    )
      return []
    const characterId = Number(authority.characterId)
    if (!Number.isSafeInteger(characterId) || characterId < 1) return []
    return [
      {
        moduleId: authority.moduleId,
        resourceId: authority.resourceId,
        mode: 'authority' as const,
        targetUserId: authority.targetUserId,
        organizationVersion: authority.organizationVersion,
        managedMemberLifecycleId: authority.managedMemberLifecycleId,
        characterId,
        characterLifecycleId: authority.characterLifecycleId,
        authorizationGeneration: authority.authorizationGeneration,
        disclosureVersion: authority.disclosureVersion,
        sectionActivationVersion: authority.sectionActivationVersion,
      },
    ]
  })
  if (work.length > 0) await transaction.insert(platformResourcePurgeWork).values(work)
}

export async function enqueueInstalledResourceAccountPurges(
  transaction: DatabaseTransaction,
  targetUserId: string,
) {
  const moduleIds = [...new Set(maintainableInstalledResources.map(({ moduleId }) => moduleId))]
  if (moduleIds.length === 0) return
  const installedModules = await transaction
    .select({ moduleId: deploymentModules.moduleId })
    .from(deploymentModules)
    .where(inArray(deploymentModules.moduleId, moduleIds))
  const installedModuleIds = new Set(installedModules.map(({ moduleId }) => moduleId))
  const work = maintainableInstalledResources
    .filter(({ moduleId }) => installedModuleIds.has(moduleId))
    .map((resource) => ({
      moduleId: resource.moduleId,
      resourceId: resource.resourceId,
      mode: 'account' as const,
      targetUserId,
    }))
  if (work.length > 0) await transaction.insert(platformResourcePurgeWork).values(work)
}
