import { defineQueryOptions } from '@pinia/colada'
import type { InferResponseType } from 'hono/client'
import type { ApiClient } from '../utils/api-client'
import { toApiQueryError } from '../utils/query-error'
import { PRIVATE_QUERY_KEYS } from './query-keys'
import { QUERY_POLICY } from './query-policy'

type CharacterClient = ApiClient['api']['me']['characters'][':characterId']

export type CharacterClones = InferResponseType<CharacterClient['clones']['$get'], 200>
export type CharacterImplants = InferResponseType<CharacterClient['implants']['$get'], 200>

export interface CharacterClonesAccess {
  isClient: boolean
  authenticated: boolean
  ownsCharacter: boolean
}

interface CharacterClonesQueryParameters {
  apiClient: ApiClient
  characterId: number
  access: CharacterClonesAccess
}

export function canRunCharacterClonesQuery(access: CharacterClonesAccess, characterId: number) {
  return (
    access.isClient &&
    access.authenticated &&
    access.ownsCharacter &&
    Number.isSafeInteger(characterId) &&
    characterId > 0
  )
}

export const characterClonesQuery = defineQueryOptions(
  ({ apiClient, characterId, access }: CharacterClonesQueryParameters) => ({
    key: PRIVATE_QUERY_KEYS.characterClones(characterId),
    query: async ({ signal }) => {
      const response = await apiClient.api.me.characters[':characterId'].clones.$get(
        { param: { characterId: String(characterId) } },
        { init: { signal } },
      )
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Character clone state is unavailable.')
      }
      return response.json() as Promise<CharacterClones>
    },
    ...QUERY_POLICY.characterClones,
    enabled: canRunCharacterClonesQuery(access, characterId),
  }),
)

export const characterImplantsQuery = defineQueryOptions(
  ({ apiClient, characterId, access }: CharacterClonesQueryParameters) => ({
    key: PRIVATE_QUERY_KEYS.characterImplants(characterId),
    query: async ({ signal }) => {
      const response = await apiClient.api.me.characters[':characterId'].implants.$get(
        { param: { characterId: String(characterId) } },
        { init: { signal } },
      )
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Active implants are unavailable.')
      }
      return response.json() as Promise<CharacterImplants>
    },
    ...QUERY_POLICY.characterImplants,
    enabled: canRunCharacterClonesQuery(access, characterId),
  }),
)
