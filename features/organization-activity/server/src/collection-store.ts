import type {
  PlatformResourceCollectionContext,
  PlatformResourceMaterializationContext,
  PlatformResourceSubject,
} from '@eve-space/platform-module-contract/resources'
import type { ActivityObservation } from './collection-types.js'
import type {
  ActivityCheckpointPersistence,
  ActivityMaterializationPersistence,
} from './persistence.js'

export type ResourceCollectionContext = PlatformResourceCollectionContext<
  PlatformResourceSubject,
  readonly [],
  ActivityCheckpointPersistence
>
export type ResourceMaterializationContext = PlatformResourceMaterializationContext<
  ActivityObservation,
  PlatformResourceSubject,
  ActivityMaterializationPersistence
>

export async function materializeActivityResource(context: ResourceMaterializationContext) {
  const { data, subject } = context
  const result = await context.capabilities.persistence.materializeActivityObservation({
    materializationId: globalThis.crypto.randomUUID(),
    resourceId: data.resourceId,
    subjectLifecycleId: subject.lifecycleId,
    organizationVersion: data.organizationVersion,
    authorizationGeneration: context.authorizationGeneration ?? -1,
    expectedRevision: data.expectedRevision,
    checkpoint: {
      ...data.checkpoint,
      retainedIds: data.checkpoint.retainedIds ? [...data.checkpoint.retainedIds] : undefined,
      retainedCampaignIds: data.checkpoint.retainedCampaignIds
        ? [...data.checkpoint.retainedCampaignIds]
        : undefined,
      requests: [...data.checkpoint.requests],
      cursors: { ...data.checkpoint.cursors },
    },
    snapshots: [...data.snapshots],
  })
  return result.outcome === 'obsolete' ? result : undefined
}

export async function readActivityCheckpoint(
  resourceId: string,
  context: ResourceCollectionContext,
) {
  const stored = await context.capabilities.persistence.readActivityCheckpoint({
    resourceId,
    subjectLifecycleId: context.subject.lifecycleId,
    organizationVersion: context.organizationVersion,
    authorizationGeneration: context.authorizationGeneration ?? -1,
  })
  return stored ?? undefined
}
