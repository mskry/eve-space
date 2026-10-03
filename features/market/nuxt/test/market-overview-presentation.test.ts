import { describe, expect, test } from 'vitest'
import { formatMarketIsk, formatMarketIskCompact } from '../src/runtime/app/market-isk'
import { marketBookState } from '../src/runtime/app/market-book-state'
import { marketBookSummary } from '../src/runtime/app/market-book-summary'
import type { MarketBook } from '../src/runtime/app/market-models'
import { marketHistorySeries, type MarketDay } from '../src/runtime/app/market-history-presentation'
import {
  sortMarketOrders,
  formatMarketOrderRange,
  formatMarketPriceDelta,
  isMarketLowballBuy,
  marketBuyOrderTags,
  type MarketOrderPresentation,
} from '../src/runtime/app/market-order-presentation'
import {
  formatMarketRemaining,
  formatMarketRemainingCompact,
  formatMarketTimeUtc,
} from '../src/runtime/app/market-time'

test('keeps uncollected, observed-empty, stale, failed replacement, and unavailable distinct', () => {
  const observed = {
    status: 'current',
    collectionStatus: 'ready',
    replacement: null,
    observation: {
      observationId: '00000000-0000-4000-8000-000000000001',
      profileId: '00000000-0000-4000-8000-000000000002',
      regionId: 10000002,
      typeId: 34,
      observedAt: '2026-09-01T00:00:00.000Z',
      validatedAt: '2026-09-01T00:00:00.000Z',
      freshUntil: '2026-10-01T00:00:00.000Z',
      expectedPages: 1,
      totalBookOrders: 0,
    },
    sellers: { rows: [], hasMore: false },
    buyers: { rows: [], hasMore: false },
  } satisfies MarketBook
  expect(marketBookState(null, false).coverage).toBe('loading')
  expect(marketBookState(null, true).coverage).toBe('unavailable')
  expect(
    marketBookState({ status: 'uncollected', collectionStatus: 'ready', replacement: null }, false)
      .coverage,
  ).toBe('uncollected')
  expect(marketBookState(observed, false)).toMatchObject({
    coverage: 'observed-empty',
    freshness: 'current',
    profileFailed: false,
  })
  expect(marketBookState({ ...observed, status: 'stale' }, false)).toMatchObject({
    coverage: 'observed-empty',
    freshness: 'stale',
    profileFailed: false,
  })
  expect(
    marketBookState({ ...observed, status: 'stale', collectionStatus: 'profile-failed' }, false),
  ).toMatchObject({ freshness: 'stale', profileFailed: true })
  expect(
    marketBookState(
      {
        ...observed,
        status: 'stale',
        replacement: { status: 'incomplete', attemptedAt: '2026-09-29T00:00:00.000Z' },
      },
      false,
    ),
  ).toMatchObject({ freshness: 'stale', replacementIncomplete: true })
  expect(
    marketBookState(
      {
        status: 'uncollected',
        collectionStatus: 'ready',
        replacement: { status: 'incomplete', attemptedAt: '2026-09-29T00:00:00.000Z' },
      },
      false,
    ),
  ).toMatchObject({ coverage: 'uncollected', replacementIncomplete: true })
})

const order = (orderId: number, side: 'buy' | 'sell', price: string): MarketOrderPresentation => ({
  orderId,
  side,
  price,
  volumeRemain: 5,
  locationId: 60003760,
  locationName: null,
  issuedAt: '2026-09-01T00:00:00.000Z',
  expiryAt: '2026-12-01T00:00:00.000Z',
  range: 'station',
  minimumVolume: 1,
})

describe('public book presentation', () => {
  test('labels station, region and jump ranges without changing the source constraint', () => {
    expect(formatMarketOrderRange('station')).toBe('Station')
    expect(formatMarketOrderRange('region')).toBe('Region')
    expect(formatMarketOrderRange('1')).toBe('1 jumps')
  })
  test('shows bounded relative expiry after hydration with an exact UTC alternative', () => {
    const expiryAt = '2027-09-28T12:00:00.000Z'
    expect(formatMarketTimeUtc(expiryAt)).toBe('2027-09-28 12:00 UTC')
    expect(formatMarketRemaining(expiryAt, Date.parse('2026-09-28T11:00:00Z'))).toBe('365d 1h 0m')
    expect(formatMarketRemaining(expiryAt, Date.parse(expiryAt))).toBe('Expired')
  })
  test('orders sellers and buyers by exact cents with stable issued/order ties', () => {
    const sellers = [order(9, 'sell', '2.00'), order(3, 'sell', '1.05'), order(1, 'sell', '1.05')]
    expect(sortMarketOrders(sellers, 'sell').map(({ orderId }) => orderId)).toEqual([1, 3, 9])
    expect(
      sortMarketOrders(
        sellers.map((entry) => ({ ...entry, side: 'buy' as const })),
        'buy',
      ).map(({ orderId }) => orderId),
    ).toEqual([9, 1, 3])
    expect(formatMarketIsk('999999999999999.99')).toBe('999,999,999,999,999.99 ISK')
    expect(
      sortMarketOrders(
        [
          { ...sellers[0]!, locationName: null },
          { ...sellers[1]!, locationName: 'Jita IV' },
        ],
        'sell',
        'location',
        'asc',
      ).map(({ orderId }) => orderId),
    ).toEqual([9, 3])
  })
})

const day = (date: string, price: string): MarketDay => ({
  date,
  averageIsk: price,
  highIsk: price,
  lowIsk: price,
  volume: 10,
  orderCount: 2,
})

