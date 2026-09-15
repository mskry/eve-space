import { useQueryCache, type EntryKey } from '@pinia/colada'
import type { MaybeRefOrGetter } from 'vue'
import { readQueryPersistenceState } from '../query-persistence/runtime'

export function useQueryPersistencePresentation(key: MaybeRefOrGetter<EntryKey>) {
  return readQueryPersistenceState(useQueryCache(), key)
}
