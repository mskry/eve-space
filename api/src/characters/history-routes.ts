import { Hono } from 'hono'
import { EsiQuotaError } from '../esi-resilience/cooldowns.js'
import { privateNoStore } from '../http/private-response.js'
import { zValidator } from '../http/validation.js'
import { loadSession } from '../middleware/auth-session.js'
import type { OwnedCharacterEnv } from '../middleware/owned-character.js'
import { characterIdParams, loadOwnedCharacter } from '../middleware/owned-character.js'
import { getCharacterEmploymentHistory } from './history.js'
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
      return context.json({
        characterId,
        history: await getCharacterEmploymentHistory(characterId),
      })
    } catch (error) {
      if (error instanceof EsiQuotaError) return esiCooldown(context, error)
      return context.json(
        { code: 'ESI_UNAVAILABLE', message: 'Employment history is temporarily unavailable.' },
        502,
      )
    }
  },
)
