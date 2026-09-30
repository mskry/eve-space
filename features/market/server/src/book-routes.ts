import type {
  PlatformPublicRouteCapabilities,
  PlatformPublicRouteEnv,
} from '@eve-space/platform-module-contract/server'
import { zValidator } from '@eve-space/platform-module-server'
import { Hono } from 'hono'
import { z } from 'zod'
import type { MarketBookReads } from './persistence.js'
import { marketOrderExpiryAt } from './market-order-expiry.js'
import { globalPlexMarketRegionId } from './market-bounds.js'

type BookCapabilities = PlatformPublicRouteCapabilities<
  readonly ['static-location-labels'],
  MarketBookReads
>
type BookOrderRows = Awaited<ReturnType<MarketBookReads['readMarketOrderRows']>>['rows']
type LocationLabels = Awaited<
  ReturnType<BookCapabilities['coreData']['staticLocationLabels']>
>['rows']

const profileParams = z.strictObject({
  profileId: z.uuid(),
  typeId: z.coerce.number().int().positive().safe(),
})
const orderParams = z.strictObject({
  profileId: z.uuid(),
  typeId: z.coerce.number().int().positive().safe(),
  observationId: z.uuid(),
})
const orderQuery = z
  .strictObject({
    side: z.enum(['sell', 'buy']),
    limit: z.coerce.number().int().min(1).max(100).default(100),
    cursorPrice: z
      .string()
      .regex(/^(?:0|[1-9]\d{0,14})\.\d{2}$/)
      .optional(),
    cursorIssuedAt: z.iso.datetime({ offset: true }).optional(),
    cursorOrderId: z.coerce.number().int().positive().safe().optional(),
  })
  .refine(
    (query) =>
      [query.cursorPrice, query.cursorIssuedAt, query.cursorOrderId].filter(
        (value) => value !== undefined,
      ).length === 0 ||
      [query.cursorPrice, query.cursorIssuedAt, query.cursorOrderId].every(
        (value) => value !== undefined,
      ),
    { message: 'Market order cursor is incomplete' },
  )
const metricsQuery = z
  .strictObject({
    beforeObservedAt: z.iso.datetime({ offset: true }).optional(),
    beforeObservationId: z.uuid().optional(),
  })
  .refine((value) => Boolean(value.beforeObservedAt) === Boolean(value.beforeObservationId), {
    message: 'Market metric cursor is incomplete',
  })

const sourceStatus = (freshUntil: string) =>
  new Date(freshUntil).getTime() > Date.now() ? ('current' as const) : ('stale' as const)
const collectionStatus = (failure: string | null) =>
  failure === null ? ('ready' as const) : ('profile-failed' as const)

const locationIdsForRows = (rows: BookOrderRows) => [
  ...new Set(
    rows.flatMap((row) =>
      [row.locationId, row.solarSystemId].filter((id): id is number => id !== null),
    ),
  ),
]

const labelMarketRows = (rows: BookOrderRows, labels: LocationLabels) => {
  const byId = new Map(labels.map((label) => [label.locationId, label]))
  return rows.map((row) => {
    const location = byId.get(row.locationId)
    const system = location ?? (row.solarSystemId ? byId.get(row.solarSystemId) : undefined)
    return {
      ...row,
      locationName:
        location?.name ?? (system ? `${system.name} · Location ${row.locationId}` : null),
      solarSystemSecurityStatus: system?.solarSystemSecurityStatus ?? null,
      expiryAt: marketOrderExpiryAt(row.issuedAt, row.durationDays),
    }
  })
}

