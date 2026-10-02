import type {
  PlatformPublicRouteCapabilities,
  PlatformPublicRouteEnv,
} from '@eve-space/platform-module-contract/server'
import { zValidator } from '@eve-space/platform-module-server'
import { Hono } from 'hono'
import { z } from 'zod'
import type { MarketReferenceReads } from './persistence.js'
import { readMarketReferencePrices, validMarketReferenceTypes } from './reference-price-reads.js'

const query = z.strictObject({ typeIds: z.string().min(1).max(800) })

export const marketReferenceRoutes = ({
  persistence,
}: PlatformPublicRouteCapabilities<readonly [], MarketReferenceReads>) =>
  new Hono<PlatformPublicRouteEnv>().get('/', zValidator('query', query), async (context) => {
    const typeIds = context.req.valid('query').typeIds.split(',').map(Number)
    if (!validMarketReferenceTypes(typeIds)) {
      context.header('Cache-Control', 'no-store')
      return context.json({ code: 'INVALID_MARKET_REFERENCE_TYPES' }, 400)
    }
    const result = await readMarketReferencePrices(persistence, typeIds)
    context.header('Cache-Control', 'public, max-age=60, must-revalidate')
    return context.json(result, 200)
  })
