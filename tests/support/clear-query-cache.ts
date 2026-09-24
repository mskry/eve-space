import { useQueryCache } from '@pinia/colada'

export function clearQueryCache() {
  const queryCache = useQueryCache()
  const entries = queryCache.getEntries()

  // setQueryData can create entries before plugins extend them; initialize those before plugin hooks run.
  for (const entry of entries) {
    if (!entry.options) {
      queryCache.ensure({ key: entry.key, query: () => Promise.resolve(undefined) })
    }
  }

  queryCache.cancelQueries()
  for (const entry of entries) {
    queryCache.remove(entry)
  }
}
