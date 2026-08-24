import type {
  EsiCacheMetadata,
  EsiErrorLimitMetadata,
  EsiResponseMetadata,
} from '@evespace/esi-client'
import { env } from './env.js'
import {
  esiCooldownFallbackSeconds,
  esiDefaultCacheTtlMs,
  esiErrorBudgetFloor,
} from './esi-policy.js'
import { getCharacterAccessToken } from './token-service.js'

export interface EsiQuota {
  group?: string
  limit?: string
  remaining?: number
  used?: number
  errorRemaining?: number
  errorResetSeconds?: number
}

export interface CachedEsiResult<Data> {
  data: Data
  cachedUntil: string
  source: 'esi' | 'cache' | 'not-modified'
  stale: boolean
  retryAt?: string
  quota: EsiQuota
}

export interface EsiRevalidation {
  ifNoneMatch?: string
  ifModifiedSince?: string
}

export class EsiQuotaError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('ESI quota is temporarily exhausted')
  }
}

interface CacheEntry<Data> {
  data: Data
  expiresAt: number
  etag?: string
  lastModified?: string
  quota: EsiQuota
}

/**
 * Per-character cache for a protected ESI resource: honours the response's own expiry, revalidates
 * with etag/last-modified, de-duplicates concurrent loads, and backs off on quota or error-budget
 * pressure. Callers supply only the scope and the request; everything else is shared.
 */
export function createCharacterResourceCache<Data>(options: {
  scope: string
  load: (
    characterId: number,
    accessToken: string,
    revalidation: EsiRevalidation,
  ) => Promise<{ data: Data; meta: EsiResponseMetadata }>
  maxEntries?: number
}) {
  const cache = new Map<number, CacheEntry<Data>>()
  const inFlight = new Map<number, Promise<CachedEsiResult<Data>>>()
  const cooldowns = new Map<number, number>()
  const maxEntries = options.maxEntries ?? env.ESI_CACHE_MAX_ENTRIES

  async function get(characterId: number): Promise<CachedEsiResult<Data>> {
    const now = Date.now()
    const cached = cache.get(characterId)
    if (cached && cached.expiresAt > now) return toResult(cached, 'cache', false)

    const cooldownUntil = cooldowns.get(characterId) ?? 0
    if (cooldownUntil > now) {
      if (cached) return toResult(cached, 'cache', true, cooldownUntil)
      throw new EsiQuotaError(Math.max(1, Math.ceil((cooldownUntil - now) / 1000)))
    }
    if (cooldownUntil) cooldowns.delete(characterId)

    const pending = inFlight.get(characterId)
    if (pending) return pending

    const request = load(characterId, cached).finally(() => inFlight.delete(characterId))
    inFlight.set(characterId, request)
    return request
  }

  async function load(characterId: number, cached?: CacheEntry<Data>) {
    const accessToken = await getCharacterAccessToken(characterId, options.scope)

    try {
      const response = await options.load(characterId, accessToken, {
        ifNoneMatch: cached?.etag,
        ifModifiedSince: cached?.lastModified,
      })
      const entry: CacheEntry<Data> = {
        data: response.data,
        expiresAt: resolveExpiry(response.meta.cache),
        etag: response.meta.cache?.etag,
        lastModified: response.meta.cache?.lastModified,
        quota: getQuota(response.meta),
      }

      applyErrorBudgetCooldown(characterId, response.meta.errorLimit)
      setBounded(cache, characterId, entry, maxEntries)
      return toResult(entry, 'esi', false)
    } catch (error) {
      const status = getErrorStatus(error)
      const metadata = getErrorMetadata(error)

      if (status === 304 && cached) return storeNotModified(characterId, cached, metadata)
      if (status === 429) return recoverFromRateLimit(characterId, cached, metadata)
      if (hasExhaustedErrorBudget(metadata))
        return recoverFromErrorBudget(characterId, cached, metadata.errorLimit, error)

      throw error
    }
  }

  function storeNotModified(
    characterId: number,
    cached: CacheEntry<Data>,
    metadata?: EsiResponseMetadata,
  ) {
    const entry: CacheEntry<Data> = {
      ...cached,
      expiresAt: resolveExpiry(metadata?.cache),
      etag: metadata?.cache?.etag ?? cached.etag,
      lastModified: metadata?.cache?.lastModified ?? cached.lastModified,
      quota: metadata ? getQuota(metadata) : cached.quota,
    }
    setBounded(cache, characterId, entry, maxEntries)
    return toResult(entry, 'not-modified', false)
  }

  function recoverFromRateLimit(
    characterId: number,
    cached: CacheEntry<Data> | undefined,
    metadata?: EsiResponseMetadata,
  ) {
    const retryAfter = parseNumber(metadata?.headers['retry-after']) ?? esiCooldownFallbackSeconds
    const retryAt = startCooldown(characterId, retryAfter)
    if (cached) return toResult(cached, 'cache', true, retryAt)
    throw new EsiQuotaError(retryAfter)
  }

  function recoverFromErrorBudget(
    characterId: number,
    cached: CacheEntry<Data> | undefined,
    errorLimit: EsiErrorLimitMetadata,
    error: unknown,
  ) {
    const retryAt = startCooldown(characterId, errorLimit.reset ?? esiCooldownFallbackSeconds)
    if (cached) return toResult(cached, 'cache', true, retryAt)
    throw error
  }

  function startCooldown(characterId: number, seconds: number) {
    const retryAt = Date.now() + seconds * 1000
    setBounded(cooldowns, characterId, retryAt, maxEntries)
    return retryAt
  }

  function applyErrorBudgetCooldown(characterId: number, errorLimit?: EsiErrorLimitMetadata) {
    if (errorLimit?.remaining !== undefined && errorLimit.remaining <= esiErrorBudgetFloor) {
      const reset = errorLimit.reset ?? esiCooldownFallbackSeconds
      setBounded(cooldowns, characterId, Date.now() + reset * 1000, maxEntries)
    }
  }

  return { get }
}

