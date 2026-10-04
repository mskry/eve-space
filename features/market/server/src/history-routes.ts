import type {
  PlatformModuleRouteCapabilities,
  PlatformPublicRouteCapabilities,
  PlatformPublicMutationRouteEnv,
  PlatformPublicRouteEnv,
} from '@eve-space/platform-module-contract/server'
import { zValidator } from '@eve-space/platform-module-server'
import { Hono } from 'hono'
import { z } from 'zod'
import type {
  MarketHistoryDemandWrites,
  MarketHistoryReads,
  MarketProfileReads,
} from './persistence.js'
import { readMarketHistory } from './history-reads.js'

const historyParams = z.strictObject({
  profileId: z.uuid(),
  typeId: z.coerce.number().int().positive().safe(),
})
const emptyBody = z.strictObject({})

type MarketHistory = NonNullable<Awaited<ReturnType<MarketHistoryReads['readMarketHistorySource']>>>
type DemandCapabilities = PlatformModuleRouteCapabilities<
  MarketHistoryDemandWrites & MarketProfileReads & MarketHistoryReads,
  readonly ['market-catalogue']
>
type DemandProfile = Awaited<ReturnType<MarketProfileReads['listMarketProfiles']>>[number]

const readyHistory = (history: MarketHistory | null) => {
  if (
    history?.status !== 'observed' ||
    history.retainedEvidence ||
    !history.freshUntil ||
    Date.parse(history.freshUntil) <= Date.now()
  ) {
    return null
  }
  return { ...history, status: 'observed' as const, freshness: 'current' as const }
}

export const marketHistoryRoutes = ({
  persistence,
}: PlatformPublicRouteCapabilities<readonly [], MarketHistoryReads>) =>
  new Hono<PlatformPublicRouteEnv>().get(
    '/profiles/:profileId/types/:typeId',
    zValidator('param', historyParams),
    async (context) => {
      const { profileId, typeId } = context.req.valid('param')
      const history = await readMarketHistory(persistence, profileId, typeId)
      if (!history) {
        context.header('Cache-Control', 'no-store')
        return context.json({ code: 'MARKET_HISTORY_PROFILE_UNAVAILABLE' }, 404)
      }
      if (history.status === 'uncollected') {
        context.header('Cache-Control', 'no-store')
        return context.json({ ...history, freshness: 'uncollected' as const }, 200)
      }
      const { freshness } = history
      context.header(
        'Cache-Control',
        freshness === 'current' ? 'public, max-age=60, must-revalidate' : 'no-store',
      )
      return context.json({ ...history, freshness }, 200)
    },
  )

const demandTargetRejection = async (
  coreData: DemandCapabilities['coreData'],
  profile: DemandProfile,
  typeId: number,
) => {
  const catalogue = await coreData.marketCatalogue({ kind: 'type-by-id', typeId }).catch(() => null)
  if (catalogue?.kind !== 'type-by-id') {
    return { code: 'MARKET_CATALOGUE_UNAVAILABLE', status: 503 } as const
  }
  if (!catalogue.item) return { code: 'MARKET_TYPE_UNAVAILABLE', status: 404 } as const
  if (profile.mode === 'watched-types' && !profile.watchedTypeIds.includes(typeId)) {
    return { code: 'MARKET_HISTORY_PROFILE_UNAVAILABLE', status: 404 } as const
  }
  return null
}

const recordDemand = async (
  persistence: DemandCapabilities['persistence'],
  profile: DemandProfile,
  typeId: number,
) => {
  if (profile.mode !== 'region') return 'accepted' as const
  const result = await persistence.requestMarketHistoryDemand({
    profileId: profile.profileId,
    expectedRevision: profile.revision,
    typeId,
    requestId: crypto.randomUUID(),
  })
  return result.outcome
}

export const marketHistoryDemandRoutes = ({ coreData, persistence }: DemandCapabilities) =>
  new Hono<PlatformPublicMutationRouteEnv>().post(
    '/profiles/:profileId/types/:typeId/demand',
    zValidator('param', historyParams),
    zValidator('json', emptyBody),
    async (context) => {
      const { profileId, typeId } = context.req.valid('param')
      context.header('Cache-Control', 'no-store')
      const profiles = await persistence.listMarketProfiles({ enabledOnly: true })
      const profile = profiles.find((entry) => entry.profileId === profileId)
      if (!profile) return context.json({ code: 'MARKET_HISTORY_PROFILE_UNAVAILABLE' }, 404)
      const rejection = await demandTargetRejection(coreData, profile, typeId)
      if (rejection) return context.json({ code: rejection.code }, rejection.status)
      const demand = await recordDemand(persistence, profile, typeId)
      if (demand === 'unavailable') {
        return context.json({ code: 'MARKET_HISTORY_DEMAND_LIMIT' }, 429)
      }
      const cached = readyHistory(await persistence.readMarketHistorySource({ profileId, typeId }))
      if (cached) return context.json({ status: 'ready' as const, history: cached }, 200)
      const requester = context.var.onDemandProfile
      if (!requester) return context.json({ code: 'MARKET_HISTORY_COLLECTION_UNAVAILABLE' }, 503)
      const outcome = await requester.request(
        { profileId, revision: profile.revision, typeId },
        context.req.raw.signal,
      )
      const collected = readyHistory(
        await persistence.readMarketHistorySource({ profileId, typeId }),
      )
      if (collected) return context.json({ status: 'ready' as const, history: collected }, 200)
      if (outcome === 'completed' || outcome === 'unavailable') {
        return context.json({ code: 'MARKET_HISTORY_COLLECTION_UNAVAILABLE' }, 503)
      }
      return context.json({ status: 'accepted' as const, phase: outcome }, 202)
    },
  )
