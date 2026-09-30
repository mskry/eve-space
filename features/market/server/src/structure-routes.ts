import type {
  PlatformModuleRouteCapabilities,
  PlatformOwnedCharacterRouteEnv,
} from '@eve-space/platform-module-contract/server'
import { zValidator } from '@eve-space/platform-module-server'
import { Hono } from 'hono'
import { z } from 'zod'
import type { MarketStructureDemandWrites, MarketStructureReads } from './persistence.js'
import { marketOrderExpiryAt } from './market-order-expiry.js'

const structureParams = z.object({ structureId: z.coerce.number().int().positive().safe() })
const bookParams = z.object({
  structureId: z.coerce.number().int().positive().safe(),
  typeId: z.coerce.number().int().positive().safe(),
})
const query = z
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
    (value) =>
      [value.cursorPrice, value.cursorIssuedAt, value.cursorOrderId].filter(
        (part) => part !== undefined,
      ).length === 0 ||
      [value.cursorPrice, value.cursorIssuedAt, value.cursorOrderId].every(
        (part) => part !== undefined,
      ),
  )
const emptyBody = z.strictObject({})

export const marketStructureRoutes = ({
  persistence,
}: PlatformModuleRouteCapabilities<MarketStructureReads & MarketStructureDemandWrites>) =>
  new Hono<PlatformOwnedCharacterRouteEnv>()
    .post(
      '/structures/:structureId/request',
      zValidator('param', structureParams),
      zValidator('json', emptyBody),
      async (context) => {
        const selector = context.var.platform.onDemandStructure
        if (!selector) return context.json({ code: 'STRUCTURE_MARKET_UNAVAILABLE' }, 503)
        const generation = await selector.currentGeneration()
        if (generation === null)
          return context.json(
            {
              code: 'STRUCTURE_MARKET_SCOPE_REQUIRED',
              requiredScope: 'esi-markets.structure_markets.v1',
            },
            409,
          )
        const structureId = context.req.valid('param').structureId
        const { characterId, subjectLifecycleId } = context.var.platform.authorization
        const reservation = {
          characterId,
          subjectLifecycleId,
          authorizationGeneration: generation,
          organizationVersion: context.var.platform.organization.organizationVersion,
          structureId,
          requestId: crypto.randomUUID(),
        }
        const admitted = await persistence.reserveStructureDemand(reservation)
        if (admitted.outcome === 'full') {
          return context.json({ code: 'STRUCTURE_MARKET_DEMAND_LIMIT' }, 429)
        }
        if (admitted.outcome === 'recent')
          return context.json({ status: 'coalesced' as const }, 202)
        let outcome: Awaited<ReturnType<typeof selector.request>>
        try {
          outcome = await selector.request(structureId)
        } catch (error) {
          await persistence.releaseStructureDemand(reservation)
          throw error
        }
        if (outcome === 'unavailable') {
          await persistence.releaseStructureDemand(reservation)
          return context.json({ code: 'STRUCTURE_MARKET_UNAVAILABLE' }, 429)
        }
        return context.json({ status: outcome }, 202)
      },
    )
    .get(
      '/structures/:structureId/types/:typeId/orders',
      zValidator('param', bookParams),
      zValidator('query', query),
      async (context) => {
        const selector = context.var.platform.onDemandStructure
        if (!selector) return context.json({ code: 'STRUCTURE_MARKET_UNAVAILABLE' }, 503)
        const generation = await selector.currentGeneration()
        if (generation === null) {
          return context.json(
            {
              code: 'STRUCTURE_MARKET_SCOPE_REQUIRED',
              requiredScope: 'esi-markets.structure_markets.v1',
            },
            409,
          )
        }
        const { characterId, subjectLifecycleId } = context.var.platform.authorization
        const { structureId, typeId } = context.req.valid('param')
        const { side, limit, cursorPrice, cursorIssuedAt, cursorOrderId } =
          context.req.valid('query')
        const book = await persistence.readStructureBook({
          characterId,
          subjectLifecycleId,
          authorizationGeneration: generation,
          organizationVersion: context.var.platform.organization.organizationVersion,
          structureId,
          typeId,
          side,
          limit,
          cursorPrice: cursorPrice ?? null,
          cursorIssuedAt: cursorIssuedAt ?? null,
          cursorOrderId: cursorOrderId ?? null,
        })
        if (!book) return context.json({ status: 'uncollected' as const }, 200)
        return context.json(
          {
            status:
              Date.parse(book.freshUntil) > Date.now() ? ('current' as const) : ('stale' as const),
            book: {
              ...book,
              rows: book.rows.map((row) =>
                Object.assign({}, row, {
                  expiryAt: marketOrderExpiryAt(row.issuedAt, row.durationDays),
                }),
              ),
            },
          },
          200,
        )
      },
    )
