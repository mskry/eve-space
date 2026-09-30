import type {
  PlatformAdministratorRouteEnv,
  PlatformModuleRouteCapabilities,
} from '@eve-space/platform-module-contract/server'
import { zValidator } from '@eve-space/platform-module-server'
import { Hono } from 'hono'
import { z } from 'zod'
import type {
  MarketBookReads,
  MarketProfileDueReads,
  MarketProfileReads,
  MarketProfileWrites,
} from './persistence.js'
import { validateMarketPublicProfile } from './profiles.js'
import { marketCollectionBounds } from './market-bounds.js'

type ProfilePersistence = MarketProfileReads &
  MarketProfileWrites &
  MarketProfileDueReads &
  Pick<MarketBookReads, 'readMarketObservation'>
type ProfileCapabilities = PlatformModuleRouteCapabilities<
  ProfilePersistence,
  readonly ['market-station-regions']
>

const positiveId = z.number().int().positive().safe()
const body = z.strictObject({
  regionId: positiveId,
  mode: z.enum(['region', 'watched-types']),
  stationIds: z.array(positiveId).max(marketCollectionBounds.maximumStationIdsPerProfile),
  watchedTypeIds: z.array(positiveId).max(marketCollectionBounds.maximumWatchedTypesPerProfile),
  enabled: z.boolean(),
  expectedRevision: z.number().int().nonnegative().safe(),
})
const params = z.strictObject({ profileId: z.uuid() })
const statusQuery = z.strictObject({ typeId: z.coerce.number().int().positive().safe() })

export const profileRoutes = ({ coreData, persistence }: ProfileCapabilities) =>
  new Hono<PlatformAdministratorRouteEnv>()
    .get('/', async (context) => {
      const profiles = await persistence.listMarketProfiles({ enabledOnly: false })
      return context.json({ profiles }, 200)
    })
    .get('/due', async (context) => {
      const profiles = await persistence.listDueMarketProfiles({ now: new Date().toISOString() })
      return context.json({ profiles }, 200)
    })
    .get(
      '/:profileId/status',
      zValidator('param', params),
      zValidator('query', statusQuery),
      async (context) => {
        const { profileId } = context.req.valid('param')
        const { typeId } = context.req.valid('query')
        const profiles = await persistence.listMarketProfiles({ enabledOnly: false })
        const profile = profiles.find((entry) => entry.profileId === profileId)
        if (!profile) return context.json({ code: 'MARKET_PROFILE_UNAVAILABLE' }, 404)
        const observation = profile.enabled
          ? await persistence.readMarketObservation({ profileId, typeId, observationId: null })
          : null
        const dueAt = profile.nextDueAt ? Date.parse(profile.nextDueAt) : null
        const backlogAgeSeconds =
          dueAt === null ? 0 : Math.max(0, Math.floor((Date.now() - dueAt) / 1000))
        return context.json(
          {
            profileId,
            enabled: profile.enabled,
            regionId: profile.regionId,
            lastFailureClass: profile.lastFailureClass,
            nextDueAt: profile.nextDueAt,
            backlogAgeSeconds,
            cooldownUntil: profile.lastFailureClass === 'esi-cooldown' ? profile.nextDueAt : null,
            observation: observation
              ? {
                  observationId: observation.observationId,
                  observedAt: observation.observedAt,
                  validatedAt: observation.validatedAt,
                  freshUntil: observation.freshUntil,
                  expectedPages: observation.expectedPages,
                  totalBookOrders: observation.totalBookOrders,
                  freshness:
                    Date.parse(observation.freshUntil) > Date.now()
                      ? ('current' as const)
                      : ('stale' as const),
                }
              : null,
          },
          200,
        )
      },
    )
    .put('/:profileId', zValidator('param', params), zValidator('json', body), async (context) => {
      const { profileId } = context.req.valid('param')
      const { expectedRevision, ...input } = context.req.valid('json')
      const profiles = await persistence.listMarketProfiles({ enabledOnly: false })
      const current = profiles.find((profile) => profile.profileId === profileId)
      if ((current?.revision ?? 0) !== expectedRevision) {
        return context.json({ code: 'MARKET_PROFILE_OBSOLETE' }, 409)
      }
      let validated
      try {
        validated = await validateMarketPublicProfile(
          input,
          profiles.filter((profile) => profile.profileId !== profileId),
          coreData,
        )
      } catch (error) {
        if (error instanceof TypeError || error instanceof RangeError) {
          return context.json({ code: 'INVALID_MARKET_PROFILE', message: error.message }, 400)
        }
        return context.json({ code: 'MARKET_PROFILE_SOURCE_UNAVAILABLE' }, 503)
      }
      const result = await persistence.saveMarketProfile({
        profileId,
        regionId: validated.regionId,
        mode: validated.mode,
        stationIds: [...validated.stationIds],
        watchedTypeIds: [...validated.watchedTypeIds],
        enabled: validated.enabled,
        expectedRevision,
        requestId: crypto.randomUUID(),
      })
      if (result.outcome === 'obsolete') {
        return context.json({ code: 'MARKET_PROFILE_OBSOLETE' }, 409)
      }
      return context.json({ profileId, revision: result.revision }, 200)
    })
