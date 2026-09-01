import { describe, expect, it } from 'vitest'
import { getStaleEsiResult } from '../../app/utils/esi-freshness'

describe('ESI freshness metadata', () => {
  it('reads stale metadata from the response root', () => {
    expect(
      getStaleEsiResult({
        stale: true,
        validatedAt: '2026-09-01T10:58:00.000Z',
        refreshFailureClass: 'esi-unavailable',
      }),
    ).toEqual({
      stale: true,
      validatedAt: '2026-09-01T10:58:00.000Z',
      refreshFailureClass: 'esi-unavailable',
    })
  })

  it('ignores fresh results and malformed contact timestamps', () => {
    expect(
      getStaleEsiResult({
        fresh: { stale: false, validatedAt: '2026-09-01T11:00:00.000Z' },
        malformed: { stale: true, validatedAt: 'unknown' },
      }),
    ).toBeUndefined()
  })

  it('does not traverse a fresh response payload', () => {
    expect(
      getStaleEsiResult({
        stale: false,
        validatedAt: '2026-09-01T11:00:00.000Z',
        nested: { stale: true, validatedAt: '2026-09-01T10:58:00.000Z' },
      }),
    ).toBeUndefined()
  })
})
