import type { EsiResponseMetadata } from '@evespace/esi-client'
import type { OperationSchema } from '@evespace/esi-client/operations'
import { z } from 'zod'
import { isRecord } from '../../type-guards.js'
import type { EsiFreshnessContract, EsiOperationContract } from './contract-types.js'
import { assertCacheValueSafe } from './cache-redaction.js'
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
  | 'invalidPayload'
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
  generation: z.number().int().nonnegative(),
  kind: z.literal('character'),
  principal: z.string().min(1),
}) satisfies z.ZodType<EsiCacheAuthorization>

const resourceRevisionSchema = z.object({
  namespace: z.string().min(1),
  value: z.number().int().nonnegative(),
}) satisfies z.ZodType<EsiResourceRevision>

const paginationSchema = z.object({
  pages: z.number().int().positive().optional(),
})

const envelopeMetadataSchema = z.object({
  authorization: authorizationSchema.optional(),
  etag: z.string().optional(),
  fence: z.number().int().nonnegative(),
  freshUntil: z.number(),
  lastModified: z.string().optional(),
  pagination: paginationSchema.optional(),
  representationVersion: z.string(),
  resourceRevision: resourceRevisionSchema.optional(),
  retainUntil: z.number(),
  staleUntil: z.number(),
  validatedAt: parseableTimestampSchema,
  version: z.literal(ESI_CACHE_ENVELOPE_VERSION),
}) satisfies z.ZodType<Omit<EsiCacheEnvelope<unknown>, 'data'>>

/**
 * The envelope has one string slot for representation identity, so a named representation is
 * folded into it rather than added as a second field the untrusted-input parser would have to
 * validate independently.
 */
export function composeEnvelopeRepresentationVersion(
  representationVersion: string,
  representationName?: string,
) {
  return representationName
    ? `${representationName}@${representationVersion}`
    : representationVersion
}

export function createCacheEnvelope<Data>(options: {
  data: Data
  metadata?: EsiResponseMetadata
  policy: EsiOperationContract
  representationVersion: string
  authorization?: EsiCacheAuthorization
  resourceRevision?: EsiResourceRevision
  fence: number
  maximumRetentionMs: number
  now?: number
}): EsiCacheEnvelope<Data> {
  assertCacheValueSafe(options.data)
  const now = options.now ?? Date.now()
  const freshUntil = resolveFreshUntil(options.metadata, options.policy.freshness, now)
  const retentionMilliseconds =
    options.policy.cache.kind === 'none' ? 0 : options.policy.cache.retentionMilliseconds
  const maximumRetentionMs = Math.min(retentionMilliseconds, options.maximumRetentionMs)
  const retainUntil = freshUntil + maximumRetentionMs
  const declaredStaleUntil =
    options.policy.cache.kind !== 'none' && options.policy.cache.stale.kind !== 'none'
      ? freshUntil + options.policy.cache.stale.milliseconds
      : freshUntil
  const staleUntil = Math.min(declaredStaleUntil, retainUntil)
  return {
    authorization: options.authorization,
    data: options.data,
    etag: options.metadata?.cache?.etag,
    fence: options.fence,
    freshUntil,
    lastModified: options.metadata?.cache?.lastModified,
    pagination:
      options.metadata?.pagination?.pages === undefined
        ? undefined
        : { pages: options.metadata.pagination.pages },
    representationVersion: options.representationVersion,
    resourceRevision: options.resourceRevision,
    retainUntil,
    staleUntil,
    validatedAt: new Date(now).toISOString(),
    version: ESI_CACHE_ENVELOPE_VERSION,
  }
}

export function parseEnvelope<Data>(
  serialized: string,
  dataSchema: OperationSchema<Data>,
): EsiCacheEnvelopeParseResult<Data> {
  let raw: unknown
  try {
    raw = JSON.parse(serialized) as unknown
  } catch {
    return { reason: 'malformedJson', success: false }
  }
  if (!isRecord(raw)) {
    return { reason: 'invalidShape', success: false }
  }
  if (raw.version !== ESI_CACHE_ENVELOPE_VERSION) {
    return { found: raw.version, reason: 'versionMismatch', success: false }
  }
  if (!isValidEnvelope(raw)) {
    return { reason: 'invalidShape', success: false }
  }
  if (raw.freshUntil > raw.staleUntil || raw.staleUntil > raw.retainUntil) {
    return { reason: 'incoherentFreshnessWindow', success: false }
  }
  return validateEnvelopeData(raw, dataSchema)
}

