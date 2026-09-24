import { useMutation, useQuery, useQueryCache } from '@pinia/colada'
import type { ApiClient } from '../utils/api-client'
import { toApiQueryError } from '../utils/query-error'
import { characterRosterQuery, type CharacterRosterEntry } from '../queries/characters'
import { refreshPrivateAuthorization, removeCharacterQueries } from '../queries/query-cache'
import { reportPrivateQueryAuthorizationDenial } from '../query-persistence/runtime'

export type { CharacterRosterEntry }

export function useCharacterRoster(apiClient: ApiClient) {
  const queryCache = useQueryCache()
  const { authConfig, authLoading, authSession, initializeAuth } = useAuthSession(apiClient)
  const rosterQuery = useQuery({
    ...characterRosterQuery(apiClient),
    enabled: () => import.meta.client && !authLoading.value && authSession.value.authenticated,
  })
  const mainCharacterMutation = useMutation({
    mutation: async (characterId: number) => {
      const response = await apiClient.api.me.characters[':characterId'].main.$patch({
        param: { characterId: String(characterId) },
      })
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Main character could not be changed.')
      }
      return response.json()
    },
  })
  const deleteCharacterMutation = useMutation({
    mutation: async (characterId: number) => {
      const response = await apiClient.api.me.characters[':characterId'].$delete({
        param: { characterId: String(characterId) },
      })
      if (response.status !== 204) {
        throw await toApiQueryError(response, 'Character could not be deleted.')
      }
    },
  })

  const characters = computed(() => rosterQuery.data.value?.characters ?? [])
  // `error` is a completed failed request, `loading` a request in flight, and `unavailable` a query
  // holding no data with neither: no verdict was reached, so it must offer a retry.
  const rosterStatus = computed(() => {
    if (rosterQuery.data.value) {
      return 'idle'
    }
    if (rosterQuery.asyncStatus.value === 'loading') {
      return 'loading'
    }
    if (rosterQuery.status.value === 'error') {
      return 'error'
    }
    return 'unavailable'
  })
  const rosterMessage = computed(() => {
    const error =
      mainCharacterMutation.error.value ??
      deleteCharacterMutation.error.value ??
      rosterQuery.error.value
    return error instanceof Error ? error.message : ''
  })
  const rosterRetryPanel = computed(() => {
    if (rosterStatus.value === 'error') {
      return {
        code: 'ERR / CHARACTERS',
        message: rosterMessage.value || 'Character roster is unavailable.',
        title: 'Characters unavailable',
      }
    }
    if (rosterStatus.value === 'unavailable') {
      return {
        code: 'IDLE / CHARACTERS',
        message: 'No character request is in flight. Retry to load your characters.',
        title: 'Character list not loaded',
      }
    }
    return null
  })
  const mainCharacterPending = computed(() =>
    mainCharacterMutation.asyncStatus.value === 'loading'
      ? mainCharacterMutation.variables.value
      : undefined,
  )
  const deleteCharacterPending = computed(() =>
    deleteCharacterMutation.asyncStatus.value === 'loading'
      ? deleteCharacterMutation.variables.value
      : undefined,
  )

  watch(
    () => rosterQuery.data.value?.characters,
    (currentCharacters, previousCharacters) => {
      if (!currentCharacters || !previousCharacters) {
        return
      }
      const currentCharacterIds = new Set(
        currentCharacters.map((character) => character.characterId),
      )
      for (const character of previousCharacters) {
        if (!currentCharacterIds.has(character.characterId)) {
          removeCharacterQueries(queryCache, character.characterId)
        }
      }
    },
    { flush: 'sync' },
  )

  function loadCharacterRoster() {
    return rosterQuery.refresh()
  }

  function refetchCharacterRoster() {
    return queryCache.invalidateQueries({
      exact: true,
      key: characterRosterQuery(apiClient).key,
    })
  }

  async function selectMainCharacter(characterId: number) {
    if (
      mainCharacterMutation.asyncStatus.value === 'loading' ||
      deleteCharacterMutation.asyncStatus.value === 'loading'
    ) {
      return false
    }

    try {
      const { mainCharacter } = await mainCharacterMutation.mutateAsync(characterId)
      const updateMainCharacter = (character: CharacterRosterEntry) => ({
        ...character,
        isMain: character.characterId === mainCharacter.characterId,
      })
      queryCache.setQueryData(characterRosterQuery(apiClient).key, (roster) => ({
        characters: (roster?.characters ?? characters.value)
          .map(updateMainCharacter)
          .toSorted(
            (left, right) =>
              Number(right.isMain) - Number(left.isMain) ||
              left.name.localeCompare(right.name) ||
              left.characterId - right.characterId,
          ),
      }))
      await initializeAuth(true)
      return true
    } catch (error) {
      reportPrivateQueryAuthorizationDenial(queryCache, { characterId, kind: 'character' }, error)
      return false
    }
  }

  async function removeCharacter(characterId: number) {
    if (
      mainCharacterMutation.asyncStatus.value === 'loading' ||
      deleteCharacterMutation.asyncStatus.value === 'loading'
    ) {
      return false
    }

    try {
      await deleteCharacterMutation.mutateAsync(characterId)
      await refreshPrivateAuthorization(queryCache, { characterId, kind: 'character' })
      return true
    } catch (error) {
      reportPrivateQueryAuthorizationDenial(queryCache, { characterId, kind: 'character' }, error)
      return false
    }
  }

  async function attachCharacter() {
    if (!authConfig.value.configured || !authConfig.value.attachUrl) {
      return false
    }
    await navigateTo(authConfig.value.attachUrl, { external: true })
    return true
  }

  return {
    attachCharacter,
    characters,
    deleteCharacterPending,
    loadCharacterRoster,
    mainCharacterPending,
    refetchCharacterRoster,
    removeCharacter,
    rosterMessage,
    rosterRetryPanel,
    rosterStatus,
    selectMainCharacter,
  }
}
