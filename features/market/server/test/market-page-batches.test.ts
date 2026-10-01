import { expect, test } from 'vitest'
import { createMarketPageBatches } from '../src/market-page-batches.js'
import type { MarketOrderRow } from '../src/order-depth.js'
import { stageMarketPagesOperation } from '../src/persistence.js'

const observationId = 'b088776b-a19e-47c9-8b86-6b6a33cc62f3'
const validatedAt = '2026-09-28T12:00:00Z'
const freshUntil = '2026-09-28T12:05:00Z'
const order = (orderId: number): MarketOrderRow => ({
  orderId,
  typeId: 34,
  locationId: 60003760,
  solarSystemId: 30000142,
  side: 'sell',
  price: '6.42',
  volumeRemain: 100,
  issuedAt: validatedAt,
  durationDays: 90,
  minimumVolume: 1,
  range: 'station',
})
const page = (number: number, orders = [order(number)]) => ({
  page: number,
  validatedAt,
  freshUntil,
  orders,
})
const input = { observationId, expectedPages: 41, pages: [page(1)] }

test.each([
  { pages: [] },
  { pages: [page(1), page(1)] },
  { pages: [page(42)] },
  { pages: [page(0)] },
  { pages: Array.from({ length: 21 }, (_, index) => page(index + 1)) },
  {
    pages: [
      page(
        1,
        Array.from({ length: 1_001 }, (_, index) => order(index + 1)),
      ),
    ],
  },
  { pages: [{ ...page(1), freshUntil: validatedAt }] },
  { pages: [{ ...page(1), validatedAt: 'not-a-date' }] },
  { pages: [page(1, [{ ...order(1), price: '-1.00' }])] },
])('rejects invalid batch input %j', (invalid) => {
  expect(stageMarketPagesOperation.inputSchema.safeParse({ ...input, ...invalid }).success).toBe(
    false,
  )
})

test('accepts valid pages whose original expiry has already passed', () => {
  expect(stageMarketPagesOperation.inputSchema.parse(input)).toEqual(input)
})

test('bounds pages without losing order references or empty-page source metadata', () => {
  const pages = Array.from({ length: 41 }, (_, index) => page(index + 1))
  pages[20] = page(21, [])
  const batches = [...createMarketPageBatches(observationId, 41, pages)]
  expect(batches.map((batch) => batch.pages.length)).toEqual([10, 10, 10, 10, 1])
  expect(batches.flatMap((batch) => batch.pages)).toEqual(pages)
  expect(batches[0]!.pages[0]!.orders[0]).toBe(pages[0]!.orders[0])
  expect(batches[2]!.pages[0]).toEqual({ page: 21, validatedAt, freshUntil, orders: [] })
})

test('splits independently on the total order limit', () => {
  const pages = [page(1, [order(1), order(2)]), page(2, [order(3), order(4)]), page(3)]
  const batches = [
    ...createMarketPageBatches(observationId, 3, pages, {
      maximumPages: 20,
      maximumOrders: 3,
      maximumBytes: 16 * 1024 * 1024,
    }),
  ]
  expect(batches.map((batch) => batch.pages.map((item) => item.page))).toEqual([[1], [2, 3]])
})

test('uses the complete JSON UTF-8 size including escaped and Unicode order fields', () => {
  const pages = [1, 2, 3].map((number) => page(number, [{ ...order(number), range: 'é🚀"\\\n' }]))
  const maximumBytes = Buffer.byteLength(
    JSON.stringify({ observationId, expectedPages: 3, pages: pages.slice(0, 2) }),
    'utf8',
  )
  const batches = [
    ...createMarketPageBatches(observationId, 3, pages, {
      maximumPages: 20,
      maximumOrders: 20_000,
      maximumBytes,
    }),
  ]
  expect(batches.map((batch) => batch.pages.map((item) => item.page))).toEqual([[1, 2], [3]])
  expect(Buffer.byteLength(JSON.stringify(batches[0]), 'utf8')).toBe(maximumBytes)
  for (const batch of batches) {
    expect(Buffer.byteLength(JSON.stringify(batch), 'utf8')).toBeLessThanOrEqual(maximumBytes)
  }
})

test.each([
  { maximumPages: 20, maximumOrders: 1, maximumBytes: 16 * 1024 * 1024 },
  { maximumPages: 20, maximumOrders: 20_000, maximumBytes: 100 },
])('fails rather than splitting a page that cannot fit %j', (limits) => {
  expect(() => [
    ...createMarketPageBatches(observationId, 1, [page(1, [order(1), order(2)])], limits),
  ]).toThrow('staging batch bound')
})
