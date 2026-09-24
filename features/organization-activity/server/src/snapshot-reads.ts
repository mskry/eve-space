import type {
  PlatformCollectionStatus,
  PlatformCollectionStatusSubject,
  PlatformModuleCollectionStatusReads,
} from '@eve-space/platform-module-contract/server'
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
      snapshots: [],
      status: {
        authorizationGeneration: null,
        lastFailureClass: null,
        status: 'unavailable',
        validatedAt: null,
      },
    }
  }
  const result = { resourceId, snapshots: [] as readonly ActivitySnapshot[], status }
  if (!status.subjectLifecycleId || !canReadSnapshots(status, subject.kind === 'deployment')) {
    return result
  }
  const snapshots = await capabilities.persistence.readActivitySnapshots({
    activityId: activityId ?? null,
    authorizationGeneration: status.authorizationGeneration ?? -1,
    organizationVersion,
    resourceId,
    subjectLifecycleId: status.subjectLifecycleId,
  })
  return { ...result, snapshots }
}

function canReadSnapshots(status: PlatformCollectionStatus, isPublic: boolean) {
  if (status.status === 'current') {
    return true
  }
  if (status.status !== 'stale') {
    return false
  }
  if (isPublic) {
    return true
  }
  return status.lastFailureClass === 'esi-unavailable' || status.lastFailureClass === 'esi-cooldown'
}
