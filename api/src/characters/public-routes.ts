import { getConnInfo } from '@hono/node-server/conninfo'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import { getCharacterProfile } from './profile.js'
import { EsiQuotaError } from '../esi-resilience/cooldowns.js'
import { zValidator } from '../http/validation.js'

const characterIdParams = z.object({
  characterId: z.coerce.number().int().positive().max(2_147_483_647),
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

const limitPublicCharacterRequests = createMiddleware(async (context, next) => {
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
      { code: 'CHARACTER_RATE_LIMITED', message: 'Too many character requests.' },
      429,
    )
  }

  await next()
})

export const publicCharacterRoutes = new Hono().get(
  '/:characterId',
  privateNoStore,
  zValidator('param', characterIdParams),
  limitPublicCharacterRequests,
  async (context) => {
    const { characterId } = context.req.valid('param')
    try {
      const profile = await getCharacterProfile(characterId)
      return context.json({ profile })
    } catch (error) {
      if (error instanceof EsiQuotaError) {
        context.header('Retry-After', String(error.retryAfterSeconds))
        return context.json(
          {
            code: 'ESI_COOLDOWN',
            message: 'Character data is temporarily rate limited by ESI.',
            retryAfterSeconds: error.retryAfterSeconds,
          },
          429,
        )
      }
      const status = errorStatus(error)
      if (status === 404 || status === 422) {
        return context.json({ code: 'CHARACTER_NOT_FOUND', message: 'Character not found.' }, 404)
      }
      return context.json({ message: 'Character data is temporarily unavailable.' }, 502)
    }
  },
)

function errorStatus(error: unknown) {
  return typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status: unknown }).status)
    : undefined
}

function getClientAddress(context: Context): string {
  try {
    return getConnInfo(context).remote.address ?? 'shared'
  } catch {
    return 'shared'
  }
}
