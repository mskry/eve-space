import { Hono } from 'hono'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { getConnInfo } from '@hono/node-server/conninfo'
import {
  getCorporationAllianceHistory,
  getCorporationPublic,
  getNpcCorporations,
} from '../corporation-service.js'
import { EsiQuotaError } from '../esi-resilience/cooldowns.js'
import { zValidator } from '../validation.js'
import { z } from 'zod'

const corporationIdParams = z.object({
  corporationId: z.coerce.number().int().positive().max(2_147_483_647),
})

const privateNoStore = createMiddleware(async (context, next) => {
  context.header('Cache-Control', 'private, no-store')
  context.header('Vary', 'Cookie')
  await next()
})

const rateLimitWindowMs = 60_000
const rateLimitMaximum = 60
const rateLimitEntries = new Map<string, { count: number; resetAt: number }>()
const maxRateLimitEntries = 1_000

const limitPublicCorporationRequests = createMiddleware(async (context, next) => {
  const now = Date.now()
  const client = getClientAddress(context)
  const current = rateLimitEntries.get(client)
  const entry =
    current && current.resetAt > now ? current : { count: 0, resetAt: now + rateLimitWindowMs }
  entry.count += 1
  rateLimitEntries.set(client, entry)
  if (rateLimitEntries.size > maxRateLimitEntries) {
    const oldest = rateLimitEntries.keys().next().value
    if (oldest !== undefined) rateLimitEntries.delete(oldest)
  }

  if (entry.count > rateLimitMaximum) {
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1_000))
    context.header('Retry-After', String(retryAfterSeconds))
    return context.json(
      { code: 'CORPORATION_RATE_LIMITED', message: 'Too many corporation requests.' },
      429,
    )
  }

  await next()
})

function errorStatus(error: unknown) {
  return typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status: unknown }).status)
    : undefined
}

export const corporationRoutes = new Hono()
  // NPC list — public, no auth
  .get('/npc', privateNoStore, limitPublicCorporationRequests, async (context) => {
    try {
      const npcIds = await getNpcCorporations()
      return context.json({ corporationIds: npcIds })
    } catch (error) {
      if (error instanceof EsiQuotaError) {
        context.header('Retry-After', String(error.retryAfterSeconds))
        return context.json(
          {
            code: 'ESI_COOLDOWN',
            message: 'Corporation data is temporarily rate limited by ESI.',
            retryAfterSeconds: error.retryAfterSeconds,
          },
          429,
        )
      }
      return context.json({ message: 'Corporation data is temporarily unavailable.' }, 502)
    }
  })
  // Single corporation public data — works for NPC and player corps
  .get(
    '/:corporationId',
    privateNoStore,
    zValidator('param', corporationIdParams),
    limitPublicCorporationRequests,
    async (context) => {
      const { corporationId } = context.req.valid('param')
      try {
        const corporation = await getCorporationPublic(corporationId)
        return context.json({ corporation })
      } catch (error) {
        if (error instanceof EsiQuotaError) {
          context.header('Retry-After', String(error.retryAfterSeconds))
          return context.json(
            {
              code: 'ESI_COOLDOWN',
              message: 'Corporation data is temporarily rate limited by ESI.',
              retryAfterSeconds: error.retryAfterSeconds,
            },
            429,
          )
        }
        const status = errorStatus(error)
        if (status === 404 || status === 422) {
          return context.json(
            { code: 'CORPORATION_NOT_FOUND', message: 'Corporation not found.' },
            404,
          )
        }
        return context.json({ message: 'Corporation data is temporarily unavailable.' }, 502)
      }
    },
  )
  .get(
    '/:corporationId/alliance-history',
    privateNoStore,
    zValidator('param', corporationIdParams),
    limitPublicCorporationRequests,
    async (context) => {
      const { corporationId } = context.req.valid('param')
      try {
        const history = await getCorporationAllianceHistory(corporationId)
        return context.json({ corporationId, history })
      } catch (error) {
        if (error instanceof EsiQuotaError) {
          context.header('Retry-After', String(error.retryAfterSeconds))
          return context.json(
            {
              code: 'ESI_COOLDOWN',
              message: 'Corporation data is temporarily rate limited by ESI.',
              retryAfterSeconds: error.retryAfterSeconds,
            },
            429,
          )
        }
        const status = errorStatus(error)
        if (status === 404 || status === 422) {
          return context.json(
            { code: 'CORPORATION_NOT_FOUND', message: 'Corporation not found.' },
            404,
          )
        }
        return context.json({ message: 'Alliance history is temporarily unavailable.' }, 502)
      }
    },
  )

function getClientAddress(context: Context): string {
  try {
    return getConnInfo(context).remote.address ?? 'shared'
  } catch {
    return 'shared'
  }
}
