import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import { zValidator } from '../http/validation.js'
import { getUniverseTypeDetails } from './type-details.js'

const publicTypeCache = 'public, max-age=86400, stale-while-revalidate=3600'
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

export const universeRoutes = new Hono().get(
  '/types/:typeId',
  noStore,
  zValidator('param', typeIdParams),
  async (context) => {
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
  },
)
