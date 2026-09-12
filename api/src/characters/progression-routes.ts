import { Hono } from 'hono'
import { privateNoStore } from '../http/private-response.js'
import { zValidator } from '../http/validation.js'
import { loadSession } from '../middleware/auth-session.js'
import type { OwnedCharacterEnv } from '../middleware/owned-character.js'
import { characterIdParams, loadOwnedCharacter } from '../middleware/owned-character.js'
import { characterAttributesScope, getCharacterAttributes } from './attributes.js'
import { classifyCharacterResourceFailure } from './resource-failure.js'
import { ownedCharacterResourceError, toCharacterEsiResponse } from './route-responses.js'
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
      const { characterId, subjectLifecycleId } = context.var.ownedCharacter
      try {
        return context.json(
          toCharacterEsiResponse(await getCharacterAttributes(characterId, subjectLifecycleId)),
        )
      } catch (error) {
        return ownedCharacterResourceError(
          context,
          classifyCharacterResourceFailure(error, { configuredScope: characterAttributesScope }),
          characterId,
          {
            scopeMessage: 'Authorize attributes access for this character.',
            unavailableMessage: 'EVE Online ESI is temporarily unavailable.',
          },
        )
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
      const { characterId, subjectLifecycleId } = context.var.ownedCharacter
      try {
        return context.json(
          toCharacterEsiResponse(await getCharacterSkillQueue(characterId, subjectLifecycleId)),
        )
      } catch (error) {
        return ownedCharacterResourceError(
          context,
          classifyCharacterResourceFailure(error, { configuredScope: characterSkillQueueScope }),
          characterId,
          {
            scopeMessage: 'Authorize skill queue access for this character.',
            unavailableMessage: 'EVE Online ESI is temporarily unavailable.',
          },
        )
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
      const { characterId, subjectLifecycleId } = context.var.ownedCharacter
      try {
        return context.json(
          toCharacterEsiResponse(await getCharacterSkills(characterId, subjectLifecycleId)),
        )
      } catch (error) {
        return ownedCharacterResourceError(
          context,
          classifyCharacterResourceFailure(error, { configuredScope: characterSkillsScope }),
          characterId,
          {
            scopeMessage: 'Authorize skills access for this character.',
            unavailableMessage: 'EVE Online ESI is temporarily unavailable.',
          },
        )
      }
    },
  )
