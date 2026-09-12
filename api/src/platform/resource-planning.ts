import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract'
import {
  assertRegisteredEsiOperation,
  getEsiOperationAuthorization,
  getEsiSetOperationConfiguration,
} from '../esi-gateway/catalog-interface.js'
import { getEsiQuotaStatuses, type EsiQuotaRequest } from '../esi-gateway/failures.js'
import type { DueInstalledResource } from './resource-eligibility.js'

export type ResourcePlanningCooldownRequest = EsiQuotaRequest

export function getResourcePlanningCooldowns(requests: readonly ResourcePlanningCooldownRequest[]) {
  return getEsiQuotaStatuses(requests)
}

export function createResourcePlanningCooldownRequest(
  candidate: DueInstalledResource,
  descriptor: PlatformInstalledResourceDescriptor,
) {
  const operationId = descriptor.batch?.operationId ?? candidate.operationId
  assertRegisteredEsiOperation(operationId)
  const authorization = getEsiOperationAuthorization(operationId)
  const authorizationCharacterId =
    candidate.authorizationCharacterId ??
    (descriptor.subjectKind === 'character' ? Number(candidate.identity.subjectId) : null)
  if (
    authorization.kind === 'character' &&
    (!authorizationCharacterId || !Number.isSafeInteger(authorizationCharacterId))
  )
    throw new Error(
      `Character-authorized resource ${descriptor.moduleId}/${descriptor.resourceId} has no authorization source`,
    )
  return {
    operation: operationId,
    ...(authorization.kind === 'character' ? { characterId: authorizationCharacterId! } : {}),
  }
}

export function getMaximumSubjectsPerResourceJob(
  resources: readonly PlatformInstalledResourceDescriptor[],
) {
  return resources.reduce((maximum, resource) => {
    if (!resource.batch) return maximum
    return Math.max(maximum, getResourceBatchMaximumItems(resource.batch.operationId))
  }, 1)
}

export function getResourceBatchMaximumItems(operationId: string) {
  assertRegisteredEsiOperation(operationId)
  if (getEsiOperationAuthorization(operationId).kind !== 'public')
    throw new Error('Resource batch operation must use a public set identity')
  return getEsiSetOperationConfiguration(operationId).maximumItems
}
