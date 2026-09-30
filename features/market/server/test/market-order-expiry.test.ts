import { expect, test } from 'vitest'
import { marketOrderExpiryAt } from '../src/market-order-expiry.js'

test('derives stable absolute expiry from authoritative issued time and duration', () => {
  expect(marketOrderExpiryAt('2026-09-28T12:00:00Z', 1)).toBe('2026-09-29T12:00:00.000Z')
  expect(marketOrderExpiryAt('2026-03-08T09:00:00Z', 1)).toBe('2026-03-09T09:00:00.000Z')
  expect(marketOrderExpiryAt('2026-09-28T12:00:00Z', 0)).toBe('2026-09-28T12:00:00.000Z')
  expect(marketOrderExpiryAt('2026-09-28T12:00:00Z', 365)).toBe('2027-09-28T12:00:00.000Z')
  expect(() => marketOrderExpiryAt('invalid', 1)).toThrow('expiry source')
  expect(() => marketOrderExpiryAt('2026-09-28T12:00:00Z', 366)).toThrow('expiry source')
})
