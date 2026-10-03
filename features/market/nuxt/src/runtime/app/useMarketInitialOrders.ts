import { useQuery, useQueryCache } from '@pinia/colada'
import {
  ApiQueryError,
  type ApplicationGraphQLResult,
} from '@eve-space/platform-module-nuxt/runtime'
import { computed, onScopeDispose, watch, type Ref } from 'vue'
import { MarketInitialOrdersDocument, type MarketInitialOrdersQuery } from './market-graphql'
import { adaptMarketOrders, marketField, unavailableMarketSide } from './market-graphql-adapters'
import { marketSafeInteger } from './market-graphql-values'
import {
  marketGraphQLKey,
  marketQueryOptions,
  marketRelease,
  marketSourceStaleTime,
} from './market-query-options'
import { marketSelection, type MarketSelectionRefs } from './useMarketReadQueries'
import type { MarketBook, MarketBookDiscovery, MarketSide } from './market-models'

type InitialResult = {
  selected: readonly (string | number | null)[]
  sellers: MarketSide
  buyers: MarketSide
}
type SideAlias = 'sellers' | 'buyers'

const readInitialSide = (
  envelope: ApplicationGraphQLResult<MarketInitialOrdersQuery>,
  alias: SideAlias,
  selected: readonly (string | number | null)[],
  signal: AbortSignal,
  previous?: MarketSide,
): MarketSide => {
  try {
    const wire = marketField(envelope, ['market', alias], envelope.data?.market?.[alias])
    marketRelease(signal, selected.slice(0, 4), [
      wire.observation.profileId,
      marketSafeInteger(wire.profileRevision),
      marketSafeInteger(wire.observation.typeId),
      wire.observationId,
    ])
    marketRelease(signal, [wire.observationId], [wire.observation.observationId])
    const side = alias === 'sellers' ? 'sell' : 'buy'
    if (wire.rows.some((row) => row.side !== side)) throw new Error('Market order side changed.')
    return adaptMarketOrders(wire)
  } catch (error) {
    signal.throwIfAborted()
    const failed = unavailableMarketSide(
      error instanceof ApiQueryError
        ? (error.code ?? 'MARKET_FIELD_UNAVAILABLE')
        : 'MARKET_FIELD_UNAVAILABLE',
    )
    return previous?.kind === 'ready' && failed.error !== 'MARKET_OBSERVATION_UNAVAILABLE'
      ? { ...previous, error: failed.error }
      : failed
  }
}

export const useMarketInitialOrders = (
  refs: MarketSelectionRefs,
  bookState: Readonly<Ref<MarketBookDiscovery | null>>,
) => {
  const execute = usePlatformGraphQL()
  const queryCache = useQueryCache()
  const selectors = () => [
    ...marketSelection(refs),
    bookState.value?.observation?.observationId ?? '',
    100,
  ]
  const active = () =>
    Boolean(
      bookState.value?.status !== 'uncollected' &&
      bookState.value?.observation &&
      !refs.historyActive.value,
    )
  watch(
    () => [selectors(), active()] as const,
    ([selected, enabled], [previous, wasEnabled]) => {
      if (enabled === wasEnabled && selected.every((value, index) => value === previous[index]))
        return
      queryCache.cancelQueries({
        key: marketGraphQLKey('MarketInitialOrders', previous),
        exact: true,
      })
    },
    { flush: 'sync' },
  )
  onScopeDispose(() =>
    queryCache.cancelQueries({
      key: marketGraphQLKey('MarketInitialOrders', selectors()),
      exact: true,
    }),
  )
  const initialOrdersQuery = useQuery(() => {
    const selected = selectors()
    const key = marketGraphQLKey('MarketInitialOrders', selected)
    const staleTime = marketSourceStaleTime(
      queryCache,
      key,
      10_000,
      bookState.value?.observation?.freshUntil,
    )
    return marketQueryOptions(
      key,
      Boolean(selected[0] && selected[2] && selected[3]) && active(),
      staleTime,
      async ({ signal }): Promise<InitialResult> => {
        if (!active()) throw new Error('Market observation is unavailable.')
        const envelope = await execute(
          MarketInitialOrdersDocument,
          {
            profileId: String(selected[0]),
            typeId: String(selected[2]),
            observationId: String(selected[3]),
          },
          signal,
        )
        marketRelease(signal, selected, selectors())
        if (!envelope.data?.market || envelope.errors?.some((error) => !error.path))
          marketField(envelope, ['market', 'sellers'], envelope.data?.market?.sellers)
        const previous = queryCache.getQueryData<InitialResult>(key)
        return {
          selected,
          sellers: readInitialSide(envelope, 'sellers', selected, signal, previous?.sellers),
          buyers: readInitialSide(envelope, 'buyers', selected, signal, previous?.buyers),
        }
      },
    )
  })
  const book = computed<MarketBook | null>(() => {
    const state = bookState.value
    if (!state) return null
    if (state.status === 'uncollected')
      return {
        status: state.status,
        collectionStatus: state.collectionStatus,
        replacement: state.replacement,
      }
    if (!state.observation) return null
    const sides = initialOrdersQuery.data.value
    if (!sides || JSON.stringify(sides.selected) !== JSON.stringify(selectors())) return null
    return {
      ...state,
      status: state.status,
      observation: state.observation,
      sellers: sides.sellers,
      buyers: sides.buyers,
    }
  })
  return { book, initialOrdersQuery }
}
