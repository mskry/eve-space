import { useQueryCache } from '@pinia/colada'
import type { ComputedRef } from 'vue'
import { computed } from 'vue'
import {
  characterAttributesQuery,
  characterHistoryQuery,
  characterSkillQueueQuery,
  characterSkillsQuery,
} from '../queries/characters'
import { characterClonesQuery, characterImplantsQuery } from '../queries/clones'
import { characterFinanceBalanceQuery, characterFinanceJournalQuery } from '../queries/finance'
import { mailHeadersQuery, mailingListsQuery, mailLabelsQuery } from '../queries/mail'
import { prefetchProtectedQuery } from '../queries/query-cache'
import type { RecordSectionNavigationEntry } from '../types/record-navigation'
import type { ApiClient } from '../utils/api-client'
import {
  findActiveCharacterNavigationEntry,
  resolveCharacterNavigation,
} from '../utils/character-navigation'

interface CharacterRecordNavigationParameters {
  readonly apiClient: ApiClient
  readonly authenticated: ComputedRef<boolean>
  readonly authenticationReady: ComputedRef<boolean>
  readonly characterId: ComputedRef<number | undefined>
  readonly ownsCharacter: ComputedRef<boolean>
}

export function useCharacterRecordNavigation({
  apiClient,
  authenticated,
  authenticationReady,
  characterId,
  ownsCharacter,
}: CharacterRecordNavigationParameters) {
  const route = useRoute()
  const queryCache = useQueryCache()
  const { navigation } = usePlatformNavigation('character')
  const entries = computed(() => resolveCharacterNavigation(navigation.value, characterId.value))
  const activeEntry = computed(() => findActiveCharacterNavigationEntry(entries.value, route.path))
  const breadcrumbLabel = computed(() => activeEntry.value?.label ?? '')

  const prefetchers = new Map(
    Object.entries({
      'core-character-clones': () => {
        const id = characterId.value ?? 0
        const access = protectedQueryAccess()
        void Promise.all([
          prefetchProtectedQuery(
            queryCache,
            characterClonesQuery({ apiClient, characterId: id, access }),
            access,
            characterId.value,
          ),
          prefetchProtectedQuery(
            queryCache,
            characterImplantsQuery({ apiClient, characterId: id, access }),
            access,
            characterId.value,
          ),
        ])
      },
      'core-character-finance': () => {
        const id = characterId.value ?? 0
        const access = protectedQueryAccess()
        void Promise.all([
          prefetchProtectedQuery(
            queryCache,
            characterFinanceBalanceQuery({ apiClient, characterId: id, access }),
            access,
            characterId.value,
          ),
          prefetchProtectedQuery(
            queryCache,
            characterFinanceJournalQuery({
              apiClient,
              characterId: id,
              access,
              requested: true,
              page: 1,
            }),
            access,
            characterId.value,
          ),
        ])
      },
      'core-character-history': () => {
        void prefetchProtectedQuery(
          queryCache,
          characterHistoryQuery({ apiClient, characterId: characterId.value ?? 0 }),
          protectedQueryAccess(),
          characterId.value,
        )
      },
      'core-character-mail': () => {
        const id = characterId.value ?? 0
        const access = protectedQueryAccess()
        void Promise.all([
          prefetchProtectedQuery(
            queryCache,
            mailHeadersQuery({ apiClient, characterId: id }),
            access,
            characterId.value,
          ),
          prefetchProtectedQuery(
            queryCache,
            mailLabelsQuery({ apiClient, characterId: id }),
            access,
            characterId.value,
          ),
          prefetchProtectedQuery(
            queryCache,
            mailingListsQuery({ apiClient, characterId: id }),
            access,
            characterId.value,
          ),
        ])
      },
      'core-character-skills': () => {
        const id = characterId.value ?? 0
        const access = protectedQueryAccess()
        void Promise.all([
          prefetchProtectedQuery(
            queryCache,
            characterSkillsQuery({ apiClient, characterId: id }),
            access,
            characterId.value,
          ),
          prefetchProtectedQuery(
            queryCache,
            characterAttributesQuery({ apiClient, characterId: id }),
            access,
            characterId.value,
          ),
          prefetchProtectedQuery(
            queryCache,
            characterSkillQueueQuery({ apiClient, characterId: id }),
            access,
            characterId.value,
          ),
        ])
      },
    }),
  )

  function protectedQueryAccess() {
    return {
      authenticated: authenticated.value,
      authenticationReady: authenticationReady.value,
      isClient: import.meta.client,
      ownsCharacter: ownsCharacter.value,
    }
  }

  function prefetchNavigation(entry: RecordSectionNavigationEntry) {
    if (!ownsCharacter.value) {
      return
    }
    prefetchers.get(entry.id)?.()
  }

  return { activeEntry, breadcrumbLabel, entries, prefetchNavigation }
}
