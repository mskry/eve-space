import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { collectRegionalOrderBook, type MarketOrderPage } from '../src/collect-orders.js'
import type { PublicMarketWireOrder } from '../src/market-representation.js'

const wireOrder = (orderId: number): PublicMarketWireOrder => ({
  order_id: orderId,
  type_id: 34,
  location_id: 60003760,
  system_id: 30000142,
  is_buy_order: false,
  price: 6.42,
  volume_remain: 100,
  issued: '2026-09-27T12:00:00Z',
  duration: 90,
  min_volume: 1,
  range: 'station',
})
const page = (number: number, count = 3): MarketOrderPage => ({
  data: [wireOrder(number)],
  pages: count,
  validatedAt: `2026-09-28T12:00:0${number}Z`,
  freshUntil: '2026-09-28T12:05:00Z',
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-28T12:00:20Z'))
})
afterEach(() => vi.useRealTimers())

test('collects every page under one identity and publishes only a complete coherent book', async () => {
  const loadPage = vi.fn(async ({ page: number }: { page: number }) => page(number))
  const result = await collectRegionalOrderBook({
    regionId: 10000002,
    typeId: 34,
    stationIds: [60003760],
    loadPage,
  })
  expect(loadPage.mock.calls.map(([request]) => request.page)).toStrictEqual([1, 2, 3])
  expect(result).toMatchObject({
    pages: 3,
    orders: [{ orderId: 1 }, { orderId: 2 }, { orderId: 3 }],
    pageResults: [{ page: 1 }, { page: 2 }, { page: 3 }],
    observedAt: '2026-09-28T12:00:01.000Z',
    validatedAt: '2026-09-28T12:00:03.000Z',
    freshUntil: '2026-09-28T12:05:00.000Z',
  })
})

test('rejects missing pages, duplicate order identities and incompatible pagination', async () => {
  await expect(
    collectRegionalOrderBook({
      regionId: 10000002,
      stationIds: [],
      loadPage: async ({ page: pageNumber }) => {
        if (pageNumber === 2) throw new Error('page unavailable')
        return pageResult(pageNumber, 2)
      },
    }),
  ).rejects.toThrow('page unavailable')
  await expect(
    collectRegionalOrderBook({
      regionId: 10000002,
      stationIds: [],
      loadPage: async ({ page: pageNumber }) => ({
        ...pageResult(pageNumber, 2),
        data: [wireOrder(1)],
      }),
    }),
  ).rejects.toThrow('repeats across pages')
  await expect(
    collectRegionalOrderBook({
      regionId: 10000002,
      stationIds: [],
      loadPage: async ({ page: pageNumber }) => pageResult(pageNumber, pageNumber === 1 ? 2 : 3),
    }),
  ).rejects.toThrow('changed pagination')
})

test('refuses oversized observations', async () => {
  await expect(
    collectRegionalOrderBook({
      regionId: 10000002,
      stationIds: [],
      loadPage: async () => pageResult(1, 513),
    }),
  ).rejects.toThrow('page bound')
})

test('retains a complete regional book and its source expiry when collection outlasts freshness', async () => {
  const book = await collectRegionalOrderBook({
    regionId: 10000002,
    stationIds: [],
    loadPage: async ({ page: number }) => {
      if (number === 3) vi.setSystemTime(new Date('2026-09-28T12:06:00Z'))
      return page(number)
    },
  })
  expect(book).toMatchObject({
    pages: 3,
    orders: [{ orderId: 1 }, { orderId: 2 }, { orderId: 3 }],
    freshUntil: '2026-09-28T12:05:00.000Z',
    validatedAt: '2026-09-28T12:00:03.000Z',
  })
})

const pageResult = page
