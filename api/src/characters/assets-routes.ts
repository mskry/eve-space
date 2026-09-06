import { Hono } from 'hono'
import { privateNoStore } from '../http/private-response.js'
import { zValidator } from '../http/validation.js'
import { loadSession } from '../middleware/auth-session.js'
import type { OwnedCharacterEnv } from '../middleware/owned-character.js'
import { characterIdParams, loadOwnedCharacter } from '../middleware/owned-character.js'
import {
  characterAssetsScope,
  CharacterAssetsPaginationError,
  getCharacterAssets,
} from './assets.js'
import { ownedCharacterResourceError } from './route-responses.js'

export const characterAssetsRoutes = new Hono<OwnedCharacterEnv>().get(
  '/:characterId/assets',
  privateNoStore,
  zValidator('param', characterIdParams),
  loadSession,
  loadOwnedCharacter,
  async (context) => {
    const characterId = context.var.ownedCharacter.characterId
    try {
      return context.json(await getCharacterAssets(characterId), 200)
    } catch (error) {
      if (error instanceof CharacterAssetsPaginationError)
        return context.json(
          {
            code: 'ESI_RESPONSE_INVALID',
            message: 'EVE Online returned invalid asset pagination metadata.',
          },
          502,
        )
      return ownedCharacterResourceError(context, error, characterId, {
        requiredScope: characterAssetsScope,
        preferConfiguredScope: true,
        scopeMessage: 'Authorize asset access for this character.',
        unavailableMessage: 'Unable to retrieve the complete character asset collection.',
        returnTo: `/characters/${characterId}/assets`,
      })
    }
  },
)
