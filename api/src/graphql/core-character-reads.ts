import { createAdmittedOwnedRead } from '../auth/admitted-read.js'
import { readOwnedCharacterSelection } from '../auth/character-selection.js'
import { admitOwnedRead } from '../auth/read-admission.js'
import { ReadAdmissionError } from '../auth/read-policy.js'
import type { SessionAccount } from '../auth/session-store.js'
import { readCharacterAssetConnection } from '../characters/asset-connection.js'
import { characterAssetsScope } from '../characters/asset-pages.js'
import type { CharacterAssetWindowWork } from '../characters/asset-work.js'
import { safeEveIdNumber } from './scalars.js'
import type { GraphQLRequestState } from './request-state.js'
import { fingerprintReadValue } from '../read-value.js'

export const createCoreCharacterReads = (
  liveSession: () => Promise<SessionAccount | null>,
  work: CharacterAssetWindowWork,
  memo?: GraphQLRequestState,
) =>
  Object.freeze({
    ownedCharacters: async (first: number, after: string | null) => {
      work.signal.throwIfAborted()
      const result = await readOwnedCharacterSelection(liveSession, first, after, work)
      work.signal.throwIfAborted()
      return result
    },
    ownedCharacter: async (characterId: string) => {
      work.signal.throwIfAborted()
      const admission = await admitOwnedRead(
        await liveSession(),
        safeEveIdNumber(characterId),
        undefined,
        work,
      )
      if (!admission.admitted) throw new ReadAdmissionError(admission)
      const subject = createAdmittedOwnedRead(
        admission.binding,
        liveSession,
        async (binding) => ({
          characterId: binding.character.characterId,
          name: binding.character.name,
          isMain: binding.character.isMain,
        }),
        work,
      )
      const identity = await subject.read(undefined)
      return Object.freeze({
        ...identity,
        assets: async (first: number, after: string | null) => {
          const assets = createAdmittedOwnedRead(
            { ...subject.binding, requiredScope: characterAssetsScope },
            liveSession,
            (binding) => readCharacterAssetConnection(binding, first, after, work),
            work,
          )
          const result = memo
            ? await memo.reuse(
                fingerprintReadValue(['core-assets', assets.identity, first, after]),
                assets.assertCurrent,
                () => readCharacterAssetConnection(assets.binding, first, after, work),
              )
            : await assets.read(undefined)
          work.signal.throwIfAborted()
          return result
        },
      })
    },
  })
