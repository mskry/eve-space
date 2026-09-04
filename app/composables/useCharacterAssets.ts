import { useQuery } from '@pinia/colada'
import { computed, shallowRef, watch, type ComputedRef, type Ref } from 'vue'
import { characterAssetsQuery, type CharacterAssetsAccess } from '../queries/character-assets'
import type { ApiClient } from '../utils/api-client'
import {
  mapCharacterAssets,
  mapCharacterAssetsResourceState,
} from '../utils/character-assets-mapper'
import { useCharacterReauthorization } from './useCharacterReauthorization'

interface CharacterAssetsOptions {
  apiClient: ApiClient
  authenticated: Readonly<Ref<boolean>>
  characterId: ComputedRef<number | undefined>
  characters: Readonly<Ref<readonly { characterId: number }[]>>
  isClient?: boolean
  registerReauthorization?: typeof useCharacterReauthorization
}

export function useCharacterAssets(options: CharacterAssetsOptions) {
  const isClient = options.isClient ?? import.meta.client
  const access = computed<CharacterAssetsAccess>(() => ({
    isClient,
    authenticated: options.authenticated.value,
    ownsCharacter: options.characters.value.some(
      (entry) => entry.characterId === options.characterId.value,
    ),
  }))
  const assetsQuery = useQuery(() =>
    characterAssetsQuery({
      apiClient: options.apiClient,
      characterId: options.characterId.value ?? 0,
      access: access.value,
    }),
  )
  const refreshError = shallowRef<unknown>(null)
  const assets = computed(() =>
    assetsQuery.data.value ? mapCharacterAssets(assetsQuery.data.value) : null,
  )
  const loading = computed(
    () => assetsQuery.status.value === 'pending' || assetsQuery.asyncStatus.value === 'loading',
  )
  const state = computed(() =>
    mapCharacterAssetsResourceState({
      data: assets.value,
      error: refreshError.value ?? assetsQuery.error.value,
      loading: loading.value,
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
    refreshAssets,
    state,
  }
}
