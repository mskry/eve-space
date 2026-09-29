import { describe, expect, it } from 'vitest'
import { getStaleEsiMetadata, hasUnavailableOverviewSection } from '../../app/utils/esi-freshness'

describe('ESI freshness metadata', () => {
  it('reads stale metadata from the response root', () => {
    expect(
      getStaleEsiMetadata({
        refreshFailureClass: 'esi-unavailable',
        retryAt: '2026-09-01T11:01:00.000Z',
        stale: true,
        validatedAt: '2026-09-01T10:58:00.000Z',
      }),
    ).toStrictEqual({
      refreshFailureClass: 'esi-unavailable',
      retryAt: '2026-09-01T11:01:00.000Z',
      stale: true,
      validatedAt: '2026-09-01T10:58:00.000Z',
    })
  })

  it('normalizes successful stale metadata without requiring an original timestamp', () => {
    expect(
      getStaleEsiMetadata({
        refreshFailureClass: 'esi-cooldown',
        retryAt: '2026-09-01T11:01:00.000Z',
        stale: true,
      }),
    ).toStrictEqual({
      refreshFailureClass: 'esi-cooldown',
      retryAt: '2026-09-01T11:01:00.000Z',
      stale: true,
    })
    expect(
      getStaleEsiMetadata({ retryAt: 'later', stale: true, validatedAt: 'unknown' }),
    ).toStrictEqual({
      stale: true,
    })
  })

  it('ignores results without a root stale marker', () => {
    expect(
      getStaleEsiMetadata({
        fresh: { stale: false, validatedAt: '2026-09-01T11:00:00.000Z' },
        malformed: { stale: true, validatedAt: 'unknown' },
      }),
    ).toBeUndefined()
  })

  it('does not traverse a fresh response payload', () => {
    expect(
      getStaleEsiMetadata({
        nested: { stale: true, validatedAt: '2026-09-01T10:58:00.000Z' },
        stale: false,
        validatedAt: '2026-09-01T11:00:00.000Z',
      }),
    ).toBeUndefined()
  })

  it('detects unavailable overview sections without treating authorization as an outage', () => {
    expect(
      hasUnavailableOverviewSection({
        location: { data: {}, status: 'ok' },
        ship: { message: 'ESI unavailable', status: 'unavailable' },
        skills: { status: 'scope-required' },
      }),
    ).toBe(true)
    expect(
      hasUnavailableOverviewSection({
        location: { data: {}, status: 'ok' },
        ship: { status: 'scope-required' },
        skills: { data: {}, status: 'ok' },
      }),
    ).toBe(false)
  })
})
