import type { Redis } from 'ioredis'
import { getDeclaredEsiRateLimit } from './catalog-access.js'
import { esiOperationCatalog, type EsiOperation } from './catalog.js'
import {
  ESI_CACHE_ENVELOPE_VERSION,
  type EsiCacheEnvelopeParseResult,
  type EsiCacheEnvelopeRejectionReason,
} from './envelope.js'
import { classifyEsiResponse } from './policy.js'

const upstreamTelemetryPrefix = 'eve-space:v1:esi-resilience:telemetry:upstream'
const upstreamTelemetryTtlMs = 86_400_000
const unavailableAfterConsecutiveFailures = 3
const maximumTrackedEnvelopeVersions = 8

export type DependencyState = 'operational' | 'degraded' | 'unavailable'
export type CacheSource = 'esi' | 'cache' | 'not-modified'

const cacheSourceCounts = new Map<EsiOperation, Record<CacheSource, number> & { stale: number }>()
const cacheConnectionErrorCounts = new Map<string, number>()
const dependencyFailures = { cache: 0, coordination: 0 }
let coordinationOperationFailures = 0
const cacheEnvelopeRejections: Record<EsiCacheEnvelopeRejectionReason, number> = {
  malformedJson: 0,
  versionMismatch: 0,
  invalidShape: 0,
  incoherentFreshnessWindow: 0,
}
const foundEnvelopeVersionCounts = new Map<string, number>()
let foundEnvelopeVersionOverflow = 0

export function recordEsiCacheSource(operation: EsiOperation, source: CacheSource, stale: boolean) {
  const counts = cacheSourceCounts.get(operation) ?? {
    esi: 0,
    cache: 0,
    'not-modified': 0,
    stale: 0,
  }
  counts[source] += 1
  if (stale) counts.stale += 1
  cacheSourceCounts.set(operation, counts)
}

export function getEsiCacheSourceCounts(operation: EsiOperation) {
  return {
    esi: cacheSourceCounts.get(operation)?.esi ?? 0,
    cache: cacheSourceCounts.get(operation)?.cache ?? 0,
    'not-modified': cacheSourceCounts.get(operation)?.['not-modified'] ?? 0,
    stale: cacheSourceCounts.get(operation)?.stale ?? 0,
  }
}

export function recordCacheConnectionError(code: string): void {
  cacheConnectionErrorCounts.set(code, (cacheConnectionErrorCounts.get(code) ?? 0) + 1)
}

export function getCacheConnectionErrorCounts(): Record<string, number> {
  return Object.fromEntries(cacheConnectionErrorCounts)
}

export function recordEsiCoordinationFailure() {
  coordinationOperationFailures += 1
}

export function getEsiCoordinationFailureCount() {
  return coordinationOperationFailures
}

export function recordEsiCacheEnvelopeRejection(
  rejection: Extract<EsiCacheEnvelopeParseResult<unknown>, { success: false }>,
) {
  cacheEnvelopeRejections[rejection.reason] += 1
  if (rejection.reason !== 'versionMismatch') return

  const found = envelopeVersionBucket(rejection.found)
  const count = foundEnvelopeVersionCounts.get(found)
  if (count !== undefined) foundEnvelopeVersionCounts.set(found, count + 1)
  else if (foundEnvelopeVersionCounts.size < maximumTrackedEnvelopeVersions)
    foundEnvelopeVersionCounts.set(found, 1)
  else foundEnvelopeVersionOverflow += 1
}

export function getEsiCacheEnvelopeCounterSnapshot() {
  return {
    rejections: { ...cacheEnvelopeRejections },
    versionMismatches: {
      expected: ESI_CACHE_ENVELOPE_VERSION,
      found: Object.fromEntries(foundEnvelopeVersionCounts),
      overflow: foundEnvelopeVersionOverflow,
    },
  }
}

export function recordEsiDependencyProbe(
  dependency: keyof typeof dependencyFailures,
  available: boolean,
): DependencyState {
  if (available) dependencyFailures[dependency] = 0
  else dependencyFailures[dependency] += 1
  if (available) return 'operational'
  return dependencyFailures[dependency] >= unavailableAfterConsecutiveFailures
    ? 'unavailable'
    : 'degraded'
}

export async function recordEsiUpstreamOutcome(
  connection: Redis,
  operation: EsiOperation,
  status: number,
  observedRateGroup?: string | null,
) {
  const { outcome } = classifyEsiResponse(status)
  const key = getEsiUpstreamTelemetryKey(operation)
  const declaredRateGroup = getDeclaredEsiRateLimit(esiOperationCatalog[operation])?.group
  const transaction = connection
    .multi()
    .hincrby(key, outcome, 1)
    .hset(key, 'checkedAt', new Date().toISOString())
  if (observedRateGroup) transaction.hset(key, 'observedRateGroup', observedRateGroup)
  if (declaredRateGroup && observedRateGroup && declaredRateGroup !== observedRateGroup)
    transaction.hincrby(key, 'rateGroupMismatches', 1)
  await transaction.pexpire(key, upstreamTelemetryTtlMs).exec()
}

export function getEsiUpstreamTelemetryKey(operation: EsiOperation) {
  return `${upstreamTelemetryPrefix}:${operation}`
}

function envelopeVersionBucket(found: unknown) {
  if (found === undefined) return 'missing'
  return typeof found === 'number' && Number.isSafeInteger(found) ? String(found) : 'invalid'
}
