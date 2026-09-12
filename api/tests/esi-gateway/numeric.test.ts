import { describe, expect, test } from 'vitest'
import {
  parseCount,
  parseFiniteNumber,
  parseNonnegativeFiniteNumber,
} from '../../src/esi-gateway/internal/numeric.js'

describe('ESI numeric parsing', () => {
  test('parses only finite numeric strings', () => {
    expect(parseFiniteNumber('12.5')).toBe(12.5)
    expect(parseFiniteNumber('-1')).toBe(-1)
    expect(parseFiniteNumber('Infinity')).toBeUndefined()
    expect(parseFiniteNumber('not-a-number')).toBeUndefined()
    expect(parseFiniteNumber(null)).toBeUndefined()
    expect(parseFiniteNumber(undefined)).toBeUndefined()
  })

  test('rejects negative finite values for cooldown controls', () => {
    expect(parseNonnegativeFiniteNumber('0')).toBe(0)
    expect(parseNonnegativeFiniteNumber('12.5')).toBe(12.5)
    expect(parseNonnegativeFiniteNumber('-1')).toBeUndefined()
    expect(parseNonnegativeFiniteNumber('not-a-number')).toBeUndefined()
  })

  test('reads absent or unusable counter fields as zero', () => {
    expect(parseCount('7')).toBe(7)
    expect(parseCount(undefined)).toBe(0)
    expect(parseCount(null)).toBe(0)
    expect(parseCount('not-a-number')).toBe(0)
    expect(parseCount('-1')).toBe(0)
    expect(parseCount('1.5')).toBe(0)
  })
})
