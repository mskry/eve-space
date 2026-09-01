import type { EsiResponseMetadata } from '@evespace/esi-client'
import { env } from '../env.js'
import type { EsiFreshnessContract, EsiOperationContract } from './catalog.js'
import { assertCacheValueSafe } from './namespaces.js'
import type {
  EsiCacheAuthorization,
  EsiCacheEnvelope,
  EsiCacheResourceRevision,
  EsiQuota,
  EsiRevalidation,
} from './types.js'

export function createCacheEnvelope<Data>(options: {
  data: Data
  metadata?: EsiResponseMetadata
  policy: EsiOperationContract
  representationVersion: string
  authorization?: EsiCacheAuthorization
  resourceRevision?: EsiCacheResourceRevision
  fence: number
  now?: number
}): EsiCacheEnvelope<Data> {
  assertCacheValueSafe(options.data)
  const now = options.now ?? Date.now()
  const freshUntil = resolveFreshUntil(options.metadata, options.policy.freshness, now)
  const retentionMilliseconds =
    options.policy.cache.kind === 'none' ? 0 : options.policy.cache.retentionMilliseconds
  const maximumRetentionMs = Math.min(
    retentionMilliseconds,
    env.ESI_CACHE_MAX_RETENTION_SECONDS * 1_000,
  )
  const retainUntil = freshUntil + maximumRetentionMs
  const declaredStaleUntil =
    options.policy.cache.kind !== 'none' && options.policy.cache.stale.kind !== 'none'
      ? freshUntil + options.policy.cache.stale.milliseconds
      : freshUntil
  const staleUntil = Math.min(declaredStaleUntil, retainUntil)
  return {
    version: 3,
    representationVersion: options.representationVersion,
    data: options.data,
    freshUntil,
    staleUntil,
    retainUntil,
    validatedAt: new Date(now).toISOString(),
    etag: options.metadata?.cache?.etag,
    lastModified: options.metadata?.cache?.lastModified,
    authorization: options.authorization,
    resourceRevision: options.resourceRevision,
    fence: options.fence,
  }
}

export function updateNotModifiedEnvelope<Data>(options: {
  envelope: EsiCacheEnvelope<Data>
  metadata?: EsiResponseMetadata
  policy: EsiOperationContract
  representationVersion: string
  authorization?: EsiCacheAuthorization
  now?: number
  fence?: number
  resourceRevision?: EsiCacheResourceRevision
}): EsiCacheEnvelope<Data> {
  const now = options.now ?? Date.now()
  const refreshed = createCacheEnvelope({
    data: options.envelope.data,
    metadata: options.metadata,
    policy: options.policy,
    representationVersion: options.representationVersion,
    authorization: options.authorization,
    resourceRevision: options.resourceRevision ?? options.envelope.resourceRevision,
    fence: options.fence ?? options.envelope.fence,
    now,
  })
  return {
    ...refreshed,
    etag: options.metadata?.cache?.etag ?? options.envelope.etag,
    lastModified: options.metadata?.cache?.lastModified ?? options.envelope.lastModified,
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

export function isEnvelopeStaleUsable(envelope: EsiCacheEnvelope<unknown>, now = Date.now()) {
  return envelope.staleUntil > now
}

export function getEsiQuota(metadata: EsiResponseMetadata | undefined): EsiQuota {
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
  metadata: EsiResponseMetadata | undefined,
  fallback: EsiFreshnessContract,
  now: number,
) {
  const expires = metadata?.cache?.expires ? Date.parse(metadata.cache.expires) : Number.NaN
  if (Number.isFinite(expires) && expires > now) return expires

  const responseDate = metadata?.headers.date ? Date.parse(metadata.headers.date) : Number.NaN
  const reference = Number.isFinite(responseDate) ? responseDate : now
  const maxAge = metadata?.cache?.cacheControl?.match(/(?:^|,)\s*max-age=(\d+)/i)?.[1]
  if (maxAge) {
    const milliseconds = Number(maxAge) * 1_000
    if (Number.isSafeInteger(milliseconds) && milliseconds >= 0) return reference + milliseconds
  }

  if (fallback.kind === 'relative') return now + fallback.seconds * 1_000
  if (fallback.kind !== 'daily-utc') return now

  const date = new Date(reference)
  let boundary = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    fallback.hour,
    fallback.minute,
  )
  if (boundary <= reference) boundary += 86_400_000
  return boundary
}

function parseNumber(value: string | undefined) {
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
