import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import { marketBookState } from './market-book-state'
import { useMarketInitialOrders } from './useMarketInitialOrders'
import {
  marketSelection,
  useMarketBookQuery,
  type MarketSelectionRefs,
} from './useMarketReadQueries'

export const useMarketOrderBook = (refs: MarketSelectionRefs) => {
  const { bookState, bookQuery } = useMarketBookQuery(refs)
  const { book, initialOrdersQuery } = useMarketInitialOrders(refs, bookState)
  const version = ref(0)
  const eligible = computed(
    () => Boolean(bookState.value?.observation) && !refs.historyActive.value,
  )
  let generation = 0
  watch(
    () => [...marketSelection(refs), refs.historyActive.value],
    () => {
      generation += 1
    },
    { flush: 'sync' },
  )
  onScopeDispose(() => {
    generation += 1
  })
  const presentation = computed(() => {
    const failure =
      bookQuery.error.value ?? (eligible.value ? initialOrdersQuery.error.value : null)
    return {
      ...marketBookState(book.value, Boolean(failure)),
      loading:
        bookQuery.asyncStatus.value === 'loading' ||
        (eligible.value && initialOrdersQuery.asyncStatus.value === 'loading'),
      unavailable: Boolean(failure),
      retained: Boolean(failure && book.value && book.value.status !== 'uncollected'),
    }
  })
  const loadBook = async (restart: boolean) => {
    if (!refs.profileId.value || !refs.typeId.value || refs.historyActive.value) return
    const attempt = ++generation
    const previousObservation = bookState.value?.observation?.observationId
    await nextTick()
    if (attempt !== generation) return
    const discovered = restart ? await bookQuery.refetch() : await bookQuery.refresh()
    await nextTick()
    if (attempt !== generation || discovered.error || !discovered.data?.book.observation) return
    const sameObservation = previousObservation === discovered.data.book.observation.observationId
    const sides =
      restart && sameObservation
        ? await initialOrdersQuery.refetch()
        : await initialOrdersQuery.refresh()
    if (attempt !== generation || sides.error) return
    if (restart) version.value += 1
  }
  return {
    book,
    presentation,
    version,
    load: () => loadBook(false),
    restart: () => loadBook(true),
  }
}
