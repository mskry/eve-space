import type {
  PlatformResourceCollectionContext,
  PlatformResourceSubject,
} from '@eve-space/platform-module-contract'
import {
  isPlatformEsiUnavailableItem,
  advancePlatformCursor,
  type PlatformCursorCheckpoint,
} from '@eve-space/platform-module-server'
import {
  mapCollectionResponse,
  type CollectionRequest,
  type CollectionResponse,
} from './collection-response.js'
import type {
  ActivityResourceProfile,
  ActivityObservation,
  CollectedSnapshot,
} from './collection-types.js'
import { readActivityCheckpoint } from './collection-store.js'

export async function collectActivityResource(
  profile: ActivityResourceProfile,
  context: PlatformResourceCollectionContext<PlatformResourceSubject>,
) {
  const stored = await readActivityCheckpoint(profile.id, context)
  const checkpoint = stored?.checkpoint ?? { initialized: false, requests: [], cursors: {} }
  let retainedIds = checkpoint.retainedIds
  let retainedCampaignIds = checkpoint.retainedCampaignIds
  const cursors = { ...checkpoint.cursors }
  const requests = [...checkpoint.requests]
  const snapshots: CollectedSnapshot[] = []
  if (requests.length === 0) requests.push(initialRequest(profile, context, checkpoint.initialized))

  for (let attempt = 0; attempt < context.requestBudget && requests.length > 0; attempt++) {
    const request = requests.shift()!
    // Each request can reveal the next opaque cursor or a dependent detail request.
    // oxlint-disable-next-line no-await-in-loop
    const { cursor, result } = await executeCollectionRequest(request, cursors, context)
    if (!result) {
      restoreUnavailableSnapshot(request, snapshots)
      continue
    }
    const mapped = mapCollectionResponse(request, result.data, profile.id)
    if (mapped.retainedIds) retainedIds = mapped.retainedIds
    if (mapped.retainedCampaignIds) retainedCampaignIds = mapped.retainedCampaignIds
    const replace = advanceRequestCursor(request, cursor, mapped, cursors, requests)
    snapshots.push(
      ...mapped.snapshots.map((snapshot) => ({
        snapshot,
        validatedAt: result.validatedAt,
        replace,
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
      resourceId: profile.id,
      expectedRevision: stored?.revision ?? 0,
      organizationVersion: context.organizationVersion,
      checkpoint: { initialized: true, requests, cursors, retainedIds, retainedCampaignIds },
      snapshots,
    } satisfies ActivityObservation,
  }
}

async function executeCollectionRequest(
  request: CollectionRequest,
  cursors: Readonly<Record<string, PlatformCursorCheckpoint>>,
  context: PlatformResourceCollectionContext<PlatformResourceSubject>,
) {
  const cursor =
    request.cursor ?? (request.cursorKey ? cursors[request.cursorKey] : undefined) ?? {}
  const query = createCursorQuery(request.cursorKey, cursor)
  const result = await context
    .execute(`organization-activity-${request.operation}`, {
      ...(Object.keys(request.path).length ? { path: request.path } : {}),
      ...(query ? { query } : {}),
    })
    .catch((error: unknown) => {
      if (request.validatedAt === undefined || !isPlatformEsiUnavailableItem(error)) throw error
      return null
    })
  return { cursor, result }
}

function createCursorQuery(cursorKey: string | undefined, cursor: PlatformCursorCheckpoint) {
  if (!cursorKey) return undefined
  return {
    limit: 100,
    ...(cursor.before ? { before: cursor.before } : {}),
    ...(cursor.after ? { after: cursor.after } : {}),
  }
}

function restoreUnavailableSnapshot(request: CollectionRequest, snapshots: CollectedSnapshot[]) {
  if (!request.snapshot || !request.validatedAt) return
  snapshots.push({
    snapshot: request.snapshot,
    validatedAt: request.validatedAt,
    replace: request.replace,
  })
}

function advanceRequestCursor(
  request: CollectionRequest,
  cursor: PlatformCursorCheckpoint,
  mapped: CollectionResponse,
  cursors: Record<string, PlatformCursorCheckpoint>,
  requests: CollectionRequest[],
) {
  if (!request.cursorKey) return request.replace
  const advanced = advancePlatformCursor(cursor, mapped.cursor, mapped.count)
  cursors[request.cursorKey] = advanced.checkpoint
  if (!advanced.complete) requests.push({ ...request, cursor: advanced.checkpoint })
  return advanced.replaceExisting
}

function initialRequest(
  profile: ActivityResourceProfile,
  context: PlatformResourceCollectionContext<PlatformResourceSubject>,
  initialized: boolean,
): CollectionRequest {
  const path: Record<string, number> = {}
  if (context.subject.kind === 'character') path.character_id = context.subject.characterId
  if (context.subject.kind === 'corporation') path.corporation_id = context.subject.corporationId
  if (profile.id === 'character-projects') {
    if (!context.corporationId)
      throw new Error('Project contribution requires corporation affiliation')
    path.corporation_id = context.corporationId
  }
  return {
    operation: profile.rootOperation,
    path,
    list: profile.list,
    cursorKey: profile.paginated ? 'root' : undefined,
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
