import { Hono } from 'hono'
import { deleteCharacter } from '../auth/character-lifecycle.js'
import { privateNoStore } from '../http/private-response.js'
import { zValidator } from '../http/validation.js'
import { loadSession } from '../middleware/auth-session.js'
import type { OwnedCharacterEnv } from '../middleware/owned-character.js'
import { characterIdParams, loadOwnedCharacter } from '../middleware/owned-character.js'
import { characterAssetsRoutes } from './assets-routes.js'
import { characterClonesRoutes } from './clones-routes.js'
import { characterCoreRoutes } from './core-routes.js'
import { characterFinanceRoutes } from './finance-routes.js'
import { characterHistoryRoutes } from './history-routes.js'
import { characterProgressionRoutes } from './progression-routes.js'

export const characterRoutes = new Hono<OwnedCharacterEnv>()
  .delete(
    '/:characterId',
    privateNoStore,
    zValidator('param', characterIdParams),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const result = await deleteCharacter(
        context.var.session!.userId,
        context.var.ownedCharacter.characterId,
        context.var.ownedCharacter.subjectLifecycleId,
      )
      if (result === 'main-character') {
        return context.json(
          {
            code: 'MAIN_CHARACTER_DELETE_FORBIDDEN',
            message: 'Choose another main character before deleting this one.',
          },
          409,
        )
      }
      if (result === 'authority-evidence') {
        return context.json(
          {
            code: 'CHARACTER_AUTHORITY_EVIDENCE_RETAINED',
            message:
              'This character supplies retained organization-owner authority evidence and cannot be deleted.',
          },
          409,
        )
      }
      if (result === 'corporation-source') {
        return context.json(
          {
            code: 'CHARACTER_CORPORATION_SOURCE_ACTIVE',
            message: 'Replace this character as the corporation data source before deleting it.',
          },
          409,
        )
      }
      if (result === 'not-found')
        return context.json({ code: 'CHARACTER_NOT_FOUND', message: 'Character not found.' }, 404)
      return context.body(null, 204)
    },
  )
  .route('/', characterCoreRoutes)
  .route('/', characterAssetsRoutes)
  .route('/', characterProgressionRoutes)
  .route('/', characterClonesRoutes)
  .route('/', characterFinanceRoutes)
  .route('/', characterHistoryRoutes)
