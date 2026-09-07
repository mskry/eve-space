import type {
  PlatformCollectionStatus,
  PlatformCollectionStatusSubject,
  PlatformModuleCollectionStatusReads,
  PlatformModulePersistence,
  PlatformModuleResourceTransaction,
} from '@eve-space/platform-module-contract'
import type { ActivitySnapshot } from './snapshot.js'
import type { ActivitySourceRead } from './activity-source.js'

export async function readActivitySnapshots(
  capabilities: {
    readonly persistence: PlatformModulePersistence<PlatformModuleResourceTransaction>
    readonly collectionStatus: PlatformModuleCollectionStatusReads
  },
  organizationVersion: number,
  resourceId: string,
  subject: PlatformCollectionStatusSubject,
  activityId?: string,
): Promise<ActivitySourceRead> {
  let status: PlatformCollectionStatus
  try {
    status = await capabilities.collectionStatus.read(resourceId, subject)
  } catch {
    return {
      resourceId,
      status: {
        status: 'unavailable',
        validatedAt: null,
        authorizationGeneration: null,
        lastFailureClass: null,
      },
      snapshots: [],
    }
  }
  const result = { resourceId, status, snapshots: [] as readonly ActivitySnapshot[] }
  if (!status.subjectLifecycleId || !canReadSnapshots(status, subject.kind === 'deployment'))
    return result
  const rows = await capabilities.persistence.transaction((transaction) =>
    transaction.query<{ snapshot: ActivitySnapshot }>(
      `select snapshot from activity_snapshots
     where resource_id = $1 and subject_lifecycle_id = $2 and organization_version = $3
       and authorization_generation = $4
       and validated_at >= now() - interval '1 hour'
       and ($5::text is null or activity_id::text = $5 or snapshot->>'campaignId' = $5)
     order by (activity_id::text = $5) desc, activity_id limit 100`,
      [
        resourceId,
        status.subjectLifecycleId,
        organizationVersion,
        status.authorizationGeneration ?? -1,
        activityId ?? null,
      ],
    ),
  )
  return { ...result, snapshots: rows.map(({ snapshot }) => snapshot) }
}

function canReadSnapshots(status: PlatformCollectionStatus, isPublic: boolean) {
  if (status.status === 'current') return true
  if (status.status !== 'stale') return false
  if (isPublic) return true
  return status.lastFailureClass === 'esi-unavailable' || status.lastFailureClass === 'esi-cooldown'
}
