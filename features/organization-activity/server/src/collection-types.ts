import type { PlatformCursorCheckpoint } from '@eve-space/platform-module-server'
import type { CollectionRequest } from './collection-response.js'
import type { ActivitySnapshot } from './snapshot.js'

export interface ActivityResourceProfile {
  readonly id: string
  readonly rootOperation: string
  readonly list?: string
  readonly paginated: boolean
}

export interface Checkpoint {
  readonly retainedIds?: readonly string[]
  readonly retainedCampaignIds?: readonly string[]
  readonly initialized: boolean
  readonly requests: readonly CollectionRequest[]
  readonly cursors: Readonly<Record<string, PlatformCursorCheckpoint>>
}

export interface CollectedSnapshot {
  readonly snapshot: ActivitySnapshot
  readonly validatedAt: string
  readonly replace: boolean
}

export interface ActivityObservation {
  readonly resourceId: string
  readonly expectedRevision: number
  readonly organizationVersion: number
  readonly checkpoint: Checkpoint
  readonly snapshots: readonly CollectedSnapshot[]
}
