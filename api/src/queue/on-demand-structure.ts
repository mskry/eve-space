import type { PlatformInstalledOnDemandResourceDescriptor } from '@eve-space/platform-module-contract/installed'
import type { PlatformOnDemandStructureRequester } from '@eve-space/platform-module-contract/server'
import { getStructureAuthorization } from '../platform/structure-authority.js'
import { platformResources } from '../platform/resources.js'
import { createBullMqQueueProducer } from './bullmq-producer.js'

export const createOnDemandStructureRequester = (
  descriptor: PlatformInstalledOnDemandResourceDescriptor,
): PlatformOnDemandStructureRequester => {
  const resource = platformResources.find(
    ({ moduleId, resourceId }) =>
      moduleId === descriptor.moduleId && resourceId === descriptor.resourceId,
  )
  if (!resource) throw new Error('On-demand structure resource is missing')
  return {
    async currentGeneration(authority) {
      const authorization = await getStructureAuthorization(descriptor, authority)
      return authorization?.tokenVersion ?? null
    },
    async request(authority, structureId) {
      if (!Number.isSafeInteger(structureId) || structureId <= 0) return 'unavailable'
      const authorization = await getStructureAuthorization(descriptor, authority)
      if (!authorization) return 'unavailable'
      const producer = createBullMqQueueProducer()
      try {
        const result = await producer.enqueue({
          name: 'module-structure-refresh',
          source: 'on-demand',
          materializationIntervalSeconds: resource.materializationIntervalSeconds,
          payload: {
            moduleId: descriptor.moduleId,
            resourceId: descriptor.resourceId,
            subjectId: String(authority.characterId),
            subjectKind: 'character',
            subjectLifecycleId: authority.subjectLifecycleId,
            userId: authority.userId,
            routeId: descriptor.routeId,
            admissionScope: descriptor.admissionScope,
            organizationVersion: authority.organizationVersion,
            structureId,
            authorizationGeneration: authorization.tokenVersion,
          },
        })
        if (result.status === 'accepted') return 'accepted'
        return result.reason === 'coalesced' ? 'coalesced' : 'unavailable'
      } finally {
        await producer.close()
      }
    },
  }
}
