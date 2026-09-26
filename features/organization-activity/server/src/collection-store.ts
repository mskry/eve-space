import type {
  PlatformResourceCollectionContext,
  PlatformResourceMaterializationContext,
  PlatformResourceSubject,
  PlatformContinuationCheckpointRead,
} from '@eve-space/platform-module-contract/resources'
import type { ActivityOperationId, ActivityProtocol } from './activity-protocol.js'
import type { ActivityOperationMethods } from './collection-response.js'
import type { ActivityObservation, Checkpoint } from './collection-types.js'
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

const requireActivityAuthorityBinding = (context: {
  readonly subject: PlatformResourceSubject
  readonly continuationAuthorityBinding?: string
}) => {
  if (context.subject.kind === 'corporation' && !context.continuationAuthorityBinding) {
    throw new Error('Corporation collection requires an opaque authority binding')
  }
  return context.continuationAuthorityBinding
}

export async function materializeActivityResource(context: ResourceMaterializationContext) {
  const { data, subject } = context
  const authorityBinding = requireActivityAuthorityBinding(context)
  if (authorityBinding && data.checkpoint.authorityBinding !== authorityBinding) {
    throw new Error('Corporation checkpoint authority is obsolete')
  }
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
): Promise<
  PlatformContinuationCheckpointRead<Checkpoint> & { readonly authorityBinding?: string }
> {
  const authorityBinding = requireActivityAuthorityBinding(context)
  const stored = await context.capabilities.persistence.readActivityCheckpoint({
    authorizationGeneration: context.authorizationGeneration ?? -1,
    organizationVersion: context.organizationVersion,
    resourceId,
    subjectLifecycleId: context.subject.lifecycleId,
  })
  const matches = !authorityBinding || stored?.checkpoint.authorityBinding === authorityBinding
  return {
    authorityBinding,
    checkpoint: matches ? (stored?.checkpoint ?? null) : null,
    expectedRevision: stored?.revision ?? 0,
    needsReset: Boolean(authorityBinding && stored && !matches),
  }
}
