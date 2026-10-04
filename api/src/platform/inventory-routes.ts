import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '../http/validation.js'
import { privateNoStore } from '../http/private-response.js'
import {
  loadSession,
  requireSession,
  readRequestSession,
  type SessionEnv,
} from '../middleware/auth-session.js'
import {
  admitBrowserInventory,
  browserInventoryCorporations,
} from './inventory-browser-admission.js'

const selection = z.discriminatedUnion('scope', [
  z.strictObject({
    scope: z.literal('personal'),
    characterIds: z.array(z.int().positive()).max(250).optional(),
  }),
  z.strictObject({
    scope: z.literal('corporation'),
    corporationId: z.int().positive(),
  }),
])

export const inventoryBrowserRoutes = new Hono<SessionEnv>()
  .use('*', privateNoStore, loadSession, requireSession)
  .post('/admission', zValidator('json', selection), async (context) => {
    const signal = AbortSignal.any([context.req.raw.signal, AbortSignal.timeout(15_000)])
    const result = await admitBrowserInventory(
      context.var.session,
      context.req.valid('json'),
      () => readRequestSession(context),
      {
        run: async (load) => {
          signal.throwIfAborted()
          const value = await load()
          signal.throwIfAborted()
          return value
        },
      },
    )
    if (!result.admitted) return context.json(result.body, result.status)
    return context.json(result, 200)
  })
  .get('/corporations', async (context) => {
    const result = await browserInventoryCorporations(context.var.session, () =>
      readRequestSession(context),
    )
    if (!result.admitted) return context.json(result.body, result.status)
    return context.json(result, 200)
  })
