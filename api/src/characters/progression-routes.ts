import { Hono } from 'hono'
import { privateNoStore } from '../http/private-response.js'
import { zValidator } from '../http/validation.js'
import { loadSession } from '../middleware/auth-session.js'
import type { OwnedCharacterEnv } from '../middleware/owned-character.js'
import { characterIdParams, loadOwnedCharacter } from '../middleware/owned-character.js'
import { characterAttributesScope, getCharacterAttributes } from './attributes.js'
import { ownedCharacterResourceError } from './route-responses.js'
import { characterSkillQueueScope, getCharacterSkillQueue } from './skill-queue.js'
import { characterSkillsScope, getCharacterSkills } from './skills.js'

export const characterProgressionRoutes = new Hono<OwnedCharacterEnv>()
  .get(
    '/:characterId/attributes',
    privateNoStore,
    zValidator('param', characterIdParams),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const characterId = context.var.ownedCharacter.characterId
      try {
        return context.json(await getCharacterAttributes(characterId))
      } catch (error) {
        return ownedCharacterResourceError(context, error, characterId, {
          requiredScope: characterAttributesScope,
          scopeMessage: 'Authorize attributes access for this character.',
          unavailableMessage: 'EVE Online ESI is temporarily unavailable.',
        })
      }
    },
  )
  .get(
    '/:characterId/skill-queue',
    privateNoStore,
    zValidator('param', characterIdParams),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const characterId = context.var.ownedCharacter.characterId
      try {
        return context.json(await getCharacterSkillQueue(characterId))
      } catch (error) {
        return ownedCharacterResourceError(context, error, characterId, {
          requiredScope: characterSkillQueueScope,
          scopeMessage: 'Authorize skill queue access for this character.',
          unavailableMessage: 'EVE Online ESI is temporarily unavailable.',
        })
      }
    },
  )
  .get(
    '/:characterId/skills',
    privateNoStore,
    zValidator('param', characterIdParams),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const characterId = context.var.ownedCharacter.characterId
      try {
        return context.json(await getCharacterSkills(characterId))
      } catch (error) {
        return ownedCharacterResourceError(context, error, characterId, {
          requiredScope: characterSkillsScope,
          scopeMessage: 'Authorize skills access for this character.',
          unavailableMessage: 'EVE Online ESI is temporarily unavailable.',
        })
      }
    },
  )
