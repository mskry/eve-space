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
import { classifyCharacterResourceFailure } from './resource-failure.js'
import { ownedCharacterResourceError, toCharacterEsiResponse } from './route-responses.js'

export const characterClonesRoutes = new Hono<OwnedCharacterEnv>()
  .get(
    '/:characterId/clones',
    privateNoStore,
    zValidator('param', characterIdParams),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const { characterId, subjectLifecycleId } = context.var.ownedCharacter
      try {
        return context.json(
          toCharacterEsiResponse(await getCharacterClones(characterId, subjectLifecycleId)),
          200,
        )
      } catch (error) {
        return ownedCharacterResourceError(
          context,
          classifyCharacterResourceFailure(error, {
            configuredScope: characterClonesScope,
            preferConfiguredScope: true,
          }),
          characterId,
          {
            scopeMessage: 'Authorize clone access for this character.',
            unavailableMessage: 'Unable to retrieve character clone state.',
            returnTo: `/characters/${characterId}/clones`,
          },
        )
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
      const { characterId, subjectLifecycleId } = context.var.ownedCharacter
      try {
        return context.json(
          toCharacterEsiResponse(await getCharacterImplants(characterId, subjectLifecycleId)),
          200,
        )
      } catch (error) {
        return ownedCharacterResourceError(
          context,
          classifyCharacterResourceFailure(error, {
            configuredScope: characterImplantsScope,
            preferConfiguredScope: true,
          }),
          characterId,
          {
            scopeMessage: 'Authorize implant access for this character.',
            unavailableMessage: 'Unable to retrieve active implants.',
            returnTo: `/characters/${characterId}/clones`,
          },
        )
      }
    },
  )
