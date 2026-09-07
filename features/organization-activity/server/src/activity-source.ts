import type { PlatformCollectionStatus } from '@eve-space/platform-module-contract'
import type { ActivitySnapshot } from './snapshot.js'

export interface ActivitySourceRead {
  readonly resourceId: string
  readonly status: PlatformCollectionStatus
  readonly snapshots: readonly ActivitySnapshot[]
}
