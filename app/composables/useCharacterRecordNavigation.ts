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
  readonly characterId: ComputedRef<number | undefined>
  readonly ownsCharacter: ComputedRef<boolean>
}

export function useCharacterRecordNavigation({
  apiClient,
  authenticated,
  characterId,
  ownsCharacter,
}: CharacterRecordNavigationParameters) {
  const route = useRoute()
  const queryCache = useQueryCache()
  const { navigation } = usePlatformNavigation('character')
  const entries = computed(() => resolveCharacterNavigation(navigation.value, characterId.value))
  const activeEntry = computed(() => findActiveCharacterNavigationEntry(entries.value, route.path))
  const breadcrumbLabel = computed(() => activeEntry.value?.label ?? '')

  const prefetchers: Readonly<Record<string, () => void>> = {
    'core-character-skills': () => {
      const id = characterId.value ?? 0
      void Promise.all([
        prefetchProtectedQuery(
          queryCache,
          characterSkillsQuery({ apiClient, characterId: id }),
          import.meta.client,
          authenticated.value,
          characterId.value,
        ),
        prefetchProtectedQuery(
          queryCache,
          characterAttributesQuery({ apiClient, characterId: id }),
          import.meta.client,
          authenticated.value,
          characterId.value,
        ),
        prefetchProtectedQuery(
          queryCache,
          characterSkillQueueQuery({ apiClient, characterId: id }),
          import.meta.client,
          authenticated.value,
          characterId.value,
        ),
      ])
    },
    'core-character-clones': () => {
      const id = characterId.value ?? 0
      const access = {
        isClient: import.meta.client,
        authenticated: authenticated.value,
        ownsCharacter: ownsCharacter.value,
      }
      void Promise.all([
        prefetchProtectedQuery(
          queryCache,
          characterClonesQuery({ apiClient, characterId: id, access }),
          import.meta.client,
          authenticated.value,
          characterId.value,
        ),
        prefetchProtectedQuery(
          queryCache,
          characterImplantsQuery({ apiClient, characterId: id, access }),
          import.meta.client,
          authenticated.value,
          characterId.value,
        ),
      ])
    },
    'core-character-finance': () => {
      const id = characterId.value ?? 0
      const access = {
        isClient: import.meta.client,
        authenticated: authenticated.value,
        ownsCharacter: ownsCharacter.value,
      }
      void Promise.all([
        prefetchProtectedQuery(
          queryCache,
          characterFinanceBalanceQuery({ apiClient, characterId: id, access }),
          import.meta.client,
          authenticated.value,
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
          import.meta.client,
          authenticated.value,
          characterId.value,
        ),
      ])
    },
    'core-character-history': () => {
      void prefetchProtectedQuery(
        queryCache,
        characterHistoryQuery({ apiClient, characterId: characterId.value ?? 0 }),
        import.meta.client,
        authenticated.value,
        characterId.value,
      )
    },
    'core-character-mail': () => {
      const id = characterId.value ?? 0
      void Promise.all([
        prefetchProtectedQuery(
          queryCache,
          mailHeadersQuery({ apiClient, characterId: id }),
          import.meta.client,
          authenticated.value,
          characterId.value,
        ),
        prefetchProtectedQuery(
          queryCache,
          mailLabelsQuery({ apiClient, characterId: id }),
          import.meta.client,
          authenticated.value,
          characterId.value,
        ),
        prefetchProtectedQuery(
          queryCache,
          mailingListsQuery({ apiClient, characterId: id }),
          import.meta.client,
          authenticated.value,
          characterId.value,
        ),
      ])
    },
  }

  function prefetchNavigation(entry: RecordSectionNavigationEntry) {
    if (!ownsCharacter.value) return
    prefetchers[entry.id]?.()
  }

  return { activeEntry, breadcrumbLabel, entries, prefetchNavigation }
}
