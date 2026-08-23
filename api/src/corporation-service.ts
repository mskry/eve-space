import { createCorporationClient } from '@evespace/esi-client/domains/corporation'
import { createUniverseClient } from '@evespace/esi-client/domains/universe'
import type { EsiResponseMetadata } from '@evespace/esi-client'
import { env } from './env.js'
import { esiFetch } from './esi-fetch.js'
import {
  esiCooldownFallbackSeconds,
  esiErrorBudgetFloor,
  notFoundCacheTtlMs,
  npcCorporationCacheTtlMs,
  publicProfileCacheTtlMs,
} from './esi-policy.js'
import { eveDescriptionToPlainText } from './eve-description.js'

const esi = createCorporationClient({ fetch: esiFetch }).withMetadata()
const universe = createUniverseClient({ fetch: esiFetch }).withMetadata()

interface CacheEntry<Data> {
  expiresAt: number
  data: Data
}

const corporationCache = new Map<number, CacheEntry<CorporationPublic>>()
const allianceHistoryCache = new Map<number, CacheEntry<AllianceHistoryEntry[]>>()
const notFoundCache = new Map<number, number>()
const npcCache = new Map<string, CacheEntry<number[]>>()
const corporationRequests = new Map<number, Promise<CorporationPublic>>()
const allianceHistoryRequests = new Map<number, Promise<AllianceHistoryEntry[]>>()
let npcRequest: Promise<number[]> | undefined
// Sized relative to the per-resource cache budget: corporations are shared across characters, and
// negative lookups are a single timestamp each, so both hold more entries than a character cache.
const maxCorporationCacheEntries = env.ESI_CACHE_MAX_ENTRIES * 2
const maxNotFoundCacheEntries = env.ESI_CACHE_MAX_ENTRIES * 5
let esiCooldownUntil = 0

interface CorporationPublic {
  corporationId: number
  name: string
  ticker: string
  memberCount: number
  ceoId: number | null
  ceoName: string | null
  creatorId: number | null
  creatorName: string | null
  taxRate: number | null
  dateFounded: string | null
  description: string | null
  url: string | null
  factionId: number | null
  homeStationId: number | null
  homeStationName: string | null
  shares: number | null
  allianceId: number | null
  allianceName: string | null
  type: string
  state: string
  warEligible: boolean | null
  warHistory: Array<{ time: string; againstId: number; againstType: string }>
}

interface AllianceHistoryEntry {
  allianceId: number | null
  allianceName: string | null
  isDeleted: boolean
  recordId: number
  startDate: string
}

class CorporationNotFoundError extends Error {
  status = 404
}

export class CorporationEsiCooldownError extends Error {
  status = 429

  constructor(readonly retryAfterSeconds: number) {
    super('ESI corporation data is temporarily rate limited')
  }
}

export async function getCorporationPublic(corporationId: number): Promise<CorporationPublic> {
  const cached = corporationCache.get(corporationId)
  if (cached && cached.expiresAt > Date.now()) return cached.data
  throwIfCorporationNotFound(corporationId)

  const pending = corporationRequests.get(corporationId)
  if (pending) return pending
  throwIfEsiCoolingDown()

  const request = loadCorporationPublic(corporationId).finally(() => {
    corporationRequests.delete(corporationId)
  })
  corporationRequests.set(corporationId, request)
  return request
}