function hasExhaustedErrorBudget(
  metadata: EsiResponseMetadata | undefined,
): metadata is EsiResponseMetadata & { errorLimit: EsiErrorLimitMetadata } {
  return (
    metadata?.errorLimit?.remaining !== undefined &&
    metadata.errorLimit.remaining <= esiErrorBudgetFloor
  )
}

function toResult<Data>(
  entry: CacheEntry<Data>,
  source: CachedEsiResult<Data>['source'],
  stale: boolean,
  retryAt?: number,
): CachedEsiResult<Data> {
  return {
    data: entry.data,
    cachedUntil: new Date(entry.expiresAt).toISOString(),
    source,
    stale,
    ...(retryAt ? { retryAt: new Date(retryAt).toISOString() } : {}),
    quota: entry.quota,
  }
}

function resolveExpiry(cacheMetadata?: EsiCacheMetadata) {
  const expires = cacheMetadata?.expires ? Date.parse(cacheMetadata.expires) : Number.NaN
  if (Number.isFinite(expires) && expires > Date.now()) return expires

  const maxAge = cacheMetadata?.cacheControl?.match(/max-age=(\d+)/i)?.[1]
  if (maxAge) return Date.now() + Number(maxAge) * 1000
  return Date.now() + esiDefaultCacheTtlMs
}

function getQuota(metadata: EsiResponseMetadata): EsiQuota {
  return {
    group: metadata.headers['x-ratelimit-group'],
    limit: metadata.headers['x-ratelimit-limit'],
    remaining: parseNumber(metadata.headers['x-ratelimit-remaining']),
    used: parseNumber(metadata.headers['x-ratelimit-used']),
    errorRemaining: metadata.errorLimit?.remaining,
    errorResetSeconds: metadata.errorLimit?.reset,
  }
}

function getErrorStatus(error: unknown) {
  return typeof error === 'object' && error && 'status' in error ? Number(error.status) : undefined
}

function getErrorMetadata(error: unknown): EsiResponseMetadata | undefined {
  if (typeof error !== 'object' || !error || !('metadata' in error)) return undefined
  return error.metadata as EsiResponseMetadata
}

function parseNumber(value: string | undefined) {
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function setBounded<T>(map: Map<number, T>, characterId: number, value: T, maxEntries: number) {
  map.delete(characterId)
  map.set(characterId, value)
  if (map.size <= maxEntries) return

  const oldestCharacterId = map.keys().next().value
  if (oldestCharacterId !== undefined) map.delete(oldestCharacterId)
}
