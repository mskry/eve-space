import type { CollectedMarketBook } from './collect-orders.js'
import { marketCollectionBounds } from './market-bounds.js'
import type { MarketOrderRow } from './order-depth.js'

const defaultLimits: MarketBatchLimits = {
  maximumPages: marketCollectionBounds.defaultPagesPerBatch,
  maximumOrders: marketCollectionBounds.maximumOrdersPerBatch,
  maximumBytes: marketCollectionBounds.maximumStagingInputBytes,
}

export interface MarketBatchLimits {
  readonly maximumPages: number
  readonly maximumOrders: number
  readonly maximumBytes: number
}

interface MarketStagingPage {
  readonly page: number
  readonly validatedAt: string
  readonly freshUntil: string
  readonly orders: MarketOrderRow[]
}

export interface MarketPageBatch {
  readonly observationId: string
  readonly expectedPages: number
  readonly pages: MarketStagingPage[]
}

const exceedsBatch = (limits: MarketBatchLimits, pages: number, orders: number, bytes: number) =>
  pages > limits.maximumPages || orders > limits.maximumOrders || bytes > limits.maximumBytes

export const createMarketPageBatches = function* (
  observationId: string,
  expectedPages: number,
  pageResults: CollectedMarketBook['pageResults'],
  limits: MarketBatchLimits = defaultLimits,
): Generator<MarketPageBatch> {
  const encoder = new TextEncoder()
  const envelopeBytes = encoder.encode(
    JSON.stringify({ observationId, expectedPages, pages: [] }),
  ).length
  let pages: MarketStagingPage[] = []
  let orders = 0
  let bytes = envelopeBytes
  for (const result of pageResults) {
    const page: MarketStagingPage = { ...result, orders: [...result.orders] }
    const pageBytes = encoder.encode(JSON.stringify(page)).length
    if (exceedsBatch(limits, 1, page.orders.length, envelopeBytes + pageBytes)) {
      throw new RangeError('Market page exceeds the staging batch bound')
    }
    const separator = pages.length > 0 ? 1 : 0
    if (
      exceedsBatch(
        limits,
        pages.length + 1,
        orders + page.orders.length,
        bytes + pageBytes + separator,
      )
    ) {
      yield { observationId, expectedPages, pages }
      pages = []
      orders = 0
      bytes = envelopeBytes
    }
    bytes += pageBytes + (pages.length > 0 ? 1 : 0)
    pages.push(page)
    orders += page.orders.length
  }
  if (pages.length > 0) yield { observationId, expectedPages, pages }
}
