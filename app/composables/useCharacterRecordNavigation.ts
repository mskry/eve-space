import { useQueryCache } from '@pinia/colada'
import { usePlatformNavigation } from '#imports'
import type { ComputedRef } from 'vue'
import { computed } from 'vue'
import { characterHistoryQuery, characterSkillsQuery } from '../queries/characters'
import { prefetchProtectedQuery } from '../queries/query-cache'
import { walletQuery } from '../queries/wallet'
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
}

export function useCharacterRecordNavigation({
  apiClient,
  authenticated,
  characterId,
}: CharacterRecordNavigationParameters) {
  const route = useRoute()
  const queryCache = useQueryCache()
  const { navigation } = usePlatformNavigation('character')
  const entries = computed(() => resolveCharacterNavigation(navigation.value, characterId.value))
  const activeEntry = computed(() => findActiveCharacterNavigationEntry(entries.value, route.path))
  const breadcrumbLabel = computed(() => activeEntry.value?.label ?? '')

  const prefetchers: Readonly<Record<string, () => void>> = {
    'core-character-skills': () => {
      void prefetchProtectedQuery(
        queryCache,
        characterSkillsQuery({ apiClient, characterId: characterId.value ?? 0 }),
        import.meta.client,
        authenticated.value,
        characterId.value,
      )
    },
    'core-character-wallet': () => {
      void prefetchProtectedQuery(
        queryCache,
        walletQuery({ apiClient, characterId: characterId.value ?? 0 }),
        import.meta.client,
        authenticated.value,
        characterId.value,
      )
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
  }

  function prefetchNavigation(entry: RecordSectionNavigationEntry) {
    prefetchers[entry.id]?.()
  }

  return { activeEntry, breadcrumbLabel, entries, prefetchNavigation }
}
