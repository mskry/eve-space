import {
  characterEsiPersistence,
  defineEsiQueryOptions,
} from '@eve-space/platform-module-nuxt/runtime'
import type { InferResponseType } from 'hono/client'
import type { ApiClient } from '../utils/api-client'
import { toApiQueryError } from '../utils/query-error'
import { PRIVATE_QUERY_KEYS } from './query-keys'
import { QUERY_POLICY } from './query-policy'

type CharacterRosterResponse = InferResponseType<ApiClient['api']['me']['characters']['$get'], 200>
type PublicCharacterResponse = InferResponseType<
  ApiClient['api']['characters'][':characterId']['$get'],
  200
>
export type CharacterRosterEntry = CharacterRosterResponse['characters'][number]
export type CharacterOverview = InferResponseType<
  ApiClient['api']['me']['characters'][':characterId']['$get'],
  200
>
export type CharacterAttributes = InferResponseType<
  ApiClient['api']['me']['characters'][':characterId']['attributes']['$get'],
  200
>
export type CharacterSkillQueue = InferResponseType<
  ApiClient['api']['me']['characters'][':characterId']['skill-queue']['$get'],
  200
>
export type CharacterSkills = InferResponseType<
  ApiClient['api']['me']['characters'][':characterId']['skills']['$get'],
  200
>

interface CharacterQueryParameters {
  apiClient: ApiClient
  characterId: number
}

export const characterRosterQuery = defineEsiQueryOptions((apiClient: ApiClient) => ({
  key: PRIVATE_QUERY_KEYS.roster(),
  query: async ({ signal }) => {
    const response = await apiClient.api.me.characters.$get(undefined, { init: { signal } })
    if (response.status !== 200) {
      throw await toApiQueryError(response, 'Character roster is unavailable.')
    }
    return response.json()
  },
  ...QUERY_POLICY.characterRoster,
  esiPersistence: { kind: 'none' },
}))

export const publicCharacterQuery = defineEsiQueryOptions(
  ({ apiClient, characterId }: CharacterQueryParameters) => ({
    key: PRIVATE_QUERY_KEYS.characterRecord(characterId),
    query: async ({ signal }) => {
      const response = await apiClient.api.characters[':characterId'].$get(
        { param: { characterId: String(characterId) } },
        { init: { signal } },
      )
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Character is unavailable.')
      }
      return response.json() as Promise<PublicCharacterResponse>
    },
    ...QUERY_POLICY.character,
    esiPersistence: { kind: 'none' },
  }),
)

export const characterOverviewQuery = defineEsiQueryOptions(
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
    esiPersistence: characterEsiPersistence(characterId),
  }),
)

export const characterAttributesQuery = defineEsiQueryOptions(
  ({ apiClient, characterId }: CharacterQueryParameters) => ({
    key: PRIVATE_QUERY_KEYS.characterAttributes(characterId),
    query: async ({ signal }) => {
      const response = await apiClient.api.me.characters[':characterId'].attributes.$get(
        { param: { characterId: String(characterId) } },
        { init: { signal } },
      )
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Character attributes are unavailable.')
      }
      return response.json()
    },
    ...QUERY_POLICY.characterAttributes,
    esiPersistence: characterEsiPersistence(characterId),
  }),
)

export const characterSkillsQuery = defineEsiQueryOptions(
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
    esiPersistence: characterEsiPersistence(characterId),
  }),
)

export const characterSkillQueueQuery = defineEsiQueryOptions(
  ({ apiClient, characterId }: CharacterQueryParameters) => ({
    key: PRIVATE_QUERY_KEYS.characterSkillQueue(characterId),
    query: async ({ signal }) => {
      const response = await apiClient.api.me.characters[':characterId']['skill-queue'].$get(
        { param: { characterId: String(characterId) } },
        { init: { signal } },
      )
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Character skill queue is unavailable.')
      }
      return response.json()
    },
    ...QUERY_POLICY.characterSkillQueue,
    esiPersistence: characterEsiPersistence(characterId),
  }),
)

export const characterHistoryQuery = defineEsiQueryOptions(
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
    esiPersistence: characterEsiPersistence(characterId),
  }),
)