async function loadCorporationPublic(corporationId: number): Promise<CorporationPublic> {
  let corporation: Awaited<ReturnType<typeof esi.getPublicInfo>>['data']
  let metadata: EsiResponseMetadata
  try {
    const response = await esi.getPublicInfo(corporationId)
    applyEsiCooldown(response.meta)
    corporation = response.data
    metadata = response.meta
  } catch (error) {
    const cooldownSeconds = applyEsiCooldown(error)
    cacheNotFoundCorporation(corporationId, error)
    if (errorStatus(error) === 429)
      throw new CorporationEsiCooldownError(cooldownSeconds ?? esiCooldownFallbackSeconds)
    throw error
  }

  const ceoId = corporation.ceo_id ?? null
  const creatorId = corporation.creator_id ?? null
  const allianceId = corporation.alliance_id ?? null
  const homeStationId = corporation.home_station_id ?? null

  const idsToResolve = [
    ...new Set(
      [ceoId, creatorId, allianceId, homeStationId].filter((id): id is number => id !== null),
    ),
  ]
  const names = idsToResolve.length ? await resolveNames(idsToResolve) : new Map<number, string>()

  const data: CorporationPublic = {
    corporationId,
    name: corporation.name,
    ticker: corporation.ticker,
    memberCount: corporation.member_count,
    ceoId,
    ceoName: ceoId ? (names.get(ceoId) ?? null) : null,
    creatorId,
    creatorName: creatorId ? (names.get(creatorId) ?? null) : null,
    taxRate: corporation.tax_rates?.isk ?? null,
    dateFounded: corporation.date_founded ?? null,
    description: eveDescriptionToPlainText(corporation.description) ?? null,
    url: corporation.url ?? null,
    factionId: corporation.enlisted_faction_id ?? null,
    homeStationId,
    homeStationName: homeStationId ? (names.get(homeStationId) ?? null) : null,
    shares: corporation.shares ?? null,
    allianceId,
    allianceName: allianceId ? (names.get(allianceId) ?? null) : null,
    type: corporation.type ?? 'unknown',
    state: corporation.state ?? 'unknown',
    warEligible: corporation.war_eligible ?? null,
    warHistory: [],
  }

  setBoundedCache(
    corporationCache,
    corporationId,
    data,
    resolveExpiry(metadata, publicProfileCacheTtlMs),
  )
  return data
}

export async function getCorporationAllianceHistory(
  corporationId: number,
): Promise<AllianceHistoryEntry[]> {
  const cached = allianceHistoryCache.get(corporationId)
  if (cached && cached.expiresAt > Date.now()) return cached.data
  throwIfCorporationNotFound(corporationId)

  const pending = allianceHistoryRequests.get(corporationId)
  if (pending) return pending
  throwIfEsiCoolingDown()

  const request = loadCorporationAllianceHistory(corporationId).finally(() => {
    allianceHistoryRequests.delete(corporationId)
  })
  allianceHistoryRequests.set(corporationId, request)
  return request
}

async function loadCorporationAllianceHistory(
  corporationId: number,
): Promise<AllianceHistoryEntry[]> {
  let history: Awaited<ReturnType<typeof esi.listAllianceHistory>>['data']
  let metadata: EsiResponseMetadata
  try {
    const response = await esi.listAllianceHistory(corporationId)
    applyEsiCooldown(response.meta)
    history = response.data
    metadata = response.meta
  } catch (error) {
    const cooldownSeconds = applyEsiCooldown(error)
    cacheNotFoundCorporation(corporationId, error)
    if (errorStatus(error) === 429)
      throw new CorporationEsiCooldownError(cooldownSeconds ?? esiCooldownFallbackSeconds)
    throw error
  }

  const allianceIds = [
    ...new Set(
      history
        .map((e) => e.alliance_id)
        .filter((id): id is number => id !== null && id !== undefined),
    ),
  ]
  const names = allianceIds.length ? await resolveNames(allianceIds) : new Map<number, string>()
  const data = history.map((entry) => ({
    allianceId: entry.alliance_id ?? null,
    allianceName: entry.alliance_id ? (names.get(entry.alliance_id) ?? null) : null,
    isDeleted: entry.is_deleted ?? false,
    recordId: entry.record_id,
    startDate: entry.start_date,
  }))
  setBoundedCache(
    allianceHistoryCache,
    corporationId,
    data,
    resolveExpiry(metadata, publicProfileCacheTtlMs),
  )
  return data
}

export async function getNpcCorporations(): Promise<number[]> {
  const key = 'npc'
  const cached = npcCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.data
  if (npcRequest) return npcRequest
  throwIfEsiCoolingDown()

  npcRequest = esi
    .listNpcCorporations()
    .then((response) => {
      applyEsiCooldown(response.meta)
      const npcIds = response.data
      setBoundedCache(
        npcCache,
        key,
        npcIds,
        resolveExpiry(response.meta, npcCorporationCacheTtlMs),
        10,
      )
      return npcIds
    })
    .catch((error: unknown) => {
      const cooldownSeconds = applyEsiCooldown(error)
      if (errorStatus(error) === 429)
        throw new CorporationEsiCooldownError(cooldownSeconds ?? esiCooldownFallbackSeconds)
      throw error
    })
    .finally(() => {
      npcRequest = undefined
    })
  return npcRequest
}

