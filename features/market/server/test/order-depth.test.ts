import { describe, expect, test } from 'vitest'
import {
  quoteMarketDepth,
  type MarketObservationIdentity,
  type MarketOrderRow,
} from '../src/order-depth.js'

const observation: MarketObservationIdentity = {
  publication: 'complete',
  observationId: 'observation-1',
  marketId: 'region-10000002',
  observedAt: '2026-09-28T12:00:00Z',
  validatedAt: '2026-09-28T12:00:04Z',
  freshUntil: '2026-09-28T12:05:00Z',
}
const order = (overrides: Partial<MarketOrderRow> = {}): MarketOrderRow => ({
  orderId: 1,
  typeId: 34,
  locationId: 60003760,
  solarSystemId: 30000142,
  side: 'sell',
  price: '2.10',
  volumeRemain: 10,
  issuedAt: '2026-09-27T12:00:00Z',
  durationDays: 90,
  minimumVolume: 1,
  range: 'station',
  ...overrides,
})

describe('price-time market depth', () => {
  test('consumes ascending asks and computes an exact weighted total and source identity', () => {
    expect(
      quoteMarketDepth({
        observation,
        orders: [order({ price: '3.00', orderId: 2 }), order()],
        typeId: 34,
        side: 'buy',
        quantity: 15,
        locationIds: [],
      }),
    ).toStrictEqual({
      ...observation,
      requestedQuantity: 15,
      filledQuantity: 15,
      unfilledQuantity: 0,
      totalIsk: '36.00',
      volumeWeightedPriceIsk: '2.40',
      bestPriceIsk: '2.10',
      worstConsumedPriceIsk: '3.00',
      complete: true,
    })
  })

  test('respects location filtering, bid minimums, deterministic time priority, and partial liquidity', () => {
    const quote = quoteMarketDepth({
      observation,
      orders: [
        order({ orderId: 2, side: 'buy', price: '8.00', volumeRemain: 3, minimumVolume: 4 }),
        order({ orderId: 3, side: 'buy', price: '7.00', volumeRemain: 4 }),
        order({ orderId: 4, side: 'buy', price: '7.00', volumeRemain: 2 }),
        order({ orderId: 5, side: 'buy', price: '10.00', locationId: 60000001 }),
      ],
      typeId: 34,
      side: 'sell',
      quantity: 10,
      locationIds: [60003760],
    })
    expect(quote).toMatchObject({
      filledQuantity: 6,
      unfilledQuantity: 4,
      totalIsk: '42.00',
      volumeWeightedPriceIsk: '7.00',
      bestPriceIsk: '7.00',
      worstConsumedPriceIsk: '7.00',
      complete: false,
    })
  })

  test('does not invent a price for an empty book and rejects invalid price and quantity', () => {
    const empty = quoteMarketDepth({
      observation,
      orders: [],
      typeId: 34,
      side: 'buy',
      quantity: 5,
      locationIds: [],
    })
    expect(empty).toMatchObject({
      filledQuantity: 0,
      unfilledQuantity: 5,
      totalIsk: '0.00',
      volumeWeightedPriceIsk: null,
      bestPriceIsk: null,
      worstConsumedPriceIsk: null,
      complete: false,
    })
    expect(() =>
      quoteMarketDepth({
        observation,
        orders: [order({ price: '9'.repeat(20) })],
        typeId: 34,
        side: 'buy',
        quantity: 1,
        locationIds: [],
      }),
    ).toThrow('Market price')
    expect(() =>
      quoteMarketDepth({
        observation,
        orders: [],
        typeId: 34,
        side: 'buy',
        quantity: 0,
        locationIds: [],
      }),
    ).toThrow('Quote quantity')
  })
})