export const marketBookRoutes = ({ coreData, persistence }: BookCapabilities) =>
  new Hono<PlatformPublicRouteEnv>()
    .get('/profiles', async (context) => {
      const profiles = await persistence.listMarketProfiles({ enabledOnly: true })
      context.header('Cache-Control', 'public, max-age=30, must-revalidate')
      return context.json(
        {
          profiles: profiles.map(
            ({ profileId, revision, regionId, mode, stationIds, watchedTypeIds }) => ({
              profileId,
              revision,
              regionId,
              marketScope:
                regionId === globalPlexMarketRegionId
                  ? ('global-plex' as const)
                  : ('region' as const),
              mode,
              stationIds,
              watchedTypeIds,
            }),
          ),
        },
        200,
      )
    })
    .get(
      '/profiles/:profileId/types/:typeId/observation',
      zValidator('param', profileParams),
      async (context) => {
        const { profileId, typeId } = context.req.valid('param')
        const profiles = await persistence.listMarketProfiles({ enabledOnly: true })
        const profile = profiles.find((entry) => entry.profileId === profileId)
        if (!profile) {
          context.header('Cache-Control', 'no-store')
          return context.json({ code: 'MARKET_PROFILE_UNAVAILABLE' }, 404)
        }
        const observation = await persistence.readMarketObservation({
          profileId,
          typeId,
          observationId: null,
        })
        const replacement = await persistence.readMarketReplacementStatus({ profileId, typeId })
        const replacementStatus = replacement
          ? { status: 'incomplete' as const, attemptedAt: replacement.attemptedAt }
          : null
        if (!observation) {
          context.header('Cache-Control', 'no-store')
          return context.json(
            {
              status: 'uncollected' as const,
              collectionStatus: collectionStatus(profile.lastFailureClass),
              replacement: replacementStatus,
            },
            200,
          )
        }
        const [sellers, buyers] = await Promise.all([
          persistence.readMarketOrderRows({
            observationId: observation.observationId,
            typeId,
            side: 'sell',
            limit: 100,
            cursorPrice: null,
            cursorIssuedAt: null,
            cursorOrderId: null,
          }),
          persistence.readMarketOrderRows({
            observationId: observation.observationId,
            typeId,
            side: 'buy',
            limit: 100,
            cursorPrice: null,
            cursorIssuedAt: null,
            cursorOrderId: null,
          }),
        ])
        const locationIds = locationIdsForRows([...sellers.rows, ...buyers.rows])
        const labels = await coreData.staticLocationLabels({ locationIds })
        const status = sourceStatus(observation.freshUntil)
        context.header(
          'Cache-Control',
          status === 'current' && !replacement ? 'public, max-age=10, must-revalidate' : 'no-store',
        )
        return context.json(
          {
            status,
            collectionStatus: collectionStatus(profile.lastFailureClass),
            replacement: replacementStatus,
            observation,
            sellers: { ...sellers, rows: labelMarketRows(sellers.rows, labels.rows) },
            buyers: { ...buyers, rows: labelMarketRows(buyers.rows, labels.rows) },
          },
          200,
        )
      },
    )
    .get(
      '/profiles/:profileId/types/:typeId/observations/:observationId/orders',
      zValidator('param', orderParams),
      zValidator('query', orderQuery),
      async (context) => {
        const { profileId, typeId, observationId } = context.req.valid('param')
        const { side, limit, cursorPrice, cursorIssuedAt, cursorOrderId } =
          context.req.valid('query')
        const observation = await persistence.readMarketObservation({
          profileId,
          typeId,
          observationId,
        })
        if (!observation) {
          context.header('Cache-Control', 'no-store')
          return context.json({ code: 'MARKET_OBSERVATION_UNAVAILABLE' }, 404)
        }
        const page = await persistence.readMarketOrderRows({
          observationId,
          typeId,
          side,
          limit,
          cursorPrice: cursorPrice ?? null,
          cursorIssuedAt: cursorIssuedAt ?? null,
          cursorOrderId: cursorOrderId ?? null,
        })
        const locationIds = locationIdsForRows(page.rows)
        const labels = await coreData.staticLocationLabels({ locationIds })
        context.header('Cache-Control', 'public, max-age=10, must-revalidate')
        return context.json(
          {
            observationId,
            rows: labelMarketRows(page.rows, labels.rows),
            hasMore: page.hasMore,
          },
          200,
        )
      },
    )
    .get(
      '/profiles/:profileId/types/:typeId/metrics',
      zValidator('param', profileParams),
      zValidator('query', metricsQuery),
      async (context) => {
        const { profileId, typeId } = context.req.valid('param')
        const { beforeObservedAt, beforeObservationId } = context.req.valid('query')
        const metrics = await persistence.readMarketMetrics({
          profileId,
          typeId,
          beforeObservedAt: beforeObservedAt ?? null,
          beforeObservationId: beforeObservationId ?? null,
        })
        if (!metrics) {
          context.header('Cache-Control', 'no-store')
          return context.json({ code: 'MARKET_METRICS_PROFILE_UNAVAILABLE' }, 404)
        }
        context.header(
          'Cache-Control',
          metrics.items.length > 0 ? 'public, max-age=30, must-revalidate' : 'no-store',
        )
        return context.json(
          {
            status: metrics.items.length > 0 ? ('observed' as const) : ('uncollected' as const),
            ...metrics,
          },
          200,
        )
      },
    )
