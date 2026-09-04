import { defineQueryOptions } from '@pinia/colada'
import type { InferResponseType } from 'hono/client'
import type { ApiClient } from '../utils/api-client'
import { ApiQueryError, toApiQueryError } from '../utils/query-error'
import { PRIVATE_QUERY_KEYS } from './query-keys'
import { QUERY_POLICY } from './query-policy'

type CharacterClient = ApiClient['api']['me']['characters'][':characterId']

export type CharacterAssetsResponse = InferResponseType<CharacterClient['assets']['$get'], 200>

export interface CharacterAssetsAccess {
  isClient: boolean
  authenticated: boolean
  ownsCharacter: boolean
}

interface CharacterAssetsQueryParameters {
  apiClient: ApiClient
  characterId: number
  access: CharacterAssetsAccess
}

export function canRunCharacterAssetsQuery(access: CharacterAssetsAccess, characterId: number) {
  return (
    access.isClient &&
    access.authenticated &&
    access.ownsCharacter &&
    Number.isSafeInteger(characterId) &&
    characterId > 0
  )
}

export const characterAssetsQuery = defineQueryOptions(
  ({ apiClient, characterId, access }: CharacterAssetsQueryParameters) => ({
    key: PRIVATE_QUERY_KEYS.characterAssets(characterId),
    query: async ({ signal }) => {
      const response = await apiClient.api.me.characters[':characterId'].assets.$get(
        { param: { characterId: String(characterId) } },
        { init: { signal } },
      )
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Character assets are unavailable.')
      }

      const assets: CharacterAssetsResponse = await response.json()
      if (assets.characterId !== characterId) {
        throw new ApiQueryError('Assets response did not match the requested identity.', {
          status: 409,
          code: 'ASSETS_IDENTITY_MISMATCH',
        })
      }
      return assets
    },
    ...QUERY_POLICY.characterAssets,
    enabled: canRunCharacterAssetsQuery(access, characterId),
  }),
)
