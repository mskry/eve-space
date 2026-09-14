import type {
  PlatformCollectionStatus,
  PlatformCollectionStatusSubject,
  PlatformModuleCollectionStatusReads,
} from '@eve-space/platform-module-contract'
import type { ActivitySnapshot } from './snapshot.js'
import type { ActivitySourceRead } from './activity-source.js'
import type { ActivitySnapshotPersistence } from './persistence.js'

export async function readActivitySnapshots(
  capabilities: {
    readonly persistence: ActivitySnapshotPersistence
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
  const snapshots = await capabilities.persistence.readActivitySnapshots({
    resourceId,
    subjectLifecycleId: status.subjectLifecycleId,
    organizationVersion,
    authorizationGeneration: status.authorizationGeneration ?? -1,
    activityId: activityId ?? null,
  })
  return { ...result, snapshots }
}

function canReadSnapshots(status: PlatformCollectionStatus, isPublic: boolean) {
  if (status.status === 'current') return true
  if (status.status !== 'stale') return false
  if (isPublic) return true
  return status.lastFailureClass === 'esi-unavailable' || status.lastFailureClass === 'esi-cooldown'
}
