import { describe, expect, it } from 'vitest'
import { parseRouteId } from '../../app/utils/route-id'

describe('parseRouteId', () => {
  it.each([
    ['1', 1],
    ['42', 42],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
  ])('parses canonical positive decimal ID %s', (value, expected) => {
    expect(parseRouteId(value)).toBe(expected)
  })

  it.each([
    undefined,
    null,
    '',
    ['42'],
    '0',
    '-1',
    '+1',
    '1e3',
    '1.5',
    ' 42',
    '42 ',
    '01',
    String(Number.MAX_SAFE_INTEGER + 1),
  ])('rejects non-canonical route ID %j', (value) => {
    expect(parseRouteId(value)).toBeUndefined()
  })
})
