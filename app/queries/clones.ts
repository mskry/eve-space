import { defineQueryOptions } from '@pinia/colada'
import type { InferResponseType } from 'hono/client'
import type { ApiClient } from '../utils/api-client'
import { toApiQueryError } from '../utils/query-error'
import {
  canRunProtectedCharacterQuery,
  type ProtectedCharacterQueryAccess,
} from './protected-character-query-access'
import { PRIVATE_QUERY_KEYS } from './query-keys'
import { QUERY_POLICY } from './query-policy'

type CharacterClient = ApiClient['api']['me']['characters'][':characterId']

export type CharacterClones = InferResponseType<CharacterClient['clones']['$get'], 200>
export type CharacterImplants = InferResponseType<CharacterClient['implants']['$get'], 200>

interface CharacterClonesQueryParameters {
  apiClient: ApiClient
  characterId: number
  access: ProtectedCharacterQueryAccess
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
    enabled: canRunProtectedCharacterQuery(access, characterId),
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
    enabled: canRunProtectedCharacterQuery(access, characterId),
  }),
)
