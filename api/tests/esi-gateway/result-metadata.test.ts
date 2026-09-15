import { describe, expect, test } from 'vitest'
import {
  combineEsiResultMetadata,
  toEsiReadResultMetadata,
} from '../../src/esi-gateway/feature-execution.js'

describe('ESI result metadata', () => {
  test('projects only explicitly public freshness fields', () => {
    const metadata = toEsiReadResultMetadata({
      data: { name: 'Bandera' },
      cachedUntil: '2026-09-01T11:01:00.000Z',
      validatedAt: '2026-09-01T11:00:00.000Z',
      source: 'cache',
      stale: true,
      retryAt: '2026-09-01T11:02:00.000Z',
      refreshFailureClass: 'esi-unavailable',
      quota: { remaining: 12, errorRemaining: 34 },
    })

    expect(metadata).toEqual({
      cachedUntil: '2026-09-01T11:01:00.000Z',
      validatedAt: '2026-09-01T11:00:00.000Z',
      stale: true,
      refreshFailureClass: 'esi-unavailable',
      retryAt: '2026-09-01T11:02:00.000Z',
    })
  })

  test('uses the earliest expiry, oldest validation, oldest stale failure, and latest retry', () => {
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
          retryAt: '2026-09-01T11:04:00.000Z',
          refreshFailureClass: 'response-invalid',
        },
        {
          cachedUntil: '2026-09-01T11:04:00.000Z',
          validatedAt: '2026-09-01T10:59:00.000Z',
          stale: true,
          retryAt: '2026-09-01T11:05:00.000Z',
          refreshFailureClass: 'esi-cooldown',
        },
        {
          cachedUntil: '2026-09-01T11:05:00.000Z',
          validatedAt: '2026-09-01T11:01:00.000Z',
          stale: false,
          retryAt: '2026-09-01T11:06:00.000Z',
        },
      ]),
    ).toEqual({
      cachedUntil: '2026-09-01T11:02:00.000Z',
      validatedAt: '2026-09-01T10:58:00.000Z',
      stale: true,
      retryAt: '2026-09-01T11:05:00.000Z',
      refreshFailureClass: 'response-invalid',
    })
  })

  test('ignores malformed retry boundaries', () => {
    expect(
      combineEsiResultMetadata([
        {
          cachedUntil: '2026-09-01T11:02:00.000Z',
          validatedAt: '2026-09-01T10:58:00.000Z',
          stale: true,
          retryAt: 'later',
        },
      ]),
    ).toEqual({
      cachedUntil: '2026-09-01T11:02:00.000Z',
      validatedAt: '2026-09-01T10:58:00.000Z',
      stale: true,
    })
  })
})
