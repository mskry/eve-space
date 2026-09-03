import { Hono } from 'hono'
import { z } from 'zod'
import { getCharacterProfile } from './profile.js'
import { EsiQuotaError } from '../esi-resilience/cooldowns.js'
import { privateNoStore } from '../http/private-response.js'
import { createPublicRequestRateLimit } from '../http/public-rate-limit.js'
import { zValidator } from '../http/validation.js'

const characterIdParams = z.object({
  characterId: z.coerce.number().int().positive().max(2_147_483_647),
})

const limitPublicCharacterRequests = createPublicRequestRateLimit({
  code: 'CHARACTER_RATE_LIMITED',
  message: 'Too many character requests.',
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
