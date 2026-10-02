import { Hono } from 'hono'
import { createAdmittedOwnedRead } from '../auth/admitted-read.js'
import { ReadAdmissionError } from '../auth/read-policy.js'
import { admitOwnedRead } from '../auth/read-admission.js'
import { findSession } from '../auth/session-store.js'
import { readAuthCookie } from '../http/auth-cookie.js'
import { privateNoStore } from '../http/private-response.js'
import { zValidator } from '../http/validation.js'
import { loadSession, sessionCookie } from '../middleware/auth-session.js'
import type { OwnedCharacterEnv } from '../middleware/owned-character.js'
import { characterIdParams, loadOwnedCharacter } from '../middleware/owned-character.js'
import { characterAssetsScope, CharacterAssetsPaginationError } from './asset-pages.js'
import { getCharacterAssets } from './assets.js'
import { classifyCharacterResourceFailure } from './resource-failure.js'
import { characterAssetPaginationResponse } from './resource-response.js'
import {
  ownedCharacterReadAdmissionError,
  ownedCharacterResourceError,
  toCharacterEsiResponse,
} from './route-responses.js'

const resourceOptions = (characterId: number) => ({
  returnTo: `/characters/${characterId}/assets`,
  scopeMessage: 'Authorize asset access for this character.',
  unavailableMessage: 'Unable to retrieve the complete character asset collection.',
})

export const characterAssetsRoutes = new Hono<OwnedCharacterEnv>().get(
  '/:characterId/assets',
  privateNoStore,
  zValidator('param', characterIdParams),
  loadSession,
  loadOwnedCharacter,
  async (context) => {
    const { characterId } = context.var.ownedCharacter
    try {
      const admission = await admitOwnedRead(context.var.session, characterId, characterAssetsScope)
      if (!admission.admitted) throw new ReadAdmissionError(admission)
      const bearer = readAuthCookie(context, sessionCookie)
      const read = createAdmittedOwnedRead(
        admission.binding,
        () => (bearer ? findSession(bearer) : Promise.resolve(null)),
        (binding) =>
          getCharacterAssets(
            binding.character.characterId,
            binding.character.subjectLifecycleId,
            context.req.raw.signal,
          ),
      )
      return context.json(toCharacterEsiResponse(await read.read(undefined)), 200)
    } catch (error) {
      if (error instanceof ReadAdmissionError)
        return ownedCharacterReadAdmissionError(
          context,
          error.denial,
          characterId,
          resourceOptions(characterId),
        )
      if (error instanceof CharacterAssetsPaginationError) {
        return context.json(
          characterAssetPaginationResponse.body,
          characterAssetPaginationResponse.status,
        )
      }
      return ownedCharacterResourceError(
        context,
        classifyCharacterResourceFailure(error, {
          configuredScope: characterAssetsScope,
          preferConfiguredScope: true,
        }),
        characterId,
        resourceOptions(characterId),
      )
    }
  },
)
