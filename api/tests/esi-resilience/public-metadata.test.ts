import { describe, expect, test } from 'vitest'
import {
  combineEsiResultMetadata,
  toEsiResultMetadata,
} from '../../src/esi-resilience/public-metadata.js'

describe('public ESI freshness metadata', () => {
  test('projects only explicitly public freshness fields', () => {
    const metadata = toEsiResultMetadata({
      data: { name: 'Bandera' },
      cachedUntil: '2026-09-01T11:01:00.000Z',
      validatedAt: '2026-09-01T11:00:00.000Z',
      source: 'cache',
      stale: true,
      refreshFailureClass: 'esi-unavailable',
      retryAt: '2026-09-01T11:02:00.000Z',
      quota: { remaining: 12, errorRemaining: 34 },
    })

    expect(metadata).toEqual({
      cachedUntil: '2026-09-01T11:01:00.000Z',
      validatedAt: '2026-09-01T11:00:00.000Z',
      stale: true,
      refreshFailureClass: 'esi-unavailable',
    })
  })

  test('uses the earliest expiry, oldest validation, and oldest stale failure', () => {
    expect(
      combineEsiResultMetadata([
        {
          cachedUntil: '2026-09-01T11:03:00.000Z',
          validatedAt: '2026-09-01T11:00:00.000Z',
          stale: false,
        },
        {
          cachedUntil: '2026-09-01T11:02:00.000Z',
          validatedAt: '2026-09-01T10:58:00.000Z',
          stale: true,
          refreshFailureClass: 'response-invalid',
        },
      ]),
    ).toEqual({
      cachedUntil: '2026-09-01T11:02:00.000Z',
      validatedAt: '2026-09-01T10:58:00.000Z',
      stale: true,
      refreshFailureClass: 'response-invalid',
    })
  })
})
