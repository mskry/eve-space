import { describe, expect, test } from 'vitest'
import {
  assertFinancePositiveSafeInteger,
  resolveFinanceTotalPages,
} from '../../src/characters/finance-pagination.js'

describe('finance pagination', () => {
  test.each([1, Number.MAX_SAFE_INTEGER])('accepts positive safe integer %s', (value) => {
    expect(() => assertFinancePositiveSafeInteger(value, 'Page')).not.toThrow()
  })

  test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', undefined])(
    'rejects invalid positive safe integer %s',
    (value) => {
      expect(() => assertFinancePositiveSafeInteger(value, 'Page')).toThrow(
        'Page must be a positive safe integer',
      )
    },
  )

  test.each([undefined, 0])(
    'falls back to the requested page when the reported total is %s',
    (totalPages) => {
      expect(resolveFinanceTotalPages(totalPages, 4)).toBe(4)
    },
  )

  test('returns a valid reported page total', () => {
    expect(resolveFinanceTotalPages(7, 4)).toBe(7)
  })

  test.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid reported page total %s',
    (totalPages) => {
      expect(() => resolveFinanceTotalPages(totalPages, 4)).toThrow(
        'ESI pagination total must be a positive safe integer',
      )
    },
  )
})
