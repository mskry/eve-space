import type {
  PlatformResourceCollectionContext,
  PlatformResourceMaterializationContext,
  PlatformResourceSubject,
} from '@eve-space/platform-module-contract'
import type { ActivityObservation, Checkpoint } from './collection-types.js'

export async function materializeActivityResource(
  context: PlatformResourceMaterializationContext<ActivityObservation, PlatformResourceSubject>,
) {
  const { data, subject } = context
  const identity = [
    data.resourceId,
    subject.lifecycleId,
    data.organizationVersion,
    context.authorizationGeneration ?? -1,
  ]
  return context.capabilities.persistence.transaction(async (transaction) => {
    const [current] = await transaction.query<{ revision: number }>(
      `select revision::integer as revision from collection_checkpoints where resource_id = $1 and subject_lifecycle_id = $2
        and organization_version = $3 and authorization_generation = $4 for update`,
      identity,
    )
    if ((current?.revision ?? 0) !== data.expectedRevision) return { outcome: 'obsolete' as const }
    for (const entry of data.snapshots) {
      // Repeated activity IDs must retain their cursor-order replacement semantics.
      // oxlint-disable-next-line no-await-in-loop
      await transaction.query(
        `insert into activity_snapshots
          (resource_id, subject_lifecycle_id, organization_version, authorization_generation, activity_id, snapshot, validated_at)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7)
         on conflict (resource_id, subject_lifecycle_id, organization_version, authorization_generation, activity_id)
         do update set snapshot = excluded.snapshot, validated_at = excluded.validated_at
         where $8 and activity_snapshots.validated_at <= excluded.validated_at`,
        [...identity, entry.snapshot.id, entry.snapshot, entry.validatedAt, entry.replace],
      )
    }
    await transaction.query(
      `insert into collection_checkpoints
        (resource_id, subject_lifecycle_id, organization_version, authorization_generation, checkpoint, revision)
       values ($1, $2, $3, $4, $5::jsonb, $6)
       on conflict (resource_id, subject_lifecycle_id, organization_version, authorization_generation)
       do update set checkpoint = excluded.checkpoint, revision = excluded.revision`,
      [...identity, data.checkpoint, data.expectedRevision + 1],
    )
    if (data.checkpoint.requests.length === 0 && data.checkpoint.retainedIds)
      await transaction.query(
        `delete from activity_snapshots
        where resource_id = $1 and subject_lifecycle_id = $2 and organization_version = $3 and authorization_generation = $4
          and not (activity_id::text = any($5::text[]) or coalesce(snapshot->>'campaignId', '') = any($5::text[]))`,
        [...identity, data.checkpoint.retainedIds],
      )
    if (data.checkpoint.requests.length === 0)
      await transaction.query(
        `update activity_snapshots set validated_at = greatest(validated_at, $5::timestamptz)
        where resource_id = $1 and subject_lifecycle_id = $2 and organization_version = $3 and authorization_generation = $4`,
        [...identity, context.validatedAt],
      )
    await transaction.query(
      `delete from activity_snapshots where validated_at < now() - interval '24 hours'`,
    )
  })
}

export async function readActivityCheckpoint(
  resourceId: string,
  context: PlatformResourceCollectionContext<PlatformResourceSubject>,
) {
  const [stored] = await context.capabilities.persistence.transaction((transaction) =>
    transaction.query<{ checkpoint: Checkpoint; revision: number }>(
      `select checkpoint, revision::integer as revision from collection_checkpoints where resource_id = $1 and subject_lifecycle_id = $2
      and organization_version = $3 and authorization_generation = $4`,
      [
        resourceId,
        context.subject.lifecycleId,
        context.organizationVersion,
        context.authorizationGeneration ?? -1,
      ],
    ),
  )
  return stored
}
