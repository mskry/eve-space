import type {
  PlatformResourceCollectionContext,
  PlatformResourceSubject,
} from '@eve-space/platform-module-contract'
import {
  isPlatformEsiUnavailableItem,
  advancePlatformCursor,
} from '@eve-space/platform-module-server'
import { mapCollectionResponse, type CollectionRequest } from './collection-response.js'
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
    const cursor =
      request.cursor ?? (request.cursorKey ? cursors[request.cursorKey] : undefined) ?? {}
    const query = request.cursorKey
      ? {
          limit: 100,
          ...(cursor.before ? { before: cursor.before } : {}),
          ...(cursor.after ? { after: cursor.after } : {}),
        }
      : undefined
    // Each request can reveal the next opaque cursor or a dependent detail request.
    // oxlint-disable-next-line no-await-in-loop
    const result = await context
      .execute(`organization-activity-${request.operation}`, {
        ...(Object.keys(request.path).length ? { path: request.path } : {}),
        ...(query ? { query } : {}),
      })
      .catch((error: unknown) => {
        if (request.validatedAt === undefined || !isPlatformEsiUnavailableItem(error)) throw error
        return null
      })
    if (!result) {
      if (request.snapshot && request.validatedAt)
        snapshots.push({
          snapshot: request.snapshot,
          validatedAt: request.validatedAt,
          replace: request.replace,
        })
      continue
    }
    const mapped = mapCollectionResponse(request, result.data, profile.id)
    if (mapped.retainedIds) retainedIds = mapped.retainedIds
    if (mapped.retainedCampaignIds) retainedCampaignIds = mapped.retainedCampaignIds
    let replace = request.replace
    if (request.cursorKey) {
      const advanced = advancePlatformCursor(cursor, mapped.cursor, mapped.count)
      replace = advanced.replaceExisting
      cursors[request.cursorKey] = advanced.checkpoint
      if (!advanced.complete) requests.push({ ...request, cursor: advanced.checkpoint })
    }
    snapshots.push(
      ...mapped.snapshots.map((snapshot) => ({
        snapshot,
        validatedAt: result.validatedAt,
        replace,
      })),
    )
    requests.unshift(
      ...mapped.requests.map((dependent) =>
        Object.assign({}, dependent, { replace, validatedAt: result.validatedAt }),
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
