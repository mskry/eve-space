import { ApiQueryError } from '@eve-space/platform-module-nuxt/runtime'
import { computed, nextTick, onScopeDispose, reactive, ref, watch, type Ref } from 'vue'
import { useMarketOrderPage, type MarketOrderSelector } from './market-order-query'
import { unavailableMarketSide } from './market-graphql-adapters'
import type { MarketObservedBook, MarketSide } from './market-models'

const cursorHistoryLimit = 50

export type MarketPageDirection = 'next' | 'previous'
export type MarketPagingFailure = 'side' | 'page' | 'observation' | null

interface PageRequest {
  readonly index: number
  readonly cursor: string
  readonly direction: MarketPageDirection
}

export const useMarketOrderPaging = (
  book: Readonly<Ref<MarketObservedBook>>,
  side: Readonly<Ref<'sell' | 'buy'>>,
) => {
  const source = computed(() => (side.value === 'sell' ? book.value.sellers : book.value.buyers))
  const identity = computed(() =>
    [
      book.value.observation.profileId,
      book.value.profileRevision,
      book.value.observation.typeId,
      book.value.observation.observationId,
      side.value,
    ].join(':'),
  )
  const selector = ref<MarketOrderSelector | null>(null)
  const query = useMarketOrderPage(selector)
  const current = ref<MarketSide>(source.value)
  const index = ref(0)
  const loading = ref(false)
  const pageFailed = ref(false)
  const observationUnavailable = ref(false)
  const cursors = reactive(new Map<number, string>())
  let pending: PageRequest | null = null
  let controller: AbortController | null = null

  const cancel = () => {
    controller?.abort()
    query.cancel()
    selector.value = null
  }
  const invalidateObservation = () => {
    cancel()
    current.value = unavailableMarketSide('MARKET_OBSERVATION_UNAVAILABLE')
    observationUnavailable.value = true
    cursors.clear()
    loading.value = false
    pending = null
  }
  const reset = () => {
    cancel()
    observationUnavailable.value = false
    current.value = source.value
    index.value = 0
    cursors.clear()
    loading.value = false
    pageFailed.value = false
    pending = null
  }
  watch(identity, reset, { flush: 'sync' })
  watch(
    source,
    (page) => {
      if (page.error === 'MARKET_OBSERVATION_UNAVAILABLE') {
        invalidateObservation()
        return
      }
      if (index.value === 0 && !loading.value && !observationUnavailable.value) current.value = page
    },
    { immediate: true, flush: 'sync' },
  )
  onScopeDispose(cancel)

  const failure = computed<MarketPagingFailure>(() => {
    if (observationUnavailable.value) return 'observation'
    if (pageFailed.value) return 'page'
    return current.value.kind === 'unavailable' ? 'side' : null
  })
  const page = computed(() => ({
    index: index.value,
    rows: current.value.rows,
    hasMore: current.value.hasMore,
  }))
  const canPrevious = computed(() => index.value === 1 || cursors.has(index.value - 1))
  const requestPage = async (request: PageRequest): Promise<MarketPageDirection | null> => {
    cancel()
    const attempt = new AbortController()
    controller = attempt
    loading.value = true
    pageFailed.value = false
    pending = request
    const selectedIdentity = identity.value
    const observation = book.value.observation
    selector.value = {
      profileId: observation.profileId,
      profileRevision: book.value.profileRevision,
      typeId: observation.typeId,
      observationId: observation.observationId,
      side: side.value,
      after: request.cursor,
    }
    try {
      await nextTick()
      if (attempt.signal.aborted) return null
      const result = await query.refresh()
      if (attempt.signal.aborted || selectedIdentity !== identity.value) return null
      if (result.error) throw result.error
      if (!result.data) throw new Error('Market order page is unavailable.')
      current.value = result.data
      index.value = request.index
      pending = null
      return request.direction
    } catch (error) {
      if (attempt.signal.aborted || selectedIdentity !== identity.value) return null
      pageFailed.value = true
      if (error instanceof ApiQueryError && error.code === 'MARKET_OBSERVATION_UNAVAILABLE')
        invalidateObservation()
      return null
    } finally {
      if (controller === attempt) loading.value = false
    }
  }
  const first = (): MarketPageDirection | null => {
    if (loading.value || observationUnavailable.value) return null
    cancel()
    current.value = source.value
    index.value = 0
    pageFailed.value = false
    pending = null
    return 'previous'
  }
  const next = async () => {
    const cursor = current.value.nextCursor
    if (!cursor || loading.value || observationUnavailable.value) return null
    const following = index.value + 1
    cursors.set(following, cursor)
    for (const known of cursors.keys())
      if (known < following - cursorHistoryLimit + 1) cursors.delete(known)
    return requestPage({ index: following, cursor, direction: 'next' })
  }
  const previous = async () => {
    if (loading.value || !canPrevious.value || observationUnavailable.value) return null
    if (index.value === 1) return first()
    const cursor = cursors.get(index.value - 1)
    return cursor ? requestPage({ index: index.value - 1, cursor, direction: 'previous' }) : null
  }
  const retry = async () => (pending ? requestPage(pending) : null)
  return { page, identity, loading, failure, canPrevious, next, previous, first, retry }
}