describe('daily history presentation', () => {
  test('creates averages and Donchian range only for contiguous valid windows', () => {
    const records = Array.from({ length: 20 }, (_, index) =>
      day(new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10), `${index + 1}.00`),
    )
    const series = marketHistorySeries(records)
    expect(series[3]?.movingAverage5).toBeNull()
    expect(series[4]?.movingAverage5).toBe('3.00')
    expect(series[18]?.movingAverage20).toBeNull()
    expect(series[19]).toMatchObject({
      movingAverage20: '10.50',
      donchianLow20: '1.00',
      donchianHigh20: '20.00',
    })
    expect(marketHistorySeries([...records.slice(0, 10), ...records.slice(11)])[18]).toMatchObject({
      movingAverage20: null,
      donchianLow20: null,
    })
  })

  test('rejects invalid prices and dates instead of plotting invented zeroes', () => {
    expect(
      marketHistorySeries([
        day('2026-02-30', '1.00'),
        day('2026-03-01', '999999999999999.99'),
        { ...day('2026-03-02', '1.00'), highIsk: '0.00' },
        day('2026-03-03', '0.00'),
      ]).map(({ date }) => date),
    ).toEqual(['2026-03-01', '2026-03-03'])
    expect(marketHistorySeries([])).toEqual([])
  })
})

test('formats order-book deltas, buy tags and compact expiry', () => {
  expect(formatMarketPriceDelta('4938000.00', '4934000.00')).toBe('+0.08%')
  expect(formatMarketPriceDelta('4652000.00', '4659000.00')).toBe('−0.15%')
  expect(formatMarketPriceDelta('10.00', '10.00')).toBe('±0.00%')
  expect(formatMarketPriceDelta('10.00', '0.00')).toBe('')
  expect(marketBuyOrderTags({ range: 'region', minimumVolume: 1 })).toEqual([])
  expect(marketBuyOrderTags({ range: 'station', minimumVolume: 10 })).toEqual(['Station', 'Min 10'])
  const now = Date.parse('2026-09-01T00:00:00.000Z')
  expect(formatMarketRemainingCompact('2026-09-03T05:30:00.000Z', now)).toBe('2d 5h')
  expect(formatMarketRemainingCompact('2026-09-01T23:18:00.000Z', now)).toBe('23h 18m')
  expect(formatMarketRemainingCompact('2026-08-31T00:00:00.000Z', now)).toBe('Expired')
  expect(formatMarketRemainingCompact('invalid', now)).toBe('—')
})

const summaryOrder = (price: string, volumeRemain: number) => ({
  orderId: volumeRemain,
  side: 'sell' as const,
  price,
  volumeRemain,
  locationId: 1,
  locationName: null,
  issuedAt: '2026-09-01T00:00:00.000Z',
  expiryAt: '2026-10-01T00:00:00.000Z',
  range: 'region',
  minimumVolume: 1,
})

test('summarises best prices, spread and listed units from the first book page', () => {
  expect(
    marketBookSummary(
      { rows: [summaryOrder('4938000.00', 50), summaryOrder('4934000.00', 1000)], hasMore: true },
      { rows: [summaryOrder('4659000.00', 989), summaryOrder('4655000.50', 5000)], hasMore: false },
    ),
  ).toEqual({
    bestSell: '4,934,000.00',
    bestBuy: '4,659,000.00',
    spread: '275,000.00',
    spreadShare: '5.57% of sell',
    sellUnits: '1,050+',
    buyUnits: '5,989',
  })
  const crossed = marketBookSummary(
    { rows: [summaryOrder('10.00', 1)], hasMore: false },
    { rows: [summaryOrder('10.50', 1)], hasMore: false },
  )
  expect(crossed.spread).toBe('−0.50')
  expect(crossed.spreadShare).toBe('−5.00% of sell')
  expect(marketBookSummary({ rows: [], hasMore: false }, { rows: [], hasMore: false })).toEqual({
    bestSell: null,
    bestBuy: null,
    spread: null,
    spreadShare: null,
    sellUnits: '0',
    buyUnits: '0',
  })
})

test('shortens displayed ISK amounts without losing exact source prices', () => {
  expect(formatMarketIskCompact('999.99')).toBe('999.99')
  expect(formatMarketIskCompact('1,000.00')).toBe('1.00K')
  expect(formatMarketIskCompact('728,100.00')).toBe('728.10K')
  expect(formatMarketIskCompact('999,999.99')).toBe('1.00M')
  expect(formatMarketIskCompact('999,999,999.99')).toBe('1.00B')
  expect(formatMarketIskCompact('1,000,000.00')).toBe('1.00M')
  expect(formatMarketIskCompact('4,934,000.00')).toBe('4.93M')
  expect(formatMarketIskCompact('1,887,000,000.00')).toBe('1.89B')
  expect(formatMarketIskCompact('1,200,000,000,000.00')).toBe('1.20T')
  expect(formatMarketIskCompact('−12,500,000.00')).toBe('−12.50M')
})

test('treats buys at or below half the best buy as lowball', () => {
  expect(isMarketLowballBuy('0.01', '4667000.00')).toBe(true)
  expect(isMarketLowballBuy('2333500.00', '4667000.00')).toBe(true)
  expect(isMarketLowballBuy('2333500.01', '4667000.00')).toBe(false)
  expect(isMarketLowballBuy('4667000.00', '4667000.00')).toBe(false)
})