const MAX_NAME_RESOLUTION_SPLITS = 64

async function resolveNames(ids: number[]): Promise<Map<number, string>> {
  const names = new Map<number, string>()
  let splits = 0

  async function resolveChunk(chunk: number[]): Promise<void> {
    try {
      const response = await universe.resolveNames({ body: chunk })
      applyEsiCooldown(response.meta)
      for (const entry of response.data) names.set(entry.id, entry.name)
    } catch (error) {
      applyEsiCooldown(error)
      // ESI returns 404 when a batch contains an invalid historical ID. Retrying
      // other failures would amplify outages and consume the shared error budget.
      if (errorStatus(error) !== 404 || chunk.length === 1 || splits >= MAX_NAME_RESOLUTION_SPLITS)
        return
      splits += 1
      const mid = Math.ceil(chunk.length / 2)
      await Promise.all([resolveChunk(chunk.slice(0, mid)), resolveChunk(chunk.slice(mid))])
    }
  }

  const chunks = Array.from({ length: Math.ceil(ids.length / 500) }, (_, i) =>
    ids.slice(i * 500, (i + 1) * 500),
  )
  await Promise.all(chunks.map(resolveChunk))
  return names
}

function throwIfCorporationNotFound(corporationId: number): void {
  const expiresAt = notFoundCache.get(corporationId)
  if (expiresAt === undefined) return
  if (expiresAt > Date.now()) throw new CorporationNotFoundError('Corporation not found.')
  notFoundCache.delete(corporationId)
}

function cacheNotFoundCorporation(corporationId: number, error: unknown): void {
  const status = errorStatus(error)
  if (status !== 404 && status !== 422) return
  if (notFoundCache.size >= maxNotFoundCacheEntries) {
    const oldest = notFoundCache.keys().next().value
    if (oldest !== undefined) notFoundCache.delete(oldest)
  }
  notFoundCache.set(corporationId, Date.now() + notFoundCacheTtlMs)
}

function throwIfEsiCoolingDown(): void {
  if (esiCooldownUntil <= Date.now()) return
  throw new CorporationEsiCooldownError(
    Math.max(1, Math.ceil((esiCooldownUntil - Date.now()) / 1_000)),
  )
}

function applyEsiCooldown(value: unknown): number | undefined {
  const metadata = getEsiMetadata(value)
  const status = errorStatus(value)
  let cooldownSeconds: number | undefined

  if (status === 429) {
    cooldownSeconds = parseNumber(metadata?.headers['retry-after']) ?? esiCooldownFallbackSeconds
  } else if (
    metadata?.errorLimit?.remaining !== undefined &&
    metadata.errorLimit.remaining <= esiErrorBudgetFloor
  ) {
    cooldownSeconds = metadata.errorLimit.reset ?? esiCooldownFallbackSeconds
  }

  if (cooldownSeconds !== undefined) {
    esiCooldownUntil = Math.max(esiCooldownUntil, Date.now() + cooldownSeconds * 1_000)
  }
  return cooldownSeconds
}

function setBoundedCache<Key, Data>(
  cache: Map<Key, CacheEntry<Data>>,
  key: Key,
  data: Data,
  expiresAt: number,
  maxEntries = maxCorporationCacheEntries,
): void {
  cache.delete(key)
  cache.set(key, { data, expiresAt })
  if (cache.size > maxEntries) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}

function errorStatus(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status: unknown }).status)
    : undefined
}

function getEsiMetadata(value: unknown): EsiResponseMetadata | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  if ('headers' in value && 'status' in value) return value as EsiResponseMetadata
  if ('meta' in value) return value.meta as EsiResponseMetadata
  if ('metadata' in value) return value.metadata as EsiResponseMetadata
  return undefined
}

function resolveExpiry(metadata: EsiResponseMetadata, fallbackTtlMs: number): number {
  const expires = metadata.cache?.expires ? Date.parse(metadata.cache.expires) : Number.NaN
  if (Number.isFinite(expires) && expires > Date.now()) return expires

  const maxAge = metadata.cache?.cacheControl?.match(/max-age=(\d+)/i)?.[1]
  if (maxAge) {
    const seconds = Number(maxAge)
    if (Number.isSafeInteger(seconds) && seconds >= 0) return Date.now() + seconds * 1_000
  }
  return Date.now() + fallbackTtlMs
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
