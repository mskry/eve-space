import { expect, test } from 'vitest'
import { deriveMarketMetrics } from '../src/market-derived.js'
import type { MarketObservationIdentity, MarketOrderRow } from '../src/order-depth.js'

const observation: MarketObservationIdentity = {
  publication: 'complete',
  observationId: 'observation-1',
  marketId: 'region-10000002',
  observedAt: '2026-09-28T12:00:00Z',
  validatedAt: '2026-09-28T12:00:05Z',
  freshUntil: '2026-09-28T12:05:00Z',
}
const order = (side: 'buy' | 'sell', price: string, volumeRemain: number): MarketOrderRow => ({
  orderId: Number(price.replace('.', '')) + volumeRemain,
  typeId: 34,
  locationId: 60003760,
  solarSystemId: 30000142,
  side,
  price,
  volumeRemain,
  issuedAt: observation.observedAt,
  durationDays: 90,
  minimumVolume: 1,
  range: 'station',
})

test('derives identified best prices, spread, total volume, and bounded depth bands', () => {
  const result = deriveMarketMetrics(
    observation,
    [
      order('buy', '9.00', 10),
      order('buy', '8.50', 20),
      order('sell', '10.00', 5),
      order('sell', '10.50', 8),
    ],
    34,
  )
  expect(result).toMatchObject({
    observationId: 'observation-1',
    derivationVersion: 1,
    availableFrom: observation.observedAt,
    availableThrough: observation.observedAt,
    bestBidIsk: '9.00',
    bestAskIsk: '10.00',
    spreadIsk: '1.00',
    bidVolume: '30',
    askVolume: '13',
    depthBands: [
      { percent: 1, bidVolume: '10', askVolume: '5' },
      { percent: 5, bidVolume: '10', askVolume: '13' },
      { percent: 10, bidVolume: '30', askVolume: '13' },
    ],
  })
})

test('distinguishes absent sides from a zero observed price', () => {
  const result = deriveMarketMetrics(observation, [order('sell', '0.00', 4)], 34)
  expect(result).toMatchObject({
    bestBidIsk: null,
    bestAskIsk: '0.00',
    spreadIsk: null,
    bidVolume: '0',
    askVolume: '4',
  })
})
