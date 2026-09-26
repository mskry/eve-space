import {
  isPlatformEsiUnavailableItem,
  advancePlatformCursor,
  type PlatformCursorCheckpoint,
} from '@eve-space/platform-module-server'
import {
  executeCollectionOperation,
  type CollectionCursorQuery,
  type CollectionRequest,
  type CollectionResponse,
} from './collection-response.js'
import type {
  ActivityResourceProfile,
  ActivityObservation,
  Checkpoint,
  CollectedSnapshot,
} from './collection-types.js'
import { readActivityCheckpoint, type ActivityCollectionContext } from './collection-store.js'

type StoredActivityCheckpoint = Awaited<ReturnType<typeof readActivityCheckpoint>>

const resetActivityObservation = (
  profile: ActivityResourceProfile,
  context: ActivityCollectionContext,
  stored: StoredActivityCheckpoint,
) => ({
  complete: false,
  data: {
    checkpoint: {
      authorityBinding: stored.authorityBinding,
      cursors: {},
      initialized: false,
      requests: [],
      retainedIds: [],
      retainedCampaignIds: [],
    },
    expectedRevision: stored.expectedRevision,
    organizationVersion: context.organizationVersion,
    resourceId: profile.id,
    snapshots: [],
  } satisfies ActivityObservation,
})

const workingCheckpoint = (stored: StoredActivityCheckpoint): Checkpoint => {
  if (stored.checkpoint?.initialized) return stored.checkpoint
  return {
    authorityBinding: stored.authorityBinding,
    cursors: stored.checkpoint?.cursors ?? {},
    initialized: false,
    requests: stored.checkpoint?.requests ?? [],
  }
}

const initialRetention = (checkpoint: Checkpoint) => ({
  retainedIds: checkpoint.initialized ? checkpoint.retainedIds : undefined,
  retainedCampaignIds: checkpoint.initialized ? checkpoint.retainedCampaignIds : undefined,
})

export async function collectActivityResource(
  profile: ActivityResourceProfile,
  context: ActivityCollectionContext,
) {
  const stored = await readActivityCheckpoint(profile.id, context)
  if (stored.needsReset) return resetActivityObservation(profile, context, stored)
  const checkpoint = workingCheckpoint(stored)
  let { retainedIds, retainedCampaignIds } = initialRetention(checkpoint)
  const cursors = { ...checkpoint.cursors }
  const requests = [...checkpoint.requests]
  const snapshots: CollectedSnapshot[] = []
  if (requests.length === 0) {
    requests.push(initialRequest(profile, context, checkpoint.initialized))
  }

  for (let attempt = 0; attempt < context.requestBudget && requests.length > 0; attempt++) {
    const request = requests.shift()!
    // Each request can reveal the next opaque cursor or a dependent detail request.
    // oxlint-disable-next-line no-await-in-loop
    const { cursor, result } = await executeCollectionRequest(request, profile, cursors, context)
    if (!result) {
      restoreUnavailableSnapshot(request, snapshots)
      continue
    }
    const mapped = result.response
    if (mapped.retainedIds) {
      retainedIds = mapped.retainedIds
    }
    if (mapped.retainedCampaignIds) {
      retainedCampaignIds = mapped.retainedCampaignIds
    }
    const replace = advanceRequestCursor(request, cursor, mapped, cursors, requests)
    snapshots.push(
      ...mapped.snapshots.map((snapshot) => ({
        replace,
        snapshot,
        validatedAt: result.validatedAt,
      })),
    )
    requests.unshift(
      ...mapped.requests.map((dependent) =>
        scheduleRequest(dependent, replace, result.validatedAt),
      ),
    )
  }
  return {
    complete: requests.length === 0,
    data: {
      checkpoint: {
        ...(checkpoint.authorityBinding && { authorityBinding: checkpoint.authorityBinding }),
        cursors,
        initialized: true,
        requests,
        ...(retainedCampaignIds !== undefined && { retainedCampaignIds }),
        ...(retainedIds !== undefined && { retainedIds }),
      },
      expectedRevision: stored.expectedRevision,
      organizationVersion: context.organizationVersion,
      resourceId: profile.id,
      snapshots,
    } satisfies ActivityObservation,
  }
}

async function executeCollectionRequest(
  request: CollectionRequest,
  profile: ActivityResourceProfile,
  cursors: Readonly<Record<string, PlatformCursorCheckpoint>>,
  context: ActivityCollectionContext,
) {
  const cursor =
    request.cursor ?? (request.cursorKey ? cursors[request.cursorKey] : undefined) ?? {}
  const result = await executeCollectionOperation({
    operations: context.operations,
    profile: profile.id,
    query: createCursorQuery(request.cursorKey, cursor),
    request,
  }).catch((error: unknown) => {
    if (request.validatedAt === undefined || !isPlatformEsiUnavailableItem(error)) {
      throw error
    }
    return null
  })
  return { cursor, result }
}

function createCursorQuery(
  cursorKey: string | undefined,
  cursor: PlatformCursorCheckpoint,
): CollectionCursorQuery | undefined {
  if (!cursorKey) {
    return undefined
  }
  return {
    limit: 100,
    ...(cursor.before && { before: cursor.before }),
    ...(cursor.after && { after: cursor.after }),
  }
}

function restoreUnavailableSnapshot(request: CollectionRequest, snapshots: CollectedSnapshot[]) {
  if (!request.snapshot || !request.validatedAt) {
    return
  }
  snapshots.push({
    replace: request.replace,
    snapshot: request.snapshot,
    validatedAt: request.validatedAt,
  })
}

function advanceRequestCursor(
  request: CollectionRequest,
  cursor: PlatformCursorCheckpoint,
  mapped: CollectionResponse,
  cursors: Record<string, PlatformCursorCheckpoint>,
  requests: CollectionRequest[],
) {
  if (!request.cursorKey) {
    return request.replace
  }
  const advanced = advancePlatformCursor(cursor, mapped.cursor, mapped.count)
  cursors[request.cursorKey] = advanced.checkpoint
  if (!advanced.complete) {
    requests.push({ ...request, cursor: advanced.checkpoint })
  }
  return advanced.replaceExisting
}

function initialRequest(
  profile: ActivityResourceProfile,
  context: ActivityCollectionContext,
  initialized: boolean,
): CollectionRequest {
  const path: Record<string, number> = {}
  if (context.subject.kind === 'character') {
    path.character_id = context.subject.characterId
  }
  if (context.subject.kind === 'corporation') {
    path.corporation_id = context.subject.corporationId
  }
  if (profile.id === 'character-projects') {
    if (!context.corporationId) {
      throw new Error('Project contribution requires corporation affiliation')
    }
    path.corporation_id = context.corporationId
  }
  return {
    cursorKey: profile.paginated ? 'root' : undefined,
    list: profile.list,
    operation: profile.rootOperation,
    path,
    replace: initialized,
  }
}

function scheduleRequest(
  request: CollectionRequest,
  replace: boolean,
  validatedAt: string,
): CollectionRequest {
  return { ...request, replace, validatedAt }
}
