import { describe, expect, test } from 'vitest'
import {
  combineEsiResultMetadata,
  toEsiReadResultMetadata,
} from '../../src/esi-gateway/feature-execution.js'

describe('ESI result metadata', () => {
  test('projects only explicitly public freshness fields', () => {
    const metadata = toEsiReadResultMetadata({
      cachedUntil: '2026-09-01T11:01:00.000Z',
      data: { name: 'Bandera' },
      quota: { errorRemaining: 34, remaining: 12 },
      refreshFailureClass: 'esi-unavailable',
      retryAt: '2026-09-01T11:02:00.000Z',
      source: 'cache',
      stale: true,
      validatedAt: '2026-09-01T11:00:00.000Z',
    })

    expect(metadata).toStrictEqual({
      cachedUntil: '2026-09-01T11:01:00.000Z',
      refreshFailureClass: 'esi-unavailable',
      retryAt: '2026-09-01T11:02:00.000Z',
      stale: true,
      validatedAt: '2026-09-01T11:00:00.000Z',
    })
  })

  test('uses the earliest expiry, oldest validation, oldest stale failure, and latest retry', () => {
    expect(
      combineEsiResultMetadata([
        {
          cachedUntil: '2026-09-01T11:03:00.000Z',
          stale: false,
          validatedAt: '2026-09-01T11:00:00.000Z',
        },
        {
          cachedUntil: '2026-09-01T11:02:00.000Z',
          refreshFailureClass: 'response-invalid',
          retryAt: '2026-09-01T11:04:00.000Z',
          stale: true,
          validatedAt: '2026-09-01T10:58:00.000Z',
        },
        {
          cachedUntil: '2026-09-01T11:04:00.000Z',
          refreshFailureClass: 'esi-cooldown',
          retryAt: '2026-09-01T11:05:00.000Z',
          stale: true,
          validatedAt: '2026-09-01T10:59:00.000Z',
        },
        {
          cachedUntil: '2026-09-01T11:05:00.000Z',
          retryAt: '2026-09-01T11:06:00.000Z',
          stale: false,
          validatedAt: '2026-09-01T11:01:00.000Z',
        },
      ]),
    ).toStrictEqual({
      cachedUntil: '2026-09-01T11:02:00.000Z',
      refreshFailureClass: 'response-invalid',
      retryAt: '2026-09-01T11:05:00.000Z',
      stale: true,
      validatedAt: '2026-09-01T10:58:00.000Z',
    })
  })

  test('ignores malformed retry boundaries', () => {
    expect(
      combineEsiResultMetadata([
        {
          cachedUntil: '2026-09-01T11:02:00.000Z',
          retryAt: 'later',
          stale: true,
          validatedAt: '2026-09-01T10:58:00.000Z',
        },
      ]),
    ).toStrictEqual({
      cachedUntil: '2026-09-01T11:02:00.000Z',
      stale: true,
      validatedAt: '2026-09-01T10:58:00.000Z',
    })
  })
})
