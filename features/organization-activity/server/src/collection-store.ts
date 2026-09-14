import type {
  PlatformResourceCollectionContext,
  PlatformResourceMaterializationContext,
  PlatformResourceSubject,
} from '@eve-space/platform-module-contract'
import type { ActivityObservation } from './collection-types.js'
import type {
  ActivityCheckpointPersistence,
  ActivityMaterializationPersistence,
} from './persistence.js'

type ResourceCollectionContext = PlatformResourceCollectionContext<
  PlatformResourceSubject,
  readonly [],
  ActivityCheckpointPersistence
>
type ResourceMaterializationContext = PlatformResourceMaterializationContext<
  ActivityObservation,
  PlatformResourceSubject,
  ActivityMaterializationPersistence
>

export type ActivityCollectionContext = ResourceCollectionContext
export type ActivityMaterializationContext = ResourceMaterializationContext

export async function materializeActivityResource(context: ActivityMaterializationContext) {
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
  context: ActivityCollectionContext,
) {
  const stored = await context.capabilities.persistence.readActivityCheckpoint({
    resourceId,
    subjectLifecycleId: context.subject.lifecycleId,
    organizationVersion: context.organizationVersion,
    authorizationGeneration: context.authorizationGeneration ?? -1,
  })
  return stored ?? undefined
}
