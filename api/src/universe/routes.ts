import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import { createPublicRequestRateLimit } from '../http/public-rate-limit.js'
import { zValidator } from '../http/validation.js'
import { calculateUniverseRoutes } from './route-calculator.js'
import { getUniverseTypeDetails } from './type-details.js'

const publicTypeCache = 'public, max-age=86400, stale-while-revalidate=3600'
export const maximumUniverseRouteDestinations = 10_000
const routeSystemId = z
  .number()
  .int('Solar system IDs must be positive safe integers.')
  .positive('Solar system IDs must be positive safe integers.')
const universeRouteRequest = z
  .object({
    originSystemId: routeSystemId,
    destinationSystemIds: z
      .array(routeSystemId)
      .min(1, 'At least one destination solar system ID is required.')
      .max(
        maximumUniverseRouteDestinations,
        `At most ${maximumUniverseRouteDestinations} destination solar system IDs are allowed.`,
      )
      .superRefine((ids, context) => {
        if (new Set(ids).size !== ids.length)
          context.addIssue({
            code: 'custom',
            message: 'Destination solar system IDs must be unique.',
          })
      })
      .transform((ids) => ids.toSorted((left, right) => left - right)),
    policy: z.object({ kind: z.literal('shortest') }).strict(),
  })
  .strict()
const typeIdParams = z.object({
  typeId: z
    .string()
    .regex(/^[1-9]\d*$/, 'Type ID must be a canonical positive safe integer.')
    .transform(Number)
    .refine(Number.isSafeInteger, 'Type ID must be a canonical positive safe integer.'),
})
const noStore = createMiddleware(async (context, next) => {
  context.header('Cache-Control', 'no-store')
  await next()
})
const limitPublicUniverseRouteRequests = createPublicRequestRateLimit({
  code: 'UNIVERSE_ROUTE_RATE_LIMITED',
  message: 'Too many universe route requests.',
})

export const universeRoutes = new Hono()
  .get('/types/:typeId', noStore, zValidator('param', typeIdParams), async (context) => {
    const { typeId } = context.req.valid('param')
    try {
      const type = await getUniverseTypeDetails(typeId)
      if (!type) {
        return context.json({ code: 'TYPE_NOT_FOUND', message: 'Type not found.' }, 404)
      }

      context.header('Cache-Control', publicTypeCache)
      return context.json(type, 200)
    } catch {
      return context.json(
        {
          code: 'STATIC_DATA_UNAVAILABLE',
          message: 'Static item data is temporarily unavailable.',
        },
        503,
      )
    }
  })
  .post(
    '/routes',
    noStore,
    zValidator('json', universeRouteRequest),
    limitPublicUniverseRouteRequests,
    async (context) => {
      try {
        return context.json(await calculateUniverseRoutes(context.req.valid('json')), 200)
      } catch {
        return context.json(
          {
            code: 'UNIVERSE_TOPOLOGY_UNAVAILABLE',
            message: 'Universe route topology is temporarily unavailable.',
          },
          503,
        )
      }
    },
  )
