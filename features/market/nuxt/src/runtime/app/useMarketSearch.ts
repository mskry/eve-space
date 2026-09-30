import { useQuery } from '@pinia/colada'
import { readPlatformApiResponse } from '@eve-space/platform-module-nuxt/runtime'
import { computed, onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import type { MarketCatalogueRevision, MarketType } from './market-catalogue-types'
import { createMarketSearch } from './market-search'

interface MarketCatalogueSource {
  readonly key: string
  readonly tree: { readonly revision: MarketCatalogueRevision }
}

type SearchIndex = {
  readonly kind: 'search-index'
  readonly revision: MarketCatalogueRevision
  readonly types: readonly MarketType[]
}

type MarketSearchStatus = 'idle' | 'loading' | 'ready' | 'unavailable'

const matchesRevision = (index: SearchIndex, source: MarketCatalogueSource) =>
  index.revision.buildNumber === source.tree.revision.buildNumber &&
  index.revision.ingestVersion === source.tree.revision.ingestVersion &&
  index.revision.ingestedAt === source.tree.revision.ingestedAt

export const useMarketSearch = (
  source: Readonly<Ref<MarketCatalogueSource | null>>,
  query: Ref<string>,
  includeIndex: Readonly<Ref<boolean>>,
) => {
  const api = usePlatformApi()
  const active = computed(() => query.value.trim().length >= 4)
  const revisionKey = computed(() => source.value?.key ?? '')
  const indexQuery = useQuery(() => ({
    key: ['market', 'catalogue', revisionKey.value, 'search-index'],
    enabled:
      import.meta.client && Boolean(revisionKey.value) && (active.value || includeIndex.value),
    query: async ({ signal }) => {
      const revision = revisionKey.value
      const result = await readPlatformApiResponse(
        await api.api.modules.market.catalogue.body[':revision']['search-index'].$get(
          { param: { revision } },
          { init: { signal } },
        ),
        'Market search index is unavailable.',
      )
      if (result.kind !== 'search-index') throw new Error('Invalid market search index')
      performance.mark('market-index-decoded')
      return result
    },
  }))
  const index = computed(() => {
    const candidate = indexQuery.data.value
    const current = source.value
    return candidate && current && matchesRevision(candidate, current) ? candidate : null
  })
  const indexStatus = computed(() => {
    if (index.value) return 'ready' as const
    if (indexQuery.asyncStatus.value === 'loading') return 'loading' as const
    return indexQuery.error.value ? ('unavailable' as const) : ('loading' as const)
  })
  const results = ref<MarketType[]>([])
  const ready = ref(false)
  const workerUnavailable = ref(false)
  const attempt = ref(0)
  const status = computed<MarketSearchStatus>(() => {
    if (!active.value) return 'idle'
    if (workerUnavailable.value) return 'unavailable'
    if (!index.value && indexQuery.asyncStatus.value === 'loading') return 'loading'
    if (!index.value && indexQuery.error.value) return 'unavailable'
    return ready.value && index.value ? 'ready' : 'loading'
  })

  let activeSearch: ReturnType<typeof createMarketSearch> | null = null
  let generation = 0
  let querySequence = 0
  let stopSourceWatch: (() => void) | undefined
  let stopWorkerWatch: (() => void) | undefined
  let stopQueryWatch: (() => void) | undefined

  const invalidate = () => {
    generation += 1
    querySequence += 1
    activeSearch?.dispose()
    activeSearch = null
    results.value = []
    ready.value = false
    workerUnavailable.value = false
  }

  const search = async (text: string) => {
    const sequence = ++querySequence
    const revision = revisionKey.value
    const current = activeSearch
    if (!active.value) {
      results.value = []
      return
    }
    if (!current || !ready.value || !revision) return
    try {
      const next = await current.search(text)
      if (
        sequence === querySequence &&
        revision === revisionKey.value &&
        current === activeSearch
      ) {
        results.value = next
      }
    } catch {
      if (sequence !== querySequence || current !== activeSearch) return
      invalidate()
      workerUnavailable.value = true
    }
  }

  const start = async (candidate: SearchIndex | null, revision: string, isActive: boolean) => {
    const currentGeneration = ++generation
    if (!candidate || !revision || !isActive) return
    ready.value = false
    workerUnavailable.value = false
    activeSearch?.dispose()
    activeSearch = null
    querySequence += 1
    let next: ReturnType<typeof createMarketSearch> | null = null
    try {
      const { createMarketSearchWorker } = await import('./market-search-worker')
      if (currentGeneration !== generation) return
      const worker = createMarketSearchWorker(
        candidate.types,
        candidate.types.length >= 30_000 ? 4 : 2,
      )
      next = createMarketSearch(candidate.types, worker)
      await worker.search('a', { limit: 1 })
      if (currentGeneration !== generation) {
        next.dispose()
        return
      }
      activeSearch = next
      ready.value = true
      performance.mark('market-worker-ready')
      await search(query.value)
    } catch {
      next?.dispose()
      if (currentGeneration !== generation) return
      workerUnavailable.value = true
      ready.value = false
    }
  }

  const retry = () => {
    if (!index.value) {
      void indexQuery.refetch()
      return
    }
    attempt.value += 1
  }

  onMounted(() => {
    stopSourceWatch = watch(revisionKey, invalidate, { flush: 'sync' })
    stopWorkerWatch = watch(
      [index, revisionKey, active, attempt],
      ([candidate, revision, isActive]) => {
        void start(candidate, revision, isActive)
      },
      { immediate: true },
    )
    stopQueryWatch = watch(query, (text) => {
      void search(text)
    })
  })
  onUnmounted(() => {
    invalidate()
    stopSourceWatch?.()
    stopWorkerWatch?.()
    stopQueryWatch?.()
  })

  return { index, indexStatus, results, status, retry }
}
