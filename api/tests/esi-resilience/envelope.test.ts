import { describe, expect, test } from 'vitest'
import { env } from '../../src/env.js'
import {
  createCacheEnvelope,
  getEsiQuota,
  isEnvelopeFresh,
  isEnvelopeRetained,
  isEnvelopeStaleUsable,
  toRevalidation,
  updateNotModifiedEnvelope,
} from '../../src/esi-resilience/envelope.js'
import { BoundedEsiL1Cache } from '../../src/esi-resilience/l1.js'
import { getEsiOperationContract } from '../../src/esi-resilience/catalog.js'

const policy = getEsiOperationContract('public-character')
const retentionMilliseconds = policy.cache.kind === 'none' ? 0 : policy.cache.retentionMilliseconds
const now = Date.parse('2026-08-20T12:00:00.000Z')

describe('ESI cache envelopes', () => {
  test('uses upstream expiry and retains stale values only within policy bounds', () => {
    const envelope = createCacheEnvelope({
      data: { name: 'Bandera' },
      fence: 3,
      policy,
      representationVersion: 'v1',
      now,
      metadata: {
        status: 200,
        headers: {},
        cache: { expires: '2026-08-20T12:01:00.000Z', etag: '"v1"', lastModified: 'yesterday' },
      },
    })

    expect(envelope).toMatchObject({
      version: 2,
      representationVersion: 'v1',
      freshUntil: now + 60_000,
      staleUntil: now + 3_660_000,
      retainUntil: now + 60_000 + retentionMilliseconds,
      etag: '"v1"',
      lastModified: 'yesterday',
      fence: 3,
    })
    expect(isEnvelopeFresh(envelope, now + 59_999)).toBe(true)
    expect(isEnvelopeFresh(envelope, now + 60_000)).toBe(false)
    expect(isEnvelopeRetained(envelope, envelope.retainUntil - 1)).toBe(true)
    expect(isEnvelopeRetained(envelope, envelope.retainUntil)).toBe(false)
  })

  test('falls back to cache-control relative to the upstream date or reviewed freshness', () => {
    const fromCacheControl = createCacheEnvelope({
      data: 1,
      fence: 1,
      policy,
      representationVersion: 'v1',
      now,
      metadata: {
        status: 200,
        headers: { date: '2026-08-20T11:59:50.000Z' },
        cache: { cacheControl: 'private, max-age=42' },
      },
    })
    const fallback = createCacheEnvelope({
      data: 1,
      fence: 1,
      policy,
      representationVersion: 'v1',
      now,
    })

    expect(fromCacheControl.freshUntil).toBe(now + 32_000)
    expect(fallback.freshUntil).toBe(now + 86_400_000)
  })

  test('applies the resolver freshness override and keeps runtime-only results immediately stale', () => {
    const resolver = getEsiOperationContract('universe-resolve-names')
    const resolved = createCacheEnvelope({
      data: 1,
      fence: 1,
      policy: resolver,
      representationVersion: 'v1',
      now,
    })
    const runtimeOnly = createCacheEnvelope({
      data: 1,
      fence: 1,
      policy: { ...resolver, freshness: { kind: 'runtime-only' } },
      representationVersion: 'v1',
      now,
    })

    expect(resolved.freshUntil).toBe(now + 3_600_000)
    expect(isEnvelopeFresh(resolved, now + 3_599_999)).toBe(true)
    expect(runtimeOnly.freshUntil).toBe(now)
    expect(isEnvelopeFresh(runtimeOnly, now)).toBe(false)
    expect(isEnvelopeRetained(runtimeOnly, now)).toBe(true)
  })

  test('preserves validators and authorization metadata after a 304', () => {
    const original = createCacheEnvelope({
      data: { name: 'Bandera' },
      fence: 4,
      policy,
      representationVersion: 'v1',
      authorization: { kind: 'character', principal: 'character-1', generation: 3 },
      now,
      metadata: {
        status: 200,
        headers: { 'x-ratelimit-remaining': '99' },
        cache: { etag: '"old"', lastModified: 'old' },
      },
    })
    const refreshed = updateNotModifiedEnvelope({
      envelope: original,
      metadata: {
        status: 304,
        headers: { 'x-ratelimit-remaining': '98' },
        cache: { cacheControl: 'max-age=10' },
      },
      policy,
      representationVersion: 'v1',
      authorization: { kind: 'character', principal: 'character-1', generation: 3 },
      now: now + 1_000,
    })

    expect(toRevalidation(original)).toEqual({ ifNoneMatch: '"old"', ifModifiedSince: 'old' })
    expect(toRevalidation(original, false)).toEqual({})
    expect(refreshed).toMatchObject({
      data: original.data,
      etag: '"old"',
      lastModified: 'old',
      freshUntil: now + 11_000,
      authorization: { kind: 'character', principal: 'character-1', generation: 3 },
    })
    expect(refreshed).not.toHaveProperty('quota')
    expect(getEsiQuota({ status: 304, headers: { 'x-ratelimit-remaining': '98' } })).toEqual({
      remaining: 98,
    })
  })

  test('retains private validators without permitting stale serving and bounds L1 by recency', () => {
    const privateEnvelope = createCacheEnvelope({
      data: 5,
      fence: 1,
      policy: getEsiOperationContract('wallet-balance'),
      representationVersion: 'v1',
      now,
    })
    const cache = new BoundedEsiL1Cache(2)
    cache.set('first', privateEnvelope)
    cache.set('second', privateEnvelope)
    cache.get('first')
    cache.set('third', privateEnvelope)

    expect(privateEnvelope.retainUntil).toBeGreaterThan(privateEnvelope.freshUntil)
    expect(privateEnvelope.staleUntil).toBe(privateEnvelope.freshUntil)
    expect(isEnvelopeStaleUsable(privateEnvelope, privateEnvelope.freshUntil)).toBe(false)
    expect(cache.get('first')).toBeDefined()
    expect(cache.get('second')).toBeUndefined()
    expect(cache.get('third')).toBeDefined()
    cache.clear()
    expect(cache.get('first')).toBeUndefined()
    expect(cache.get('third')).toBeUndefined()
  })

  test('retains message bodies only through freshness and stamps their mailbox revision', () => {
    const envelope = createCacheEnvelope({
      data: { body: 'untrusted' },
      fence: 1,
      policy: getEsiOperationContract('mail-message'),
      representationVersion: 'v1',
      resourceRevision: { namespace: 'mailbox', value: 4 },
      now,
      metadata: { status: 200, headers: {}, cache: { cacheControl: 'max-age=30' } },
    })

    expect(envelope).toMatchObject({
      freshUntil: now + 30_000,
      staleUntil: now + 30_000,
      retainUntil: now + 30_000,
      resourceRevision: { namespace: 'mailbox', value: 4 },
    })
  })

  test('uses the exact next reviewed daily UTC boundary', () => {
    const dailyPolicy = getEsiOperationContract('universe-solar-system')
    const beforeBoundary = Date.parse('2026-08-20T11:04:59.000Z')
    const atBoundary = Date.parse('2026-08-20T11:05:00.000Z')

    const before = createCacheEnvelope({
      data: 1,
      fence: 1,
      policy: dailyPolicy,
      representationVersion: 'v1',
      now: beforeBoundary,
    })
    const at = createCacheEnvelope({
      data: 1,
      fence: 1,
      policy: dailyPolicy,
      representationVersion: 'v1',
      now: atBoundary,
    })

    expect(before.freshUntil).toBe(atBoundary)
    expect(at.freshUntil).toBe(Date.parse('2026-08-21T11:05:00.000Z'))
  })

  test('caps stale serving at the configured retention deadline', () => {
    const originalMaximumRetention = env.ESI_CACHE_MAX_RETENTION_SECONDS
    env.ESI_CACHE_MAX_RETENTION_SECONDS = 30
    try {
      const envelope = createCacheEnvelope({
        data: 1,
        fence: 1,
        policy,
        representationVersion: 'v1',
        now,
        metadata: { status: 200, headers: {}, cache: { cacheControl: 'max-age=60' } },
      })

      expect(envelope.retainUntil).toBe(envelope.freshUntil + 30_000)
      expect(envelope.staleUntil).toBe(envelope.retainUntil)
    } finally {
      env.ESI_CACHE_MAX_RETENTION_SECONDS = originalMaximumRetention
    }
  })
})
