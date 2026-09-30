import { marketCollectionBounds } from './market-bounds.js'
import {
  mapPublicMarketOrder,
  regionOrderRequest,
  type PublicMarketWireOrder,
} from './market-representation.js'
import type { MarketOrderRow } from './order-depth.js'
import { collectMarketPages, type MarketSourcePage } from './market-page-collection.js'

export type MarketOrderPage = MarketSourcePage<PublicMarketWireOrder>

export interface CollectedMarketBook {
  readonly regionId: number
  readonly typeId: number | null
  readonly pages: number
  readonly orders: readonly MarketOrderRow[]
  readonly pageResults: readonly {
    readonly page: number
    readonly orders: readonly MarketOrderRow[]
    readonly validatedAt: string
    readonly freshUntil: string
  }[]
  readonly observedAt: string
  readonly validatedAt: string
  readonly freshUntil: string
}

type Request = ReturnType<typeof regionOrderRequest>
type LoadPage = (request: Request, signal?: AbortSignal) => Promise<MarketOrderPage>

const appendPublicOrders = (
  page: MarketOrderPage,
  watchedTypeId: number | undefined,
  stations: ReadonlySet<number>,
  seen: Set<number>,
  orders: MarketOrderRow[],
) => {
  const pageOrders: MarketOrderRow[] = []
  for (const wire of page.data) {
    if (watchedTypeId !== undefined && wire.type_id !== watchedTypeId) {
      throw new Error('Market order type does not match the watched type')
    }
    if (seen.has(wire.order_id)) throw new Error('Market order identity repeats across pages')
    seen.add(wire.order_id)
    if (stations.size === 0 || stations.has(wire.location_id)) {
      const mapped = mapPublicMarketOrder(wire)
      pageOrders.push(mapped)
      orders.push(mapped)
    }
  }
  return pageOrders
}

export const collectRegionalOrderBook = async (input: {
  readonly regionId: number
  readonly typeId?: number
  readonly stationIds: readonly number[]
  readonly loadPage: LoadPage
  readonly signal?: AbortSignal
}): Promise<CollectedMarketBook> => {
  const collection = await collectMarketPages({
    loadPage: (page, signal) =>
      input.loadPage(regionOrderRequest(input.regionId, page, input.typeId), signal),
    maximumPages: marketCollectionBounds.maximumPagesPerObservation,
    maximumConcurrentPages: marketCollectionBounds.maximumConcurrentPages,
    signal: input.signal,
  })

  const stations = new Set(input.stationIds)
  const seen = new Set<number>()
  const orders: MarketOrderRow[] = []
  const pageResults: CollectedMarketBook['pageResults'][number][] = []
  for (const [index, page] of collection.pages.entries()) {
    const pageOrders = appendPublicOrders(page, input.typeId, stations, seen, orders)
    if (seen.size > marketCollectionBounds.maximumOrdersPerObservation) {
      throw new RangeError('Market order book exceeds the order bound')
    }
    pageResults.push({
      page: index + 1,
      orders: pageOrders,
      validatedAt: page.validatedAt,
      freshUntil: page.freshUntil,
    })
  }
  return {
    regionId: input.regionId,
    typeId: input.typeId ?? null,
    pages: collection.expectedPages,
    orders,
    pageResults,
    observedAt: collection.observedAt,
    validatedAt: collection.validatedAt,
    freshUntil: collection.freshUntil,
  }
}
