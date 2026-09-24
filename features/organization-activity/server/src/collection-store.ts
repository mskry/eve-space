import type {
  PlatformResourceCollectionContext,
  PlatformResourceMaterializationContext,
  PlatformResourceSubject,
} from '@eve-space/platform-module-contract/resources'
import type { ActivityOperationId, ActivityProtocol } from './activity-protocol.js'
import type { ActivityOperationMethods } from './collection-response.js'
import type { ActivityObservation } from './collection-types.js'
import type {
  ActivityCheckpointPersistence,
  ActivityMaterializationPersistence,
} from './persistence.js'

export type ActivityCollectionContext = Omit<
  PlatformResourceCollectionContext<
    PlatformResourceSubject,
    ActivityProtocol<ActivityOperationId>,
    readonly [],
    ActivityCheckpointPersistence
  >,
  'operations'
> & { readonly operations: ActivityOperationMethods }
export type ResourceMaterializationContext = PlatformResourceMaterializationContext<
  ActivityObservation,
  PlatformResourceSubject,
  ActivityMaterializationPersistence
>

export async function materializeActivityResource(context: ResourceMaterializationContext) {
  const { data, subject } = context
  const result = await context.capabilities.persistence.materializeActivityObservation({
    authorizationGeneration: context.authorizationGeneration ?? -1,
    checkpoint: {
      ...data.checkpoint,
      cursors: { ...data.checkpoint.cursors },
      requests: [...data.checkpoint.requests],
      retainedCampaignIds: data.checkpoint.retainedCampaignIds
        ? [...data.checkpoint.retainedCampaignIds]
        : undefined,
      retainedIds: data.checkpoint.retainedIds ? [...data.checkpoint.retainedIds] : undefined,
    },
    expectedRevision: data.expectedRevision,
    materializationId: globalThis.crypto.randomUUID(),
    organizationVersion: data.organizationVersion,
    resourceId: data.resourceId,
    snapshots: [...data.snapshots],
    subjectLifecycleId: subject.lifecycleId,
  })
  return result.outcome === 'obsolete' ? result : undefined
}

export async function readActivityCheckpoint(
  resourceId: string,
  context: ActivityCollectionContext,
) {
  const stored = await context.capabilities.persistence.readActivityCheckpoint({
    authorizationGeneration: context.authorizationGeneration ?? -1,
    organizationVersion: context.organizationVersion,
    resourceId,
    subjectLifecycleId: context.subject.lifecycleId,
  })
  return stored ?? undefined
}
