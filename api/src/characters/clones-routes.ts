import { Hono } from 'hono'
import { privateNoStore } from '../http/private-response.js'
import { zValidator } from '../http/validation.js'
import { loadSession } from '../middleware/auth-session.js'
import type { OwnedCharacterEnv } from '../middleware/owned-character.js'
import { characterIdParams, loadOwnedCharacter } from '../middleware/owned-character.js'
import {
  characterClonesScope,
  characterImplantsScope,
  getCharacterClones,
  getCharacterImplants,
} from './clones.js'
import { ownedCharacterResourceError } from './route-responses.js'

export const characterClonesRoutes = new Hono<OwnedCharacterEnv>()
  .get(
    '/:characterId/clones',
    privateNoStore,
    zValidator('param', characterIdParams),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const characterId = context.var.ownedCharacter.characterId
      try {
        return context.json(await getCharacterClones(characterId), 200)
      } catch (error) {
        return ownedCharacterResourceError(context, error, characterId, {
          requiredScope: characterClonesScope,
          preferConfiguredScope: true,
          scopeMessage: 'Authorize clone access for this character.',
          unavailableMessage: 'Unable to retrieve character clone state.',
          returnTo: `/characters/${characterId}/clones`,
        })
      }
    },
  )
  .get(
    '/:characterId/implants',
    privateNoStore,
    zValidator('param', characterIdParams),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const characterId = context.var.ownedCharacter.characterId
      try {
        return context.json(await getCharacterImplants(characterId), 200)
      } catch (error) {
        return ownedCharacterResourceError(context, error, characterId, {
          requiredScope: characterImplantsScope,
          preferConfiguredScope: true,
          scopeMessage: 'Authorize implant access for this character.',
          unavailableMessage: 'Unable to retrieve active implants.',
          returnTo: `/characters/${characterId}/clones`,
        })
      }
    },
  )
