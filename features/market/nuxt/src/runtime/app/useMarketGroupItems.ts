import { useQuery } from '@pinia/colada'
import { readPlatformApiResponse } from '@eve-space/platform-module-nuxt/runtime'
import { computed, ref, watch, type Ref } from 'vue'
import type { MarketType } from './market-catalogue-types'

type MarketGroupItemsStatus = 'idle' | 'loading' | 'ready' | 'unavailable'

export const useMarketGroupItems = (
  revision: Readonly<Ref<string>>,
  groupId: Readonly<Ref<number>>,
  enabled: Readonly<Ref<boolean>>,
) => {
  const api = usePlatformApi()
  const cursor = ref<string | null>(null)
  const nextCursor = ref<string | null>(null)
  const items = ref<MarketType[]>([])
  const failed = ref(false)
  let loadedCursor: string | null | undefined
  let loadingNextPage = false

  const reset = () => {
    cursor.value = null
    nextCursor.value = null
    items.value = []
    loadedCursor = undefined
    loadingNextPage = false
    failed.value = false
  }
  watch([revision, groupId], reset, { flush: 'sync' })

  const pageQuery = useQuery(() => ({
    key: ['market', 'catalogue', revision.value, 'group', groupId.value, cursor.value ?? 'first'],
    enabled: import.meta.client && Boolean(revision.value) && enabled.value,
    query: async ({ signal }) => {
      const requestedCursor = cursor.value
      const requestedRevision = revision.value
      const requestedGroupId = groupId.value
      try {
        const result = await readPlatformApiResponse(
          await api.api.modules.market.catalogue.body[':revision'].groups[':groupId'].types.$get(
            {
              param: { revision: requestedRevision, groupId: String(requestedGroupId) },
              query: requestedCursor ? { cursor: requestedCursor } : {},
            },
            { init: { signal } },
          ),
          'Market items are unavailable.',
        )
        if (result.kind !== 'group-types' || result.groupId !== requestedGroupId) {
          throw new Error('Market item page does not match its group')
        }
        return { result, requestedCursor, requestedRevision, requestedGroupId }
      } catch (error) {
        if (
          requestedRevision === revision.value &&
          requestedGroupId === groupId.value &&
          requestedCursor === cursor.value
        ) {
          failed.value = true
        }
        throw error
      }
    },
  }))

  watch(
    () => pageQuery.data.value,
    (page) => {
      if (!page || page.requestedRevision !== revision.value) return
      if (page.requestedGroupId !== groupId.value || page.requestedCursor !== cursor.value) return
      if (page.requestedCursor === null) items.value = [...page.result.items]
      else if (loadedCursor !== page.requestedCursor) {
        const seen = new Set(items.value.map(({ id }) => id))
        items.value = [...items.value, ...page.result.items.filter(({ id }) => !seen.has(id))]
      }
      loadedCursor = page.requestedCursor
      nextCursor.value = page.result.nextCursor
      loadingNextPage = false
      failed.value = false
    },
    { immediate: true },
  )

  const status = computed<MarketGroupItemsStatus>(() => {
    if (!enabled.value) return 'idle'
    if (failed.value) return 'unavailable'
    if (pageQuery.asyncStatus.value === 'loading') return 'loading'
    if (pageQuery.error.value) return 'unavailable'
    return 'ready'
  })
  const hasMore = computed(() => Boolean(nextCursor.value))
  const loadMore = () => {
    if (!enabled.value || !nextCursor.value || loadingNextPage || status.value === 'loading')
      return false
    const following = nextCursor.value
    loadingNextPage = true
    failed.value = false
    nextCursor.value = null
    cursor.value = following
    return true
  }
  const retry = () => {
    failed.value = false
    void pageQuery.refetch()
  }
  return { items, status, hasMore, loadMore, retry }
}
