import type { EsiCacheMetadata, EsiResponseMetadata } from '@evespace/esi-client'
import { env } from '../env.js'
import { assertCacheValueSafe } from './namespaces.js'
import type { EsiOperationPolicy } from './policy.js'
import type { EsiCacheEnvelope, EsiQuota, EsiRevalidation } from './types.js'

export function createCacheEnvelope<Data>(options: {
  data: Data
  metadata?: EsiResponseMetadata
  policy: EsiOperationPolicy
  fence: number
  now?: number
  random?: () => number
}): EsiCacheEnvelope<Data> {
  assertCacheValueSafe(options.data)
  const now = options.now ?? Date.now()
  const freshUntil = resolveFreshUntil(options.metadata?.cache, options.policy, now, options.random)
  const maximumRetentionMs = Math.min(
    options.policy.maximumRetentionAgeMs,
    env.ESI_CACHE_MAX_RETENTION_SECONDS * 1_000,
  )
  return {
    version: 1,
    data: options.data,
    freshUntil,
    retainUntil: freshUntil + maximumRetentionMs,
    validatedAt: new Date(now).toISOString(),
    etag: options.metadata?.cache?.etag,
    lastModified: options.metadata?.cache?.lastModified,
    quota: getQuota(options.metadata),
    fence: options.fence,
  }
}

export function updateNotModifiedEnvelope<Data>(
  envelope: EsiCacheEnvelope<Data>,
  metadata: EsiResponseMetadata | undefined,
  policy: EsiOperationPolicy,
  now = Date.now(),
): EsiCacheEnvelope<Data> {
  const refreshed = createCacheEnvelope({
    data: envelope.data,
    metadata,
    policy,
    fence: envelope.fence,
    now,
  })
  return {
    ...refreshed,
    etag: metadata?.cache?.etag ?? envelope.etag,
    lastModified: metadata?.cache?.lastModified ?? envelope.lastModified,
    quota: metadata ? getQuota(metadata) : envelope.quota,
  }
}

export function toRevalidation(
  envelope: EsiCacheEnvelope<unknown> | undefined,
  revalidate = true,
): EsiRevalidation {
  if (!revalidate) return {}
  return {
    ...(envelope?.etag ? { ifNoneMatch: envelope.etag } : {}),
    ...(envelope?.lastModified ? { ifModifiedSince: envelope.lastModified } : {}),
  }
}

export function isEnvelopeFresh(envelope: EsiCacheEnvelope<unknown>, now = Date.now()) {
  return envelope.freshUntil > now
}

export function isEnvelopeRetained(envelope: EsiCacheEnvelope<unknown>, now = Date.now()) {
  return envelope.retainUntil > now
}

function getQuota(metadata: EsiResponseMetadata | undefined): EsiQuota {
  if (!metadata) return {}
  return {
    group: metadata.headers['x-ratelimit-group'],
    limit: metadata.headers['x-ratelimit-limit'],
    remaining: parseNumber(metadata.headers['x-ratelimit-remaining']),
    used: parseNumber(metadata.headers['x-ratelimit-used']),
    errorRemaining: metadata.errorLimit?.remaining,
    errorResetSeconds: metadata.errorLimit?.reset,
  }
}

function resolveFreshUntil(
  metadata: EsiCacheMetadata | undefined,
  policy: EsiOperationPolicy,
  now: number,
  random: () => number = Math.random,
) {
  const expires = metadata?.expires ? Date.parse(metadata.expires) : Number.NaN
  if (Number.isFinite(expires) && expires > now) return expires

  const maxAge = metadata?.cacheControl?.match(/(?:^|,)\s*max-age=(\d+)/i)?.[1]
  if (maxAge) {
    const milliseconds = Number(maxAge) * 1_000
    if (Number.isSafeInteger(milliseconds) && milliseconds >= 0) return now + milliseconds
  }

  return now + policy.upstreamExpiryFallbackMs + Math.floor(random() * policy.ttlJitterMs)
}

function parseNumber(value: string | undefined) {
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
