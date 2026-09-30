import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { collectStructureOrderBook } from '../src/collect-structure-orders.js'

const structureId = 1020000000000
const row = (orderId: number, locationId = structureId) => ({
  order_id: orderId,
  type_id: 34,
  location_id: locationId,
  is_buy_order: false,
  price: 6.42,
  volume_remain: 10,
  issued: '2026-09-27T12:00:00Z',
  duration: 90,
  min_volume: 1,
  range: 'station',
})
const page = (number: number, total = 2) => ({
  data: [row(number)],
  pages: total,
  validatedAt: `2026-09-28T12:00:0${number}Z`,
  freshUntil: '2026-09-28T12:05:00Z',
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-28T12:00:20Z'))
})
afterEach(() => vi.useRealTimers())

test('collects a bounded complete private book with exact structure identity', async () => {
  const loadPage = vi.fn(async ({ page: number }: { page: number }) => page(number))
  const book = await collectStructureOrderBook({ structureId, loadPage })
  expect(loadPage).toHaveBeenCalledWith({ structureId, page: 1 }, undefined)
  expect(book).toMatchObject({
    structureId,
    pages: 2,
    orders: [
      { orderId: 1, solarSystemId: null },
      { orderId: 2, solarSystemId: null },
    ],
    pageResults: [{ page: 1 }, { page: 2 }],
    observedAt: '2026-09-28T12:00:01.000Z',
  })
})

test('rejects a mixed location, duplicate order, and oversized structure book', async () => {
  await expect(
    collectStructureOrderBook({
      structureId,
      loadPage: async () => ({ ...page(1, 1), data: [row(1, structureId + 1)] }),
    }),
  ).rejects.toThrow('another location')
  await expect(
    collectStructureOrderBook({
      structureId,
      loadPage: async ({ page: number }) => ({ ...page(number), data: [row(1)] }),
    }),
  ).rejects.toThrow('repeats across pages')
  await expect(
    collectStructureOrderBook({
      structureId,
      loadPage: async () => ({ ...page(1), pages: 33 }),
    }),
  ).rejects.toThrow('page bound')
})
