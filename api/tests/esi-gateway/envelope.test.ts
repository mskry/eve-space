import { describe, expect, test } from 'vitest'
import { z } from 'zod'
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
const cachedNameSchema = z.object({ name: z.string() })
const unknownSchema = z.unknown()

describe('ESI cache envelopes', () => {
  test('validates cache metadata while preserving the original envelope fields', () => {
    const parsed = parseEnvelope(
      serializedEnvelope({
        authorization: { generation: 3, kind: 'character', principal: 'character-1' },
        futureField: 'preserved',
        resourceRevision: { namespace: 'mailbox', value: 4 },
      }),
      cachedNameSchema,
    )

    expect(parsed).toStrictEqual({
      envelope: expect.objectContaining({
        data: { name: 'cached' },
        authorization: { kind: 'character', principal: 'character-1', generation: 3 },
        resourceRevision: { namespace: 'mailbox', value: 4 },
        futureField: 'preserved',
      }),
      success: true,
    })
  })

  test('distinguishes obsolete versions from malformed envelopes', () => {
    expect(parseEnvelope(serializedEnvelope({ version: 2 }), unknownSchema)).toStrictEqual({
      found: 2,
      reason: 'versionMismatch',
      success: false,
    })
    expect(parseEnvelope(serializedEnvelope({ version: undefined }), unknownSchema)).toStrictEqual({
      found: undefined,
      reason: 'versionMismatch',
      success: false,
    })
    expect(parseEnvelope('{', unknownSchema)).toStrictEqual({
      reason: 'malformedJson',
      success: false,
    })
    expect(
      parseEnvelope(serializedEnvelope({ freshUntil: now + 1, staleUntil: now }), unknownSchema),
    ).toStrictEqual({ reason: 'incoherentFreshnessWindow', success: false })

    for (const serialized of [
      'null',
      serializedEnvelope({ data: undefined }),
      serializedEnvelope({ validatedAt: 'not-a-date' }),
      serializedEnvelope({ fence: -1 }),
      serializedEnvelope({
        authorization: { generation: 1, kind: 'character', principal: '' },
      }),
      serializedEnvelope({ resourceRevision: { namespace: 'mailbox', value: -1 } }),
    ]) {
      expect(parseEnvelope(serialized, unknownSchema)).toStrictEqual({
        reason: 'invalidShape',
        success: false,
      })
    }
  })

  test('rejects an invalid representation payload without exposing validation details', () => {
    const serialized = serializedEnvelope({
      data: { name: 'private-cache-value', rank: 'invalid' },
    })
    const schema = z.object({ name: z.string(), rank: z.number() })

    const parsed = parseEnvelope(serialized, schema)

    expect(parsed).toStrictEqual({ reason: 'invalidPayload', success: false })
    expect(JSON.stringify(parsed)).not.toContain('private-cache-value')
  })

  test('uses upstream expiry and retains stale values only within policy bounds', () => {
    const envelope = createCacheEnvelope({
      data: { name: 'Bandera' },
      fence: 3,
      maximumRetentionMs,
      metadata: {
        cache: { etag: '"v1"', expires: '2026-08-20T12:01:00.000Z', lastModified: 'yesterday' },
        headers: {},
        pagination: { pages: 7 },
        status: 200,
      },
      now,
      policy,
      representationVersion: 'v1',
    })

    expect(envelope).toMatchObject({
      etag: '"v1"',
      fence: 3,
      freshUntil: now + 60_000,
      lastModified: 'yesterday',
      pagination: { pages: 7 },
      representationVersion: 'v1',
      retainUntil: now + 60_000 + retentionMilliseconds,
      staleUntil: now + 3_660_000,
      version: 3,
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
      metadata: {
        cache: { cacheControl: 'private, max-age=42', maxAgeSeconds: 42 },
        headers: { date: '2026-08-20T11:59:50.000Z' },
        status: 200,
      },
      now,
      policy,
      representationVersion: 'v1',
    })
    const fallback = createCacheEnvelope({
      data: 1,
      fence: 1,
      maximumRetentionMs,
      now,
      policy,
      representationVersion: 'v1',
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
        metadata: {
          cache: { cacheControl, ...(!(maxAgeSeconds === undefined) && { maxAgeSeconds }) },
          headers: {},
          status: 200,
        },
        now,
        policy,
        representationVersion: 'v1',
      })

      expect(envelope.freshUntil).toBe(now + expectedOffset)
    },
  )

  test('projects route quota from typed SDK metadata', () => {
    expect(
      getEsiQuota({
        errorLimit: { remaining: 99, reset: 45 },
        headers: {
          'x-ratelimit-group': 'raw-group',
          'x-ratelimit-limit': 'not-a-number',
          'x-ratelimit-remaining': '-1',
          'x-ratelimit-used': '1.5',
        },
        routeRateLimit: { group: 'typed-group', limit: 100, remaining: 98, used: 2 },
        status: 200,
      }),
    ).toStrictEqual({
      errorRemaining: 99,
      errorResetSeconds: 45,
      group: 'typed-group',
      limit: '100',
      remaining: 98,
      used: 2,
    })
  })

  test('applies the resolver freshness override and keeps runtime-only results immediately stale', () => {
    const resolver = getEsiOperationContract('universe-resolve-names')
    const resolved = createCacheEnvelope({
      data: 1,
      fence: 1,
      maximumRetentionMs,
      now,
      policy: resolver,
      representationVersion: 'v1',
    })
    const runtimeOnly = createCacheEnvelope({
      data: 1,
      fence: 1,
      maximumRetentionMs,
      now,
      policy: { ...resolver, freshness: { kind: 'runtime-only' } },
      representationVersion: 'v1',
    })

    expect(resolved.freshUntil).toBe(now + 3_600_000)
    expect(isEnvelopeFresh(resolved, now + 3_599_999)).toBe(true)
    expect(runtimeOnly.freshUntil).toBe(now)
    expect(isEnvelopeFresh(runtimeOnly, now)).toBe(false)
    expect(isEnvelopeRetained(runtimeOnly, now)).toBe(true)
  })

  test('preserves validators and representation scope after a 304', () => {
    const original = createCacheEnvelope({
      authorization: { generation: 3, kind: 'character', principal: 'character-1' },
      data: { name: 'Bandera' },
      fence: 4,
      maximumRetentionMs,
      metadata: {
        cache: { etag: '"old"', lastModified: 'old' },
        headers: { 'x-ratelimit-remaining': '99' },
        pagination: { pages: 3 },
        status: 200,
      },
      now,
      policy,
      representationVersion: 'v1',
      resourceRevision: { namespace: 'mailbox', value: 7 },
    })
    const refreshed = updateNotModifiedEnvelope({
      authorization: { generation: 4, kind: 'character', principal: 'character-1' },
      envelope: original,
      fence: 5,
      maximumRetentionMs,
      metadata: {
        cache: { cacheControl: 'max-age=10', etag: '"new"', maxAgeSeconds: 10 },
        headers: { 'x-ratelimit-remaining': '98' },
        status: 304,
      },
      now: now + 1000,
      policy,
    })

    expect(toRevalidation(original)).toStrictEqual({ ifModifiedSince: 'old', ifNoneMatch: '"old"' })
    expect(toRevalidation(original, false)).toStrictEqual({})
    expect(refreshed).toMatchObject({
      authorization: { generation: 4, kind: 'character', principal: 'character-1' },
      data: original.data,
      etag: '"new"',
      fence: 5,
      freshUntil: now + 11_000,
      lastModified: 'old',
      pagination: { pages: 3 },
      representationVersion: 'v1',
      resourceRevision: { namespace: 'mailbox', value: 7 },
    })
    expect(refreshed).not.toHaveProperty('quota')
    expect(
      getEsiQuota({ headers: {}, routeRateLimit: { remaining: 98 }, status: 304 }),
    ).toStrictEqual({
      errorRemaining: undefined,
      errorResetSeconds: undefined,
      group: undefined,
      limit: undefined,
      remaining: 98,
      used: undefined,
    })
  })

  test('retains private validators behind an outage-only stale window and bounds L1 by recency', () => {
    const walletPolicy = getEsiOperationContract('wallet-balance')
    const privateCache = sharedPrivateCache(maximumRetentionMs)
    if (privateCache.kind === 'none') {
      throw new Error('Expected shared private caching')
    }
    const privateEnvelope = createCacheEnvelope({
      data: 5,
      fence: 1,
      maximumRetentionMs,
      now,
      policy: {
        ...walletPolicy,
        cache: { ...privateCache, revalidate: true },
      },
      representationVersion: 'v1',
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
      metadata: {
        cache: { cacheControl: 'max-age=30', maxAgeSeconds: 30 },
        headers: {},
        status: 200,
      },
      now,
      policy: getEsiOperationContract('mail-message'),
      representationVersion: 'v1',
      resourceRevision: { namespace: 'mailbox', value: 4 },
    })

    expect(envelope).toMatchObject({
      freshUntil: now + 30_000,
      resourceRevision: { namespace: 'mailbox', value: 4 },
      retainUntil: now + 30_000,
      staleUntil: now + 30_000,
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
      now: beforeBoundary,
      policy: dailyPolicy,
      representationVersion: 'v1',
    })
    const at = createCacheEnvelope({
      data: 1,
      fence: 1,
      maximumRetentionMs,
      now: atBoundary,
      policy: dailyPolicy,
      representationVersion: 'v1',
    })

    expect(before.freshUntil).toBe(atBoundary)
    expect(at.freshUntil).toBe(Date.parse('2026-08-21T11:05:00.000Z'))
  })

  test('caps configured private retention at the maximum retention deadline', () => {
    const walletPolicy = getEsiOperationContract('wallet-balance')
    const privateCache = sharedPrivateCache(120_000)
    if (walletPolicy.cache.kind === 'none' || privateCache.kind === 'none') {
      throw new Error('Wallet balance must use shared private caching')
    }
    const privatePolicy = {
      ...walletPolicy,
      cache: { ...privateCache, revalidate: walletPolicy.cache.revalidate },
    }
    const envelope = createCacheEnvelope({
      data: 1,
      fence: 1,
      maximumRetentionMs: 30_000,
      metadata: {
        cache: { cacheControl: 'max-age=60', maxAgeSeconds: 60 },
        headers: {},
        status: 200,
      },
      now,
      policy: privatePolicy,
      representationVersion: 'v1',
    })

    expect(privateCache.retentionMilliseconds).toBe(120_000)
    expect(envelope.retainUntil).toBe(envelope.freshUntil + 30_000)
    expect(envelope.staleUntil).toBe(envelope.retainUntil)
  })
})

function serializedEnvelope(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    data: { name: 'cached' },
    fence: 1,
    freshUntil: now + 60_000,
    representationVersion: 'v1',
    retainUntil: now + 60_000,
    staleUntil: now + 60_000,
    validatedAt: new Date(now).toISOString(),
    version: ESI_CACHE_ENVELOPE_VERSION,
    ...overrides,
  })
}
