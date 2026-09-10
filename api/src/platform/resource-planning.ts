import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract'
import {
  assertRegisteredEsiOperation,
  getEsiOperationContract,
} from '../esi-resilience/catalog-access.js'
import { getEsiRequestCooldowns } from '../esi-resilience/cooldowns.js'
import { characterEsiPrincipal } from '../esi-resilience/identity.js'
import { getCoordinationConnection } from '../esi-resilience/coordination-connection.js'
import type { DueInstalledResource } from './resource-eligibility.js'

export type ResourcePlanningCooldownRequest = Parameters<
  typeof getEsiRequestCooldowns
>[0]['requests'][number]

export function getResourcePlanningCooldowns(requests: readonly ResourcePlanningCooldownRequest[]) {
  return getEsiRequestCooldowns({ connection: getCoordinationConnection(), requests })
}

export function createResourcePlanningCooldownRequest(
  candidate: DueInstalledResource,
  descriptor: PlatformInstalledResourceDescriptor,
) {
  const operationId = descriptor.batch?.operationId ?? candidate.operationId
  assertRegisteredEsiOperation(operationId)
  const authorization = getEsiOperationContract(operationId).authorization
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
    ...(authorization.kind === 'character'
      ? { principal: characterEsiPrincipal(authorizationCharacterId!) }
      : {}),
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
  const contract = getEsiOperationContract(operationId)
  if (contract.authorization.kind !== 'public' || contract.identity.kind !== 'set')
    throw new Error('Resource batch operation must use a public set identity')
  return contract.identity.maximumItems
}
