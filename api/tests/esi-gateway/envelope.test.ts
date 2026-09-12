import { describe, expect, test } from 'vitest'
import {
  createCacheEnvelope,
  ESI_CACHE_ENVELOPE_VERSION,
  getEsiQuota,
  isEnvelopeFresh,
  isEnvelopeRetained,
  isEnvelopeStaleUsable,
  parseEnvelope,
  toRevalidation,
  updateNotModifiedEnvelope,
} from '../../src/esi-gateway/internal/envelope.js'
import { BoundedEsiL1Cache } from '../../src/esi-gateway/internal/l1-cache.js'
import { getEsiOperationContract } from '../../src/esi-gateway/internal/catalog-access.js'
import { sharedPrivateCache } from '../../src/esi-gateway/internal/contract-types.js'

const policy = getEsiOperationContract('public-character')
const retentionMilliseconds = policy.cache.kind === 'none' ? 0 : policy.cache.retentionMilliseconds
const now = Date.parse('2026-08-20T12:00:00.000Z')
const maximumRetentionMs = 86_400_000

describe('ESI cache envelopes', () => {
  test('validates cache metadata while preserving the original envelope fields', () => {
    const parsed = parseEnvelope<{ name: string }>(
      serializedEnvelope({
        authorization: { kind: 'character', principal: 'character-1', generation: 3 },
        resourceRevision: { namespace: 'mailbox', value: 4 },
        futureField: 'preserved',
      }),
    )

    expect(parsed).toEqual({
      success: true,
      envelope: expect.objectContaining({
        data: { name: 'cached' },
        authorization: { kind: 'character', principal: 'character-1', generation: 3 },
        resourceRevision: { namespace: 'mailbox', value: 4 },
        futureField: 'preserved',
      }),
    })
  })

  test('distinguishes obsolete versions from malformed envelopes', () => {
    expect(parseEnvelope(serializedEnvelope({ version: 2 }))).toEqual({
      success: false,
      reason: 'versionMismatch',
      found: 2,
    })
    expect(parseEnvelope(serializedEnvelope({ version: undefined }))).toEqual({
      success: false,
      reason: 'versionMismatch',
      found: undefined,
    })
    expect(parseEnvelope('{')).toEqual({ success: false, reason: 'malformedJson' })
    expect(parseEnvelope(serializedEnvelope({ freshUntil: now + 1, staleUntil: now }))).toEqual({
      success: false,
      reason: 'incoherentFreshnessWindow',
    })

    for (const serialized of [
      'null',
      serializedEnvelope({ data: undefined }),
      serializedEnvelope({ validatedAt: 'not-a-date' }),
      serializedEnvelope({ fence: -1 }),
      serializedEnvelope({
        authorization: { kind: 'character', principal: '', generation: 1 },
      }),
      serializedEnvelope({ resourceRevision: { namespace: 'mailbox', value: -1 } }),
    ])
      expect(parseEnvelope(serialized)).toEqual({ success: false, reason: 'invalidShape' })
  })

  test('uses upstream expiry and retains stale values only within policy bounds', () => {
    const envelope = createCacheEnvelope({
      data: { name: 'Bandera' },
      fence: 3,
      maximumRetentionMs,
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
      version: 3,
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
      maximumRetentionMs,
      policy,
      representationVersion: 'v1',
      now,
      metadata: {
        status: 200,
        headers: { date: '2026-08-20T11:59:50.000Z' },
        cache: { cacheControl: 'private, max-age=42', maxAgeSeconds: 42 },
      },
    })
    const fallback = createCacheEnvelope({
      data: 1,
      fence: 1,
      maximumRetentionMs,
      policy,
      representationVersion: 'v1',
      now,
    })

    expect(fromCacheControl.freshUntil).toBe(now + 32_000)
    expect(fallback.freshUntil).toBe(now + 86_400_000)
  })

  test.each([
    ['max-age=30junk', undefined, 86_400_000],
    ['max-age=ignored', 30, 30_000],
  ] as const)(
    'uses typed max-age %s/%s instead of reparsing Cache-Control',
    (cacheControl, maxAgeSeconds, expectedOffset) => {
      const envelope = createCacheEnvelope({
        data: 1,
        fence: 1,
        maximumRetentionMs,
        policy,
        representationVersion: 'v1',
        now,
        metadata: {
          status: 200,
          headers: {},
          cache: { cacheControl, ...(maxAgeSeconds === undefined ? {} : { maxAgeSeconds }) },
        },
      })

      expect(envelope.freshUntil).toBe(now + expectedOffset)
    },
  )

  test('projects route quota from typed SDK metadata', () => {
    expect(
      getEsiQuota({
        status: 200,
        headers: {
          'x-ratelimit-group': 'raw-group',
          'x-ratelimit-limit': 'not-a-number',
          'x-ratelimit-remaining': '-1',
          'x-ratelimit-used': '1.5',
        },
        routeRateLimit: { group: 'typed-group', limit: 100, remaining: 98, used: 2 },
        errorLimit: { remaining: 99, reset: 45 },
      }),
    ).toStrictEqual({
      group: 'typed-group',
      limit: '100',
      remaining: 98,
      used: 2,
      errorRemaining: 99,
      errorResetSeconds: 45,
    })
  })

  test('applies the resolver freshness override and keeps runtime-only results immediately stale', () => {
    const resolver = getEsiOperationContract('universe-resolve-names')
    const resolved = createCacheEnvelope({
      data: 1,
      fence: 1,
      maximumRetentionMs,
      policy: resolver,
      representationVersion: 'v1',
      now,
    })
    const runtimeOnly = createCacheEnvelope({
      data: 1,
      fence: 1,
      maximumRetentionMs,
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

  test('preserves validators and representation scope after a 304', () => {
    const original = createCacheEnvelope({
      data: { name: 'Bandera' },
      fence: 4,
      maximumRetentionMs,
      policy,
      representationVersion: 'v1',
      authorization: { kind: 'character', principal: 'character-1', generation: 3 },
      resourceRevision: { namespace: 'mailbox', value: 7 },
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
        cache: { cacheControl: 'max-age=10', maxAgeSeconds: 10, etag: '"new"' },
      },
      policy,
      fence: 5,
      maximumRetentionMs,
      authorization: { kind: 'character', principal: 'character-1', generation: 4 },
      now: now + 1_000,
    })

    expect(toRevalidation(original)).toEqual({ ifNoneMatch: '"old"', ifModifiedSince: 'old' })
    expect(toRevalidation(original, false)).toEqual({})
    expect(refreshed).toMatchObject({
      data: original.data,
      etag: '"new"',
      lastModified: 'old',
      freshUntil: now + 11_000,
      representationVersion: 'v1',
      authorization: { kind: 'character', principal: 'character-1', generation: 4 },
      resourceRevision: { namespace: 'mailbox', value: 7 },
      fence: 5,
    })
    expect(refreshed).not.toHaveProperty('quota')
    expect(getEsiQuota({ status: 304, headers: {}, routeRateLimit: { remaining: 98 } })).toEqual({
      remaining: 98,
    })
  })

  test('retains private validators behind an outage-only stale window and bounds L1 by recency', () => {
    const walletPolicy = getEsiOperationContract('wallet-balance')
    const privateCache = sharedPrivateCache(maximumRetentionMs)
    if (privateCache.kind === 'none') throw new Error('Expected shared private caching')
    const privateEnvelope = createCacheEnvelope({
      data: 5,
      fence: 1,
      maximumRetentionMs,
      policy: {
        ...walletPolicy,
        cache: { ...privateCache, revalidate: true },
      },
      representationVersion: 'v1',
      now,
    })
    const cache = new BoundedEsiL1Cache(2)
    cache.set('first', privateEnvelope)
    cache.set('second', privateEnvelope)
    cache.get('first')
    cache.set('third', privateEnvelope)

    expect(privateEnvelope.retainUntil).toBeGreaterThan(privateEnvelope.freshUntil)
    expect(privateEnvelope.staleUntil).toBe(privateEnvelope.retainUntil)
    expect(isEnvelopeStaleUsable(privateEnvelope, privateEnvelope.freshUntil)).toBe(true)
    expect(isEnvelopeStaleUsable(privateEnvelope, privateEnvelope.retainUntil)).toBe(false)
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
      maximumRetentionMs,
      policy: getEsiOperationContract('mail-message'),
      representationVersion: 'v1',
      resourceRevision: { namespace: 'mailbox', value: 4 },
      now,
      metadata: {
        status: 200,
        headers: {},
        cache: { cacheControl: 'max-age=30', maxAgeSeconds: 30 },
      },
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
      maximumRetentionMs,
      policy: dailyPolicy,
      representationVersion: 'v1',
      now: beforeBoundary,
    })
    const at = createCacheEnvelope({
      data: 1,
      fence: 1,
      maximumRetentionMs,
      policy: dailyPolicy,
      representationVersion: 'v1',
      now: atBoundary,
    })

    expect(before.freshUntil).toBe(atBoundary)
    expect(at.freshUntil).toBe(Date.parse('2026-08-21T11:05:00.000Z'))
  })

  test('caps configured private retention at the maximum retention deadline', () => {
    const walletPolicy = getEsiOperationContract('wallet-balance')
    const privateCache = sharedPrivateCache(120_000)
    if (walletPolicy.cache.kind === 'none' || privateCache.kind === 'none')
      throw new Error('Wallet balance must use shared private caching')
    const privatePolicy = {
      ...walletPolicy,
      cache: { ...privateCache, revalidate: walletPolicy.cache.revalidate },
    }
    const envelope = createCacheEnvelope({
      data: 1,
      fence: 1,
      maximumRetentionMs: 30_000,
      policy: privatePolicy,
      representationVersion: 'v1',
      now,
      metadata: {
        status: 200,
        headers: {},
        cache: { cacheControl: 'max-age=60', maxAgeSeconds: 60 },
      },
    })

    expect(privateCache.retentionMilliseconds).toBe(120_000)
    expect(envelope.retainUntil).toBe(envelope.freshUntil + 30_000)
    expect(envelope.staleUntil).toBe(envelope.retainUntil)
  })
})

function serializedEnvelope(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: ESI_CACHE_ENVELOPE_VERSION,
    representationVersion: 'v1',
    data: { name: 'cached' },
    freshUntil: now + 60_000,
    staleUntil: now + 60_000,
    retainUntil: now + 60_000,
    validatedAt: new Date(now).toISOString(),
    fence: 1,
    ...overrides,
  })
}
