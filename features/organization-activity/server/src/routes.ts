import type {
  PlatformAuthenticatedSessionRouteEnv,
  PlatformModuleResourceTransaction,
  PlatformModuleRouteCapabilities,
  PlatformOwnedCharacterRouteEnv,
} from '@eve-space/platform-module-contract'
import { zValidator } from '@eve-space/platform-module-server'
import { Hono } from 'hono'
import { z } from 'zod'
import { readActivitySnapshots } from './snapshot-reads.js'

const activityParams = z.object({
  kind: z.enum(['project', 'job', 'campaign']),
  activityId: z.uuid(),
})
const detailQuery = z.object({ corporationId: z.coerce.number().int().positive().optional() })
const publicResourceIds = {
  project: 'corporation-projects',
  job: 'public-jobs',
  campaign: 'campaigns',
} as const
const characterResourceIds = {
  project: 'character-projects',
  job: 'character-jobs',
  campaign: 'character-campaigns',
} as const

export function activityRoutes(
  capabilities: PlatformModuleRouteCapabilities<PlatformModuleResourceTransaction>,
) {
  return new Hono<PlatformAuthenticatedSessionRouteEnv>().get(
    '/:kind/:activityId',
    zValidator('param', activityParams),
    zValidator('query', detailQuery),
    async (context) => {
      const { kind, activityId } = context.req.valid('param')
      const { corporationId } = context.req.valid('query')
      if (kind === 'project' && !corporationId)
        return context.json({ message: 'A corporation is required for project detail.' }, 400)
      const resourceId = publicResourceIds[kind]
      const platform = context.var.platform
      let source = await readActivitySnapshots(
        { ...capabilities, collectionStatus: platform.collectionStatus },
        platform.organization.organizationVersion,
        resourceId,
        kind === 'project'
          ? { kind: 'corporation', corporationId: corporationId! }
          : { kind: 'deployment', deploymentId: 1 },
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
          { kind: 'corporation', corporationId },
          activityId,
        )
        if (corporationSource.snapshots.length > 0) source = corporationSource
      }
      return context.json(
        {
          organizationVersion: platform.organization.organizationVersion,
          resource: source.status,
          activity: source.snapshots.find((snapshot) => snapshot.id === activityId) ?? null,
          objectives: source.snapshots.filter((snapshot) => snapshot.campaignId === activityId),
        },
        200,
      )
    },
  )
}

export function participationRoutes(
  capabilities: PlatformModuleRouteCapabilities<PlatformModuleResourceTransaction>,
) {
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
        { kind: 'character', characterId },
        activityId,
      )
      return context.json(
        {
          characterId,
          resource: source.status,
          activity:
            kind === 'job'
              ? (source.snapshots.find((snapshot) => snapshot.id === activityId) ?? null)
              : null,
          participation: source.snapshots
            .filter((snapshot) => snapshot.id === activityId || snapshot.campaignId === activityId)
            .map((snapshot) => ({
              activityId: snapshot.id,
              contributed: snapshot.contributed,
              committed: snapshot.committed,
            })),
        },
        200,
      )
    },
  )
}
