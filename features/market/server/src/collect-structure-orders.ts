import {
  mapStructureMarketOrder,
  structureOrdersRequest,
  type StructureMarketWireOrder,
} from './market-representation.js'
import { collectMarketPages, type MarketSourcePage } from './market-page-collection.js'
import type { MarketOrderRow } from './order-depth.js'

export interface CollectedStructureBook {
  readonly structureId: number
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

const maximumStructurePages = 32
const maximumStructureOrders = 32_000

export const collectStructureOrderBook = async (input: {
  readonly structureId: number
  readonly loadPage: (
    request: ReturnType<typeof structureOrdersRequest>,
    signal?: AbortSignal,
  ) => Promise<MarketSourcePage<StructureMarketWireOrder>>
  readonly signal?: AbortSignal
}): Promise<CollectedStructureBook> => {
  const collection = await collectMarketPages({
    loadPage: (page, signal) =>
      input.loadPage(structureOrdersRequest(input.structureId, page), signal),
    maximumPages: maximumStructurePages,
    maximumConcurrentPages: 3,
    signal: input.signal,
  })
  if (Date.parse(collection.freshUntil) <= Date.now())
    throw new Error('Market pages are no longer fresh')
  const ids = new Set<number>()
  const orders: MarketOrderRow[] = []
  const pageResults: CollectedStructureBook['pageResults'][number][] = []
  for (const [index, page] of collection.pages.entries()) {
    const pageOrders: MarketOrderRow[] = []
    for (const raw of page.data) {
      if (raw.location_id !== input.structureId) {
        throw new Error('Structure order belongs to another location')
      }
      if (ids.has(raw.order_id)) throw new Error('Structure order identity repeats across pages')
      ids.add(raw.order_id)
      const mapped = mapStructureMarketOrder(raw)
      pageOrders.push(mapped)
      orders.push(mapped)
    }
    if (ids.size > maximumStructureOrders) {
      throw new RangeError('Structure order book exceeds its order bound')
    }
    pageResults.push({
      page: index + 1,
      orders: pageOrders,
      validatedAt: page.validatedAt,
      freshUntil: page.freshUntil,
    })
  }
  return {
    structureId: input.structureId,
    pages: collection.expectedPages,
    orders,
    pageResults,
    observedAt: collection.observedAt,
    validatedAt: collection.validatedAt,
    freshUntil: collection.freshUntil,
  }
}