export function validateEnvelopeData<Data>(
  envelope: EsiCacheEnvelope<unknown>,
  dataSchema: OperationSchema<Data>,
): EsiCacheEnvelopeParseResult<Data> {
  const parsed = dataSchema.safeParse(envelope.data)
  if (!parsed.success) {
    return { reason: 'invalidPayload', success: false }
  }
  return { envelope: { ...envelope, data: parsed.data }, success: true }
}

export function updateNotModifiedEnvelope<Data>(options: {
  envelope: EsiCacheEnvelope<Data>
  metadata?: EsiResponseMetadata
  policy: EsiOperationContract
  now?: number
  fence?: number
  authorization?: EsiCacheAuthorization
  maximumRetentionMs: number
}): EsiCacheEnvelope<Data> {
  const now = options.now ?? Date.now()
  const metadata: EsiResponseMetadata = {
    ...options.metadata,
    cache: {
      ...options.metadata?.cache,
      etag: options.metadata?.cache?.etag ?? options.envelope.etag,
      lastModified: options.metadata?.cache?.lastModified ?? options.envelope.lastModified,
    },
    headers: options.metadata?.headers ?? {},
    pagination: {
      ...options.metadata?.pagination,
      pages: options.metadata?.pagination?.pages ?? options.envelope.pagination?.pages,
    },
    status: options.metadata?.status ?? 304,
  }

  // A 304 preserves representation identity while allowing authorization generation rebinding.
  return createCacheEnvelope({
    authorization: options.authorization ?? options.envelope.authorization,
    data: options.envelope.data,
    fence: options.fence ?? options.envelope.fence,
    maximumRetentionMs: options.maximumRetentionMs,
    metadata,
    now,
    policy: options.policy,
    representationVersion: options.envelope.representationVersion,
    resourceRevision: options.envelope.resourceRevision,
  })
}

export function toRevalidation(
  envelope: EsiCacheEnvelope<unknown> | undefined,
  revalidate = true,
): EsiRevalidation {
  if (!revalidate) {
    return {}
  }
  return {
    ...(envelope?.etag && { ifNoneMatch: envelope.etag }),
    ...(envelope?.lastModified && { ifModifiedSince: envelope.lastModified }),
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
  if (!metadata) {
    return {}
  }
  return {
    errorRemaining: metadata.errorLimit?.remaining,
    errorResetSeconds: metadata.errorLimit?.reset,
    group: metadata.routeRateLimit?.group,
    limit:
      metadata.routeRateLimit?.limit === undefined
        ? undefined
        : String(metadata.routeRateLimit.limit),
    remaining: metadata.routeRateLimit?.remaining,
    used: metadata.routeRateLimit?.used,
  }
}

function resolveFreshUntil(
  metadata: EsiResponseMetadata | undefined,
  fallback: EsiFreshnessContract,
  now: number,
) {
  const expires = metadata?.cache?.expires ? Date.parse(metadata.cache.expires) : Number.NaN
  if (Number.isFinite(expires) && expires > now) {
    return expires
  }

  const responseDate = metadata?.headers.date ? Date.parse(metadata.headers.date) : Number.NaN
  const reference = Number.isFinite(responseDate) ? responseDate : now
  const maxAgeSeconds = metadata?.cache?.maxAgeSeconds
  if (maxAgeSeconds !== undefined) {
    return reference + maxAgeSeconds * 1000
  }

  if (fallback.kind === 'relative') {
    return now + fallback.seconds * 1000
  }
  if (fallback.kind !== 'daily-utc') {
    return now
  }

  const date = new Date(reference)
  let boundary = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    fallback.hour,
    fallback.minute,
  )
  if (boundary <= reference) {
    boundary += 86_400_000
  }
  return boundary
}

function isValidEnvelope(
  value: Readonly<Record<string, unknown>>,
): value is Readonly<Record<string, unknown>> & EsiCacheEnvelope<unknown> {
  return 'data' in value && envelopeMetadataSchema.safeParse(value).success
}
