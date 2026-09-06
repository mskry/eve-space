import { createHash } from 'node:crypto'
import { env } from '../env.js'
import {
  collectionStateIdentityJson,
  platformCollectionStateIdentitySchema,
  type PlatformCollectionStateIdentity,
} from '../platform/collection-state.js'
import {
  platformResourceBatchPayloadSchema,
  type PlatformResourceBatchPayload,
} from '../platform/resource-batch-contract.js'

const platformResourceBatchJobPayloadSchema = platformResourceBatchPayloadSchema.safeExtend({
  subjects: platformResourceBatchPayloadSchema.shape.subjects.max(
    env.QUEUE_RESOURCE_PLANNER_PAGE_SIZE,
  ),
})

export type PlatformResourceBatchJobPayload = PlatformResourceBatchPayload

export const resourceRefreshJobContract = {
  name: 'resource-refresh',
  payload: platformCollectionStateIdentitySchema,
  attempts: 1,
  operationIdentity: resourceRefreshJobId,
} as const

export const resourceBatchJobContract = {
  name: 'resource-batch',
  payload: platformResourceBatchJobPayloadSchema,
  attempts: 1,
  operationIdentity: resourceBatchJobId,
} as const

export function resourceRefreshJobId(identity: PlatformCollectionStateIdentity) {
  const parsed = platformCollectionStateIdentitySchema.parse(identity)
  const digest = createHash('sha256').update(collectionStateIdentityJson(parsed)).digest('hex')
  return `resource-refresh-${digest}`
}

export function resourceBatchJobId(payload: PlatformResourceBatchJobPayload) {
  const parsed = platformResourceBatchJobPayloadSchema.parse(payload)
  const digest = createHash('sha256')
    .update(JSON.stringify([parsed.moduleId, parsed.resourceId, parsed.subjectKind]))
    .digest('hex')
  return `resource-batch-${digest}`
}
