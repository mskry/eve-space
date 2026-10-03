import { useQuery, useQueryCache } from '@pinia/colada'
import type { Ref } from 'vue'
import { MarketOrderContinuationDocument } from './market-graphql'
import { adaptMarketOrders, marketField } from './market-graphql-adapters'
import { marketSafeInteger } from './market-graphql-values'
import {
  marketGraphQLKey,
  marketQueryOptions,
  marketRelease,
  marketSourceStaleTime,
} from './market-query-options'
import type { MarketReadySide } from './market-models'

export interface MarketOrderSelector {
  readonly profileId: string
  readonly profileRevision: number
  readonly typeId: number
  readonly observationId: string
  readonly side: 'buy' | 'sell'
  readonly after: string
}

type ContinuationPage = MarketReadySide & { readonly freshUntil: string }

const orderSelectors = (selector: MarketOrderSelector | null) =>
  selector
    ? [
        selector.profileId,
        selector.profileRevision,
        selector.typeId,
        selector.observationId,
        selector.side,
        100,
        selector.after,
      ]
    : []

export const useMarketOrderPage = (selector: Readonly<Ref<MarketOrderSelector | null>>) => {
  const execute = usePlatformGraphQL()
  const queryCache = useQueryCache()
  const query = useQuery(() => {
    const selected = selector.value
    const selectors = orderSelectors(selected)
    const key = marketGraphQLKey('MarketOrderContinuation', selectors)
    const previous = queryCache.getQueryData<ContinuationPage>(key)
    const staleTime = marketSourceStaleTime(queryCache, key, 10_000, previous?.freshUntil)
    return marketQueryOptions(key, false, staleTime, async ({ signal }) => {
      if (!selected) throw new Error('Market order page is unavailable.')
      const { profileRevision: _profileRevision, ...variables } = selected
      const envelope = await execute(
        MarketOrderContinuationDocument,
        { ...variables, typeId: String(selected.typeId) },
        signal,
      )
      marketRelease(signal, selectors, orderSelectors(selector.value))
      const page = marketField(envelope, ['market', 'orders'], envelope.data?.market?.orders)
      marketRelease(signal, selectors.slice(0, 4), [
        page.observation.profileId,
        marketSafeInteger(page.profileRevision),
        marketSafeInteger(page.observation.typeId),
        page.observationId,
      ])
      marketRelease(signal, [page.observationId], [page.observation.observationId])
      if (page.rows.some((row) => row.side !== selected.side))
        throw new Error('Market order side changed.')
      return { ...adaptMarketOrders(page), freshUntil: page.observation.freshUntil }
    })
  })
  const cancel = () =>
    queryCache.cancelQueries({
      key: marketGraphQLKey('MarketOrderContinuation', orderSelectors(selector.value)),
      exact: true,
    })
  return { ...query, cancel }
}
