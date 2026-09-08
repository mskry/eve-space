import { defineQueryOptions } from '@pinia/colada'
import type { ApiClient } from '../utils/api-client'
import { isNonnegativeSafeInteger, isPositiveSafeInteger } from '../utils/number-guards'
import { ApiQueryError, toApiQueryError } from '../utils/query-error'
import type { CharacterAssetsAccess } from './character-assets'
import { PRIVATE_QUERY_KEYS } from './query-keys'
import { QUERY_POLICY } from './query-policy'

interface CharacterAssetRoutesQueryParameters {
  apiClient: ApiClient
  characterId: number
  originSystemId: number
  destinationSystemIds: readonly number[]
  access: CharacterAssetsAccess
}

function canonicalAssetRouteDestinationSystemIds(ids: readonly number[]) {
  return [...new Set(ids.filter(isPositiveSafeInteger))].toSorted((left, right) => left - right)
}

export function canRunCharacterAssetRoutesQuery(
  access: CharacterAssetsAccess,
  characterId: number,
  originSystemId: number,
  destinationSystemIds: readonly number[],
) {
  const destinations = canonicalAssetRouteDestinationSystemIds(destinationSystemIds)
  return (
    access.isClient &&
    access.authenticated &&
    access.ownsCharacter &&
    isPositiveSafeInteger(characterId) &&
    isPositiveSafeInteger(originSystemId) &&
    destinations.length > 0 &&
    destinations.length <= 10_000
  )
}

export const characterAssetRoutesQuery = defineQueryOptions(
  ({
    apiClient,
    characterId,
    originSystemId,
    destinationSystemIds,
    access,
  }: CharacterAssetRoutesQueryParameters) => {
    const destinations = canonicalAssetRouteDestinationSystemIds(destinationSystemIds)
    return {
      key: PRIVATE_QUERY_KEYS.characterAssetRoutes(characterId, originSystemId, destinations),
      query: async ({ signal }) => {
        const response = await apiClient.api.universe.routes.$post(
          {
            json: {
              originSystemId,
              destinationSystemIds: destinations,
              policy: { kind: 'shortest' },
            },
          },
          { init: { signal } },
        )
        if (response.status !== 200) {
          throw await toApiQueryError(response, 'Asset route distances are unavailable.')
        }

        const result = await response.json()
        if (
          result.originSystemId !== originSystemId ||
          result.policy.kind !== 'shortest' ||
          result.routes.length !== destinations.length ||
          result.routes.some(
            (route, index) =>
              route.destinationSystemId !== destinations[index] ||
              (route.jumps !== null && !isNonnegativeSafeInteger(route.jumps)),
          )
        ) {
          throw new ApiQueryError('Asset routes response did not match the requested identity.', {
            status: 409,
            code: 'ASSET_ROUTES_IDENTITY_MISMATCH',
          })
        }
        return result
      },
      ...QUERY_POLICY.characterAssetRoutes,
      enabled: canRunCharacterAssetRoutesQuery(access, characterId, originSystemId, destinations),
    }
  },
)
