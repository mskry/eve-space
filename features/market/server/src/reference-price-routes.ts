import type {
  PlatformPublicRouteCapabilities,
  PlatformPublicRouteEnv,
} from '@eve-space/platform-module-contract/server'
import { zValidator } from '@eve-space/platform-module-server'
import { Hono } from 'hono'
import { z } from 'zod'
import type { MarketReferenceReads } from './persistence.js'

const query = z.strictObject({ typeIds: z.string().min(1).max(800) })

export const marketReferenceRoutes = ({
  persistence,
}: PlatformPublicRouteCapabilities<readonly [], MarketReferenceReads>) =>
  new Hono<PlatformPublicRouteEnv>().get('/', zValidator('query', query), async (context) => {
    const typeIds = context.req.valid('query').typeIds.split(',').map(Number)
    if (
      typeIds.length > 100 ||
      typeIds.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
      new Set(typeIds).size !== typeIds.length
    ) {
      context.header('Cache-Control', 'no-store')
      return context.json({ code: 'INVALID_MARKET_REFERENCE_TYPES' }, 400)
    }
    const rows = await persistence.readMarketReferencePrices({
      typeIds: typeIds.toSorted((left, right) => left - right),
    })
    context.header('Cache-Control', 'public, max-age=60, must-revalidate')
    return context.json({ kind: 'non-executable-reference', rows }, 200)
  })
