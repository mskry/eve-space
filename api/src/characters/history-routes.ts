import { Hono } from 'hono'
import { EsiQuotaError } from '../esi-gateway/failures.js'
import { privateNoStore } from '../http/private-response.js'
import { zValidator } from '../http/validation.js'
import { loadSession } from '../middleware/auth-session.js'
import type { OwnedCharacterEnv } from '../middleware/owned-character.js'
import { characterIdParams, loadOwnedCharacter } from '../middleware/owned-character.js'
import { getCharacterEmploymentHistoryResult } from './history.js'
import { esiCooldown } from './route-responses.js'

export const characterHistoryRoutes = new Hono<OwnedCharacterEnv>().get(
  '/:characterId/history',
  privateNoStore,
  zValidator('param', characterIdParams),
  loadSession,
  loadOwnedCharacter,
  async (context) => {
    const characterId = context.var.ownedCharacter.characterId
    try {
      const result = await getCharacterEmploymentHistoryResult(characterId)
      return context.json({
        cachedUntil: result.cachedUntil,
        characterId,
        history: result.data,
        stale: result.stale,
        validatedAt: result.validatedAt,
        ...(result.retryAt && { retryAt: result.retryAt }),
        ...(result.refreshFailureClass && { refreshFailureClass: result.refreshFailureClass }),
      })
    } catch (error) {
      if (error instanceof EsiQuotaError) {
        return esiCooldown(context, error)
      }
      return context.json(
        { code: 'ESI_UNAVAILABLE', message: 'Employment history is temporarily unavailable.' },
        502,
      )
    }
  },
)
