import { expect, test } from 'vitest'
import { advancePlatformCursor } from '../src/cursor.js'
import { isPlatformEsiUnavailableItem } from '../src/errors.js'

test('retains the initial after cursor across backward pages', () => {
  const first = advancePlatformCursor({}, { before: 'older', after: 'start' }, 100)
  expect(first).toEqual({
    complete: false,
    checkpoint: { before: 'older', initialAfter: 'start' },
    replaceExisting: false,
  })
  const second = advancePlatformCursor(first.checkpoint, { before: 'oldest', after: 'ignored' }, 2)
  expect(advancePlatformCursor(second.checkpoint, {}, 0)).toEqual({
    complete: true,
    checkpoint: { after: 'start' },
    replaceExisting: false,
  })
})

test('after pages replace duplicates and retain the final incremental checkpoint', () => {
  const next = advancePlatformCursor({ after: 'start' }, { after: 'end' }, 2)
  expect(next.replaceExisting).toBe(true)
  expect(advancePlatformCursor(next.checkpoint, undefined, 0)).toEqual({
    complete: true,
    checkpoint: { after: 'end' },
    replaceExisting: true,
  })
  expect(() => advancePlatformCursor({ after: 'same' }, { after: 'same' }, 1)).toThrow(
    'did not advance',
  )
  expect(() => advancePlatformCursor({ before: 'same' }, { before: 'same' }, 1)).toThrow(
    'did not advance',
  )
})

test('only explicit SDK forbidden/missing item errors allow safe detail fallback', () => {
  for (const status of [403, 404])
    expect(isPlatformEsiUnavailableItem({ code: 'ESI_HTTP_ERROR', status })).toBe(true)
  for (const error of [
    null,
    undefined,
    'failure',
    {},
    { status: 403 },
    { code: 'ESI_HTTP_ERROR', status: 429 },
    { code: 'ESI_RESPONSE_VALIDATION_ERROR', status: 403 },
  ])
    expect(isPlatformEsiUnavailableItem(error)).toBe(false)
})
