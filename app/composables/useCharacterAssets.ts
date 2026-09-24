import { useQuery } from '@pinia/colada'
import { computed, shallowRef, watch, type ComputedRef, type Ref } from 'vue'
import { characterAssetRoutesQuery } from '../queries/character-asset-routes'
import { characterAssetsQuery } from '../queries/character-assets'
import {
  canRunProtectedCharacterQuery,
  type ProtectedCharacterQueryAccess,
} from '../queries/protected-character-query-access'
import type { ApiClient } from '../utils/api-client'
import { buildAssetHierarchy } from '../utils/assets-hierarchy'
import {
  mapCharacterAssets,
  mapCharacterAssetsResourceState,
} from '../utils/character-assets-mapper'
import { useCharacterReauthorization } from './useCharacterReauthorization'
import { useCharacterOwnership } from './useCharacterOwnership'

interface CharacterAssetsOptions {
  apiClient: ApiClient
  authenticated: Readonly<Ref<boolean>>
  authenticationReady: Readonly<Ref<boolean>>
  characterId: ComputedRef<number | undefined>
  characters: Readonly<
    Ref<
      readonly {
        characterId: number
        location?: { solarSystemId: number } | null
      }[]
    >
  >
  isClient?: boolean
  registerReauthorization?: typeof useCharacterReauthorization
}

export function useCharacterAssets(options: CharacterAssetsOptions) {
  const isClient = options.isClient ?? import.meta.client
  const ownsCharacter = useCharacterOwnership(options.characterId, options.characters)
  const access = computed<ProtectedCharacterQueryAccess>(() => ({
    authenticated: options.authenticated.value,
    authenticationReady: options.authenticationReady.value,
    isClient,
    ownsCharacter: ownsCharacter.value,
  }))
  const assetsQuery = useQuery(() =>
    characterAssetsQuery({
      access: access.value,
      apiClient: options.apiClient,
      characterId: options.characterId.value ?? 0,
    }),
  )
  const refreshError = shallowRef<unknown>(null)
  const assets = computed(() =>
    assetsQuery.data.value ? mapCharacterAssets(assetsQuery.data.value) : null,
  )
  const hierarchy = computed(() => buildAssetHierarchy(assets.value?.assets ?? []))
  const originSystemId = computed(
    () =>
      options.characters.value.find((entry) => entry.characterId === options.characterId.value)
        ?.location?.solarSystemId ?? 0,
  )
  const destinationSystemIds = computed(() =>
    [
      ...new Set(
        hierarchy.value.flatMap((group) =>
          group.solarSystemId === null ? [] : [group.solarSystemId],
        ),
      ),
    ].toSorted((left, right) => left - right),
  )
  const routesQuery = useQuery(() =>
    characterAssetRoutesQuery({
      access: access.value,
      apiClient: options.apiClient,
      characterId: options.characterId.value ?? 0,
      destinationSystemIds: destinationSystemIds.value,
      originSystemId: originSystemId.value,
    }),
  )
  const routeJumpsBySystemId = computed<ReadonlyMap<number, number>>(
    () =>
      new Map(
        routesQuery.data.value?.routes.flatMap((route) =>
          route.jumps === null ? [] : [[route.destinationSystemId, route.jumps] as const],
        ) ?? [],
      ),
  )
  const routeRankBySystemId = computed<ReadonlyMap<number, number>>(
    () =>
      new Map(
        routesQuery.data.value?.routes.map((route, index) => [route.destinationSystemId, index]) ??
          [],
      ),
  )
  const loading = computed(() => assetsQuery.asyncStatus.value === 'loading')
  const parked = computed(
    () =>
      canRunProtectedCharacterQuery(access.value, options.characterId.value ?? 0) &&
      assetsQuery.status.value === 'pending' &&
      assetsQuery.asyncStatus.value === 'idle' &&
      assetsQuery.data.value === undefined,
  )
  const state = computed(() =>
    mapCharacterAssetsResourceState({
      data: assets.value,
      error: refreshError.value ?? assetsQuery.error.value,
      loading: loading.value,
      parked: parked.value,
    }),
  )

  async function refreshAssets() {
    try {
      const result = await assetsQuery.refetch(true)
      refreshError.value = null
      return result
    } catch (error) {
      refreshError.value = error
      return assetsQuery.state.value
    }
  }

  watch(options.characterId, () => {
    refreshError.value = null
  })
  watch(assetsQuery.data, () => {
    refreshError.value = null
  })

  const registerReauthorization = options.registerReauthorization ?? useCharacterReauthorization
  registerReauthorization(options.characterId, refreshAssets)

  return {
    access,
    assets,
    assetsQuery,
    hierarchy,
    refreshAssets,
    routeJumpsBySystemId,
    routeRankBySystemId,
    routesQuery,
    state,
  }
}
