import { expect, test } from 'vitest'
import {
  closestMarketDay,
  fitMarketPrice,
  initialHistoryRange,
  moveHistoryRange,
  resizeHistoryRange,
  zoomMarketPrice,
} from '../src/runtime/app/market-history-viewport'
import type { MarketPlottedDay } from '../src/runtime/app/market-history-presentation'

const days: MarketPlottedDay[] = Array.from({ length: 60 }, (_, index) => ({
  date: new Date(Date.UTC(2026, 6, index + 1)).toISOString().slice(0, 10),
  averageIsk: `${100 + index}.00`,
  highIsk: `${110 + index}.00`,
  lowIsk: `${90 + index}.00`,
  volume: 100 + index,
  orderCount: 10,
  movingAverage5: null,
  movingAverage20: null,
  donchianHigh20: null,
  donchianLow20: null,
}))

test('overview handles extend and slide the visible window without exceeding the data', () => {
  const initial = initialHistoryRange(days.length, 300)
  expect(initial).toEqual({ start: 29, end: 59 })
  const expanded = resizeHistoryRange(initial, 'start', 4, days.length)
  expect(expanded).toEqual({ start: 4, end: 59 })
  const shifted = moveHistoryRange(expanded, -100, days.length)
  expect(shifted).toEqual({ start: 0, end: 55 })
  expect(resizeHistoryRange(shifted, 'end', 2, days.length)).toEqual({ start: 0, end: 23 })
})

test('price fit uses visible highs and lows instead of a zero baseline and zoom keeps its anchor', () => {
  const bounds = fitMarketPrice(days, { start: 40, end: 59 })
  expect(bounds.min).toBeGreaterThan(0)
  expect(bounds.min).toBeLessThan(130)
  expect(bounds.max).toBeGreaterThan(169)
  const zoomed = zoomMarketPrice(bounds, 0.5, 0.5)
  expect(zoomed.max - zoomed.min).toBeCloseTo((bounds.max - bounds.min) / 2)
  expect((zoomed.min + zoomed.max) / 2).toBeCloseTo((bounds.min + bounds.max) / 2)
})

test('date hit testing resolves to the nearest recorded day across a missing source day', () => {
  const sparse = [days[0]!, days[2]!, days[3]!]
  expect(closestMarketDay(sparse, Date.parse('2026-07-02T00:00:00Z'))).toBe(0)
  expect(closestMarketDay(sparse, Date.parse('2026-07-03T00:00:00Z'))).toBe(1)
})
