import { describe, expect, test } from 'vitest'
import {
  createCacheEnvelope,
  isEnvelopeFresh,
  isEnvelopeRetained,
  toRevalidation,
  updateNotModifiedEnvelope,
} from '../src/esi-resilience/envelope.js'
import { BoundedEsiL1Cache } from '../src/esi-resilience/l1.js'
import { getEsiOperationPolicy } from '../src/esi-resilience/policy.js'

const policy = getEsiOperationPolicy('public-character')
const now = Date.parse('2026-08-20T12:00:00.000Z')

describe('ESI cache envelopes', () => {
  test('uses upstream expiry and retains stale values only within policy bounds', () => {
    const envelope = createCacheEnvelope({
      data: { name: 'Bandera' },
      fence: 3,
      policy,
      now,
      metadata: {
        status: 200,
        headers: {},
        cache: { expires: '2026-08-20T12:01:00.000Z', etag: '"v1"', lastModified: 'yesterday' },
      },
    })

    expect(envelope).toMatchObject({
      freshUntil: now + 60_000,
      retainUntil: now + 60_000 + policy.maximumStaleAgeMs,
      etag: '"v1"',
      lastModified: 'yesterday',
      fence: 3,
    })
    expect(isEnvelopeFresh(envelope, now + 59_999)).toBe(true)
    expect(isEnvelopeFresh(envelope, now + 60_000)).toBe(false)
    expect(isEnvelopeRetained(envelope, envelope.retainUntil - 1)).toBe(true)
    expect(isEnvelopeRetained(envelope, envelope.retainUntil)).toBe(false)
  })

  test('falls back to cache-control or a jittered policy TTL', () => {
    const fromCacheControl = createCacheEnvelope({
      data: 1,
      fence: 1,
      policy,
      now,
      metadata: { status: 200, headers: {}, cache: { cacheControl: 'private, max-age=42' } },
    })
    const fallback = createCacheEnvelope({
      data: 1,
      fence: 1,
      policy,
      now,
      random: () => 0.5,
    })

    expect(fromCacheControl.freshUntil).toBe(now + 42_000)
    expect(fallback.freshUntil).toBe(now + policy.upstreamExpiryFallbackMs + 2_500)
  })

  test('preserves validators and replaces quota metadata after a 304', () => {
    const original = createCacheEnvelope({
      data: { name: 'Bandera' },
      fence: 4,
      policy,
      now,
      metadata: {
        status: 200,
        headers: { 'x-ratelimit-remaining': '99' },
        cache: { etag: '"old"', lastModified: 'old' },
      },
    })
    const refreshed = updateNotModifiedEnvelope(
      original,
      {
        status: 304,
        headers: { 'x-ratelimit-remaining': '98' },
        cache: { cacheControl: 'max-age=10' },
      },
      policy,
      now + 1_000,
    )

    expect(toRevalidation(original)).toEqual({ ifNoneMatch: '"old"', ifModifiedSince: 'old' })
    expect(toRevalidation(original, false)).toEqual({})
    expect(refreshed).toMatchObject({
      data: original.data,
      etag: '"old"',
      lastModified: 'old',
      freshUntil: now + 11_000,
      quota: { remaining: 98 },
    })
  })

  test('retains private validators without permitting stale serving and bounds L1 by recency', () => {
    const privateEnvelope = createCacheEnvelope({
      data: 5,
      fence: 1,
      policy: getEsiOperationPolicy('wallet-balance'),
      now,
    })
    const cache = new BoundedEsiL1Cache(2)
    cache.set('first', privateEnvelope)
    cache.set('second', privateEnvelope)
    cache.get('first')
    cache.set('third', privateEnvelope)

    expect(privateEnvelope.retainUntil).toBeGreaterThan(privateEnvelope.freshUntil)
    expect(cache.get('first')).toBeDefined()
    expect(cache.get('second')).toBeUndefined()
    expect(cache.get('third')).toBeDefined()
  })
})
