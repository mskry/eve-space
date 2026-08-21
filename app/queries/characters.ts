import { defineQueryOptions } from '@pinia/colada'
import type { InferResponseType } from 'hono/client'
import type { ApiClient } from '../utils/api-client'
import { toApiQueryError } from '../utils/query-error'
import { PRIVATE_QUERY_KEYS } from './query-keys'
import { QUERY_POLICY } from './query-policy'

type CharacterRosterResponse = InferResponseType<ApiClient['api']['me']['characters']['$get'], 200>
export type CharacterRosterEntry = CharacterRosterResponse['characters'][number]
export type CharacterOverview = InferResponseType<
  ApiClient['api']['me']['characters'][':characterId']['$get'],
  200
>

interface CharacterQueryParameters {
  apiClient: ApiClient
  characterId: number
}

export const characterRosterQuery = defineQueryOptions((apiClient: ApiClient) => ({
  key: PRIVATE_QUERY_KEYS.roster(),
  query: async ({ signal }) => {
    const response = await apiClient.api.me.characters.$get(undefined, { init: { signal } })
    if (response.status !== 200) {
      throw await toApiQueryError(response, 'Character roster is unavailable.')
    }
    return response.json()
  },
  ...QUERY_POLICY.characterRoster,
}))

export const characterOverviewQuery = defineQueryOptions(
  ({ apiClient, characterId }: CharacterQueryParameters) => ({
    key: PRIVATE_QUERY_KEYS.characterOverview(characterId),
    query: async ({ signal }) => {
      const response = await apiClient.api.me.characters[':characterId'].$get(
        { param: { characterId: String(characterId) } },
        { init: { signal } },
      )
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Character overview is unavailable.')
      }
      return response.json()
    },
    ...QUERY_POLICY.characterOverview,
  }),
)

export const characterSkillsQuery = defineQueryOptions(
  ({ apiClient, characterId }: CharacterQueryParameters) => ({
    key: PRIVATE_QUERY_KEYS.characterSkills(characterId),
    query: async ({ signal }) => {
      const response = await apiClient.api.me.characters[':characterId'].skills.$get(
        { param: { characterId: String(characterId) } },
        { init: { signal } },
      )
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Character skills are unavailable.')
      }
      return response.json()
    },
    ...QUERY_POLICY.characterSkills,
  }),
)

export const characterHistoryQuery = defineQueryOptions(
  ({ apiClient, characterId }: CharacterQueryParameters) => ({
    key: PRIVATE_QUERY_KEYS.characterHistory(characterId),
    query: async ({ signal }) => {
      const response = await apiClient.api.me.characters[':characterId'].history.$get(
        { param: { characterId: String(characterId) } },
        { init: { signal } },
      )
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Employment history is unavailable.')
      }
      return response.json()
    },
    ...QUERY_POLICY.characterHistory,
  }),
)
