import type {
  PlatformAuthenticatedSessionRouteEnv,
  PlatformCollectionStatus,
  PlatformOwnedCharacterRouteEnv,
} from '@eve-space/platform-module-contract/server'
import { zValidator } from '@eve-space/platform-module-server'
import { Hono } from 'hono'
import { z } from 'zod'
import { readActivitySnapshots } from './snapshot-reads.js'
import type { ActivitySnapshotPersistence } from './persistence.js'

const activityParams = z.object({
  activityId: z.uuid(),
  kind: z.enum(['project', 'job', 'campaign']),
})
const detailQuery = z.object({ corporationId: z.coerce.number().int().positive().optional() })
const publicResourceIds = {
  campaign: 'campaigns',
  job: 'public-jobs',
  project: 'corporation-projects',
} as const
const characterResourceIds = {
  campaign: 'character-campaigns',
  job: 'character-jobs',
  project: 'character-projects',
} as const

interface ActivityRouteCapabilities {
  readonly persistence: ActivitySnapshotPersistence
}

export function activityRoutes(capabilities: ActivityRouteCapabilities) {
  return new Hono<PlatformAuthenticatedSessionRouteEnv>().get(
    '/:kind/:activityId',
    zValidator('param', activityParams),
    zValidator('query', detailQuery),
    async (context) => {
      const { kind, activityId } = context.req.valid('param')
      const { corporationId } = context.req.valid('query')
      if (kind === 'project' && !corporationId) {
        return context.json({ message: 'A corporation is required for project detail.' }, 400)
      }
      const resourceId = publicResourceIds[kind]
      const platform = context.var.platform
      let source = await readActivitySnapshots(
        { ...capabilities, collectionStatus: platform.collectionStatus },
        platform.organization.organizationVersion,
        resourceId,
        kind === 'project'
          ? { corporationId: corporationId!, kind: 'corporation' }
          : { deploymentId: 1, kind: 'deployment' },
        activityId,
      )
      if (
        kind === 'job' &&
        corporationId &&
        !source.snapshots.some(
          (snapshot) => snapshot.id === activityId && snapshot.description !== null,
        )
      ) {
        const corporationSource = await readActivitySnapshots(
          { ...capabilities, collectionStatus: platform.collectionStatus },
          platform.organization.organizationVersion,
          'corporation-jobs',
          { corporationId, kind: 'corporation' },
          activityId,
        )
        if (corporationSource.snapshots.length > 0) {
          source = corporationSource
        }
      }
      return context.json(
        {
          activity: source.snapshots.find((snapshot) => snapshot.id === activityId) ?? null,
          objectives: source.snapshots.filter((snapshot) => snapshot.campaignId === activityId),
          organizationVersion: platform.organization.organizationVersion,
          resource: source.status,
          ...collectionFreshness(source.status),
        },
        200,
      )
    },
  )
}

export function participationRoutes(capabilities: ActivityRouteCapabilities) {
  return new Hono<PlatformOwnedCharacterRouteEnv>().get(
    '/:kind/:activityId',
    zValidator('param', activityParams),
    async (context) => {
      const { kind, activityId } = context.req.valid('param')
      const platform = context.var.platform
      const characterId = platform.authorization.characterId
      const source = await readActivitySnapshots(
        { ...capabilities, collectionStatus: platform.collectionStatus },
        platform.organization.organizationVersion,
        characterResourceIds[kind],
        { characterId, kind: 'character' },
        activityId,
      )
      return context.json(
        {
          activity:
            kind === 'job'
              ? (source.snapshots.find((snapshot) => snapshot.id === activityId) ?? null)
              : null,
          characterId,
          participation: source.snapshots
            .filter((snapshot) => snapshot.id === activityId || snapshot.campaignId === activityId)
            .map((snapshot) => ({
              activityId: snapshot.id,
              contributed: snapshot.contributed,
              committed: snapshot.committed,
            })),
          resource: source.status,
          ...collectionFreshness(source.status),
        },
        200,
      )
    },
  )
}

function collectionFreshness(status: PlatformCollectionStatus) {
  if (status.status !== 'stale') {
    return { stale: false as const }
  }
  return {
    stale: true as const,
    ...(status.validatedAt && { validatedAt: status.validatedAt }),
    ...(status.lastFailureClass && { refreshFailureClass: status.lastFailureClass }),
  }
}
