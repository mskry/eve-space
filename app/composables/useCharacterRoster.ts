import { useMutation, useQuery, useQueryCache } from '@pinia/colada'
import type { ApiClient } from '../utils/api-client'
import { toApiQueryError } from '../utils/query-error'
import { characterRosterQuery, type CharacterRosterEntry } from '../queries/characters'
import { removeCharacterQueries } from '../queries/query-cache'

export type { CharacterRosterEntry }

export function useCharacterRoster(apiClient: ApiClient) {
  const queryCache = useQueryCache()
  const { authConfig, authSession, initializeAuth } = useAuthSession(apiClient)
  const rosterQuery = useQuery({
    ...characterRosterQuery(apiClient),
    enabled: () => import.meta.client && authSession.value.authenticated,
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
  const rosterStatus = computed(() => {
    if (rosterQuery.status.value === 'error' && !rosterQuery.data.value) return 'error'
    if (rosterQuery.asyncStatus.value === 'loading' && !rosterQuery.data.value) return 'loading'
    return 'idle'
  })
  const rosterMessage = computed(() => {
    const error =
      mainCharacterMutation.error.value ??
      deleteCharacterMutation.error.value ??
      rosterQuery.error.value
    return error instanceof Error ? error.message : ''
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

  function loadCharacterRoster() {
    return rosterQuery.refresh()
  }

  function refetchCharacterRoster() {
    return rosterQuery.refetch()
  }

  async function selectMainCharacter(characterId: number) {
    if (
      mainCharacterMutation.asyncStatus.value === 'loading' ||
      deleteCharacterMutation.asyncStatus.value === 'loading'
    )
      return false

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
    } catch {
      return false
    }
  }

  async function removeCharacter(characterId: number) {
    if (
      mainCharacterMutation.asyncStatus.value === 'loading' ||
      deleteCharacterMutation.asyncStatus.value === 'loading'
    )
      return false

    try {
      await deleteCharacterMutation.mutateAsync(characterId)
      queryCache.setQueryData(characterRosterQuery(apiClient).key, (roster) => ({
        characters: (roster?.characters ?? characters.value).filter(
          (character) => character.characterId !== characterId,
        ),
      }))
      removeCharacterQueries(queryCache, characterId)
      return true
    } catch {
      return false
    }
  }

  async function attachCharacter() {
    if (!authConfig.value.configured || !authConfig.value.attachUrl) return false
    await navigateTo(authConfig.value.attachUrl, { external: true })
    return true
  }

  return {
    attachCharacter,
    characters,
    deleteCharacterPending,
    loadCharacterRoster,
    mainCharacterPending,
    rosterMessage,
    rosterStatus,
    removeCharacter,
    refetchCharacterRoster,
    selectMainCharacter,
  }
}
