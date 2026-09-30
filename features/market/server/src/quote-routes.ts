import type {
  PlatformModuleRouteCapabilities,
  PlatformPublicRouteEnv,
} from '@eve-space/platform-module-contract/server'
import { zValidator } from '@eve-space/platform-module-server'
import { Hono } from 'hono'
import { z } from 'zod'
import type { MarketBookReads } from './persistence.js'
import { quoteObservedMarketDepth } from './quote-market.js'

const params = z.strictObject({
  profileId: z.uuid(),
  typeId: z.coerce.number().int().positive().safe(),
})
const body = z.strictObject({
  observationId: z.uuid(),
  side: z.enum(['buy', 'sell']),
  quantity: z.number().int().positive().safe(),
  locationIds: z.array(z.number().int().positive().safe()).max(100),
})

export const marketQuoteRoutes = ({
  persistence,
}: PlatformModuleRouteCapabilities<
  Pick<MarketBookReads, 'readMarketObservation' | 'readMarketQuoteRows'>
>) =>
  new Hono<PlatformPublicRouteEnv>().post(
    '/profiles/:profileId/types/:typeId/quote',
    zValidator('param', params),
    zValidator('json', body),
    async (context) => {
      const { profileId, typeId } = context.req.valid('param')
      const { observationId, side, quantity, locationIds } = context.req.valid('json')
      const observation = await persistence.readMarketObservation({
        profileId,
        typeId,
        observationId,
      })
      context.header('Cache-Control', 'no-store')
      if (!observation) return context.json({ code: 'MARKET_OBSERVATION_UNAVAILABLE' }, 404)
      let quote
      try {
        quote = await quoteObservedMarketDepth({
          observation: {
            publication: 'complete',
            observationId,
            marketId: `${profileId}:${typeId}`,
            observedAt: observation.observedAt,
            validatedAt: observation.validatedAt,
            freshUntil: observation.freshUntil,
          },
          typeId,
          side,
          quantity,
          locationIds,
          readRows: persistence.readMarketQuoteRows,
          signal: context.req.raw.signal,
        })
      } catch (error) {
        if (error instanceof RangeError) {
          return context.json({ code: 'MARKET_QUOTE_DEPTH_UNAVAILABLE' }, 503)
        }
        throw error
      }
      const freshness =
        Date.parse(observation.freshUntil) > Date.now() ? ('current' as const) : ('stale' as const)
      return context.json({ freshness, quote }, 200)
    },
  )
