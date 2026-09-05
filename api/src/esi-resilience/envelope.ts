import type { EsiResponseMetadata } from '@evespace/esi-client'
import { z } from 'zod'
import { env } from '../env.js'
import { isNonnegativeSafeInteger, isRecord } from '../type-guards.js'
import type { EsiFreshnessContract, EsiOperationContract } from './contract-types.js'
import { assertCacheValueSafe } from './cache-redaction.js'
import { parseFiniteNumber } from './numeric.js'
import type {
  EsiCacheAuthorization,
  EsiCacheEnvelope,
  EsiResourceRevision,
  EsiQuota,
  EsiRevalidation,
} from './types.js'

export const ESI_CACHE_ENVELOPE_VERSION = 3

export type EsiCacheEnvelopeRejectionReason =
  | 'malformedJson'
  | 'versionMismatch'
  | 'invalidShape'
  | 'incoherentFreshnessWindow'

export type EsiCacheEnvelopeParseResult<Data> =
  | { success: true; envelope: EsiCacheEnvelope<Data> }
  | {
      success: false
      reason: Exclude<EsiCacheEnvelopeRejectionReason, 'versionMismatch'>
    }
  | { success: false; reason: 'versionMismatch'; found: unknown }

const parseableTimestampSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'Unparseable timestamp',
})

const authorizationSchema = z.object({
  kind: z.literal('character'),
  principal: z.string().min(1),
  generation: z.number().int().nonnegative(),
}) satisfies z.ZodType<EsiCacheAuthorization>

const resourceRevisionSchema = z.object({
  namespace: z.string().min(1),
  value: z.number().int().nonnegative(),
}) satisfies z.ZodType<EsiResourceRevision>

const envelopeMetadataSchema = z.object({
  version: z.literal(ESI_CACHE_ENVELOPE_VERSION),
  representationVersion: z.string(),
  freshUntil: z.number(),
  staleUntil: z.number(),
  retainUntil: z.number(),
  validatedAt: parseableTimestampSchema,
  fence: z.number().int().nonnegative(),
  etag: z.string().optional(),
  lastModified: z.string().optional(),
  authorization: authorizationSchema.optional(),
  resourceRevision: resourceRevisionSchema.optional(),
}) satisfies z.ZodType<Omit<EsiCacheEnvelope<unknown>, 'data'>>

export function createCacheEnvelope<Data>(options: {
  data: Data
  metadata?: EsiResponseMetadata
  policy: EsiOperationContract
  representationVersion: string
  authorization?: EsiCacheAuthorization
  resourceRevision?: EsiResourceRevision
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
    version: ESI_CACHE_ENVELOPE_VERSION,
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

export function parseEnvelope<Data>(serialized: string): EsiCacheEnvelopeParseResult<Data> {
  let raw: unknown
  try {
    raw = JSON.parse(serialized) as unknown
  } catch {
    return { success: false, reason: 'malformedJson' }
  }
  if (!isRecord(raw)) return { success: false, reason: 'invalidShape' }
  if (raw.version !== ESI_CACHE_ENVELOPE_VERSION)
    return { success: false, reason: 'versionMismatch', found: raw.version }
  if (!isValidEnvelope(raw)) return { success: false, reason: 'invalidShape' }
  if (raw.freshUntil > raw.staleUntil || raw.staleUntil > raw.retainUntil)
    return { success: false, reason: 'incoherentFreshnessWindow' }
  return { success: true, envelope: raw as EsiCacheEnvelope<Data> }
}

export function updateNotModifiedEnvelope<Data>(options: {
  envelope: EsiCacheEnvelope<Data>
  metadata?: EsiResponseMetadata
  policy: EsiOperationContract
  now?: number
  fence?: number
}): EsiCacheEnvelope<Data> {
  const now = options.now ?? Date.now()
  const metadata: EsiResponseMetadata = {
    ...options.metadata,
    status: options.metadata?.status ?? 304,
    headers: options.metadata?.headers ?? {},
    cache: {
      ...options.metadata?.cache,
      etag: options.metadata?.cache?.etag ?? options.envelope.etag,
      lastModified: options.metadata?.cache?.lastModified ?? options.envelope.lastModified,
    },
  }

  // A 304 refreshes the existing representation; it cannot change its identity or scope.
  return createCacheEnvelope({
    data: options.envelope.data,
    metadata,
    policy: options.policy,
    representationVersion: options.envelope.representationVersion,
    authorization: options.envelope.authorization,
    resourceRevision: options.envelope.resourceRevision,
    fence: options.fence ?? options.envelope.fence,
    now,
  })
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
    remaining: parseFiniteNumber(metadata.headers['x-ratelimit-remaining']),
    used: parseFiniteNumber(metadata.headers['x-ratelimit-used']),
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
    if (isNonnegativeSafeInteger(milliseconds)) return reference + milliseconds
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

function isValidEnvelope(
  value: Readonly<Record<string, unknown>>,
): value is Readonly<Record<string, unknown>> & EsiCacheEnvelope<unknown> {
  return 'data' in value && envelopeMetadataSchema.safeParse(value).success
}
