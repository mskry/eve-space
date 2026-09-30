import { expect, test, vi } from 'vitest'
import { quoteObservedMarketDepth } from '../src/quote-market.js'

const observation = {
  publication: 'complete' as const,
  observationId: '00000000-0000-4000-8000-000000000001',
  marketId: 'profile:34',
  observedAt: '2026-09-28T12:00:00Z',
  validatedAt: '2026-09-28T12:00:02Z',
  freshUntil: '2026-09-28T12:05:00Z',
}
const order = (id: number, price: string, volumeRemain: number, side: 'buy' | 'sell' = 'sell') => ({
  orderId: id,
  typeId: 34,
  locationId: 60003760,
  solarSystemId: 30000142,
  side,
  price,
  volumeRemain,
  issuedAt: '2026-09-27T12:00:00Z',
  durationDays: 90,
  minimumVolume: 1,
  range: 'station',
})

test('fills price-time depth across bounded keyset pages without claiming the first row as a quote', async () => {
  const readRows = vi
    .fn()
    .mockResolvedValueOnce({ rows: [order(1, '2.10', 10)], hasMore: true })
    .mockResolvedValueOnce({ rows: [order(2, '3.00', 5)], hasMore: false })
  const result = await quoteObservedMarketDepth({
    observation,
    typeId: 34,
    side: 'buy',
    quantity: 15,
    locationIds: [60003760],
    readRows,
  })
  expect(result).toMatchObject({
    filledQuantity: 15,
    unfilledQuantity: 0,
    totalIsk: '36.00',
    volumeWeightedPriceIsk: '2.40',
    bestPriceIsk: '2.10',
    worstConsumedPriceIsk: '3.00',
    complete: true,
  })
  expect(readRows).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      side: 'sell',
      cursorPrice: '2.10',
      cursorOrderId: 1,
    }),
  )
})

test('reports partial fill and zero-liquidity alternatives without inventing an executable price', async () => {
  const readRows = vi.fn().mockResolvedValue({ rows: [order(1, '7.00', 3, 'buy')], hasMore: false })
  const result = await quoteObservedMarketDepth({
    observation,
    typeId: 34,
    side: 'sell',
    quantity: 10,
    locationIds: [],
    readRows,
  })
  expect(result).toMatchObject({
    filledQuantity: 3,
    unfilledQuantity: 7,
    totalIsk: '21.00',
    complete: false,
  })
  readRows.mockResolvedValueOnce({ rows: [], hasMore: false })
  expect(
    await quoteObservedMarketDepth({
      observation,
      typeId: 34,
      side: 'buy',
      quantity: 1,
      locationIds: [],
      readRows,
    }),
  ).toMatchObject({ filledQuantity: 0, bestPriceIsk: null, complete: false })
})

test('rejects an unprogressing keyset page rather than claiming truncated depth', async () => {
  const readRows = vi.fn().mockResolvedValue({ rows: [order(1, '6.42', 0)], hasMore: true })
  await expect(
    quoteObservedMarketDepth({
      observation,
      typeId: 34,
      side: 'buy',
      quantity: 1,
      locationIds: [],
      readRows,
    }),
  ).rejects.toThrow('did not advance')
})
