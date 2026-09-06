import type { Redis } from 'ioredis'
import {
  createCacheRedisConnection,
  closeCacheRedisConnection,
  waitForCacheRedisConnection,
} from './cache-redis.js'
import { esiOperationCatalog, type EsiOperation } from './catalog.js'
import { getDeclaredEsiRateLimit } from './catalog-access.js'
import type { EsiOperationContract } from './contract-types.js'
import { getSharedEsiCooldownStatus, type EsiCooldownStatus } from './cooldowns.js'
import type { EsiCacheEnvelopeRejectionReason } from './envelope.js'
import { parseCount } from './numeric.js'
import type { EsiResponseOutcome } from './policy.js'
import type { EsiCachedResult } from './types.js'
import {
  getCacheConnectionErrorCounts,
  getEsiCacheEnvelopeCounterSnapshot,
  getEsiCacheSourceCounts,
  getEsiCoordinationFailureCount,
  getEsiUpstreamTelemetryKey,
  recordEsiDependencyProbe,
  type CacheSource,
  type DependencyState,
} from './telemetry-counters.js'
import { closeQueueRedisConnection, createProbeRedisConnection } from '../queue/redis.js'

interface EsiDependencyTelemetry {
  status: DependencyState
  checkedAt: string
  operationFailures?: number
}

interface EsiCacheDependencyTelemetry extends EsiDependencyTelemetry {
  connectionErrors: Record<string, number>
  envelopeRejections: Record<EsiCacheEnvelopeRejectionReason, number>
  envelopeVersionMismatches: {
    expected: number
    found: Record<string, number>
    overflow: number
  }
}

interface EsiUpstreamOperationTelemetry {
  operation: EsiOperation
  policy: {
    authorization: EsiOperationContract['authorization']['kind']
    cache: EsiOperationContract['cache']['kind']
    freshness: EsiOperationContract['freshness']['kind']
    rateGroup: EsiOperationContract['rateGroup']['kind']
    declaredRateGroup: string | null
  }
  observedRateGroup: string | null
  rateGroupMismatches: number
  cacheSources: Record<CacheSource, number> & { stale: number }
  outcomes: Record<EsiResponseOutcome, number>
  checkedAt: string | null
}

export interface EsiResilienceTelemetry {
  checkedAt: string
  cache: EsiCacheDependencyTelemetry
  coordination: EsiDependencyTelemetry
  cooldown: EsiCooldownStatus
  upstream: {
    status: 'operational' | 'degraded' | 'unavailable'
    checkedAt: string
    operations: EsiUpstreamOperationTelemetry[]
  }
}

export interface EsiUpstreamObservation {
  status: 'operational' | 'degraded' | 'unavailable' | 'stale'
  refreshFailureClass?: EsiCachedResult<unknown>['refreshFailureClass']
}

export async function probeEsiResilienceTelemetry(
  upstreamObservation: EsiUpstreamObservation | PromiseLike<EsiUpstreamObservation>,
  dependencies: {
    probeCache?: () => Promise<boolean>
    probeCoordination?: () => Promise<boolean>
    cacheConnection?: Redis
    coordinationConnection?: Redis
  } = {},
): Promise<EsiResilienceTelemetry> {
  const checkedAt = new Date().toISOString()
  const [resolvedUpstreamObservation, cacheAvailable, coordinationAvailable] = await Promise.all([
    upstreamObservation,
    (dependencies.probeCache ?? probeCache)(),
    (dependencies.probeCoordination ?? probeCoordination)(),
  ])
  let cache = cacheDependencyTelemetry(cacheAvailable, checkedAt)
  let coordination = coordinationTelemetry(coordinationAvailable, checkedAt)
  const cacheConnection = createOwnedConnection(
    cacheAvailable,
    dependencies.cacheConnection,
    createCacheRedisConnection,
  )
  const coordinationConnection = createOwnedConnection(
    coordinationAvailable,
    dependencies.coordinationConnection,
    createProbeRedisConnection,
  )
  const cooldownPending = probeCooldown(
    coordinationAvailable,
    dependencies.coordinationConnection ?? coordinationConnection,
  )
  const upstreamPending = probeUpstreamOperations(
    cacheAvailable,
    dependencies.cacheConnection,
    cacheConnection,
  )
  try {
    const [cooldownResult, upstreamResult] = await Promise.allSettled([
      cooldownPending,
      upstreamPending,
    ])
    if (coordinationAvailable && cooldownResult.status === 'rejected')
      coordination = coordinationTelemetry(false, checkedAt)
    if (cacheAvailable && upstreamResult.status === 'rejected')
      cache = cacheDependencyTelemetry(false, checkedAt)
    const upstreamStatus = getUpstreamStatus(resolvedUpstreamObservation)
    return {
      checkedAt,
      cache,
      coordination,
      cooldown: resolveProbeResult<EsiCooldownStatus, EsiCooldownStatus>(
        cooldownResult,
        (value) => value,
        () => ({ status: 'unavailable', checkedAt, globalRetryAt: null, activeOperations: [] }),
      ),
      upstream: resolveProbeResult<
        EsiUpstreamOperationTelemetry[],
        EsiResilienceTelemetry['upstream']
      >(
        upstreamResult,
        (operations) => ({ status: upstreamStatus, checkedAt, operations }),
        () => ({ status: upstreamStatus, checkedAt, operations: emptyUpstreamOperations() }),
      ),
    }
  } finally {
    await Promise.all([
      closeOwnedConnection(cacheConnection, closeCacheRedisConnection),
      closeOwnedConnection(coordinationConnection, closeQueueRedisConnection),
    ])
  }
}

function getUpstreamStatus(
  observation: EsiUpstreamObservation,
): EsiResilienceTelemetry['upstream']['status'] {
  if (observation.status === 'operational') return 'operational'
  if (
    observation.status === 'unavailable' ||
    (observation.status === 'stale' && observation.refreshFailureClass === 'esi-unavailable')
  )
    return 'unavailable'
  return 'degraded'
}

function createOwnedConnection(
  available: boolean,
  providedConnection: Redis | undefined,
  createConnection: () => Redis,
) {
  if (!available || providedConnection) return undefined
  return createConnection()
}

async function probeCooldown(available: boolean, connection: Redis | undefined) {
  if (!available) throw new Error('Coordination unavailable')
  return getSharedEsiCooldownStatus(connection!)
}

async function probeUpstreamOperations(
  available: boolean,
  providedConnection: Redis | undefined,
  ownedConnection: Redis | undefined,
) {
  if (!available) throw new Error('Cache unavailable')
  if (ownedConnection) await waitForCacheRedisConnection(ownedConnection)
  return readUpstreamOperations(providedConnection ?? ownedConnection!)
}

function resolveProbeResult<Value, Result>(
  result: PromiseSettledResult<Value>,
  fulfilled: (value: Value) => Result,
  rejected: () => Result,
) {
  if (result.status === 'fulfilled') return fulfilled(result.value)
  return rejected()
}

function closeOwnedConnection(
  connection: Redis | undefined,
  closeConnection: (connection: Redis) => Promise<void>,
) {
  if (!connection) return undefined
  return closeConnection(connection).catch(() => {})
}

async function probeCache() {
  const connection = createCacheRedisConnection()
  try {
    await waitForCacheRedisConnection(connection)
    await connection.ping()
    return true
  } catch {
    return false
  } finally {
    await closeCacheRedisConnection(connection)
  }
}

async function probeCoordination() {
  const connection = createProbeRedisConnection()
  try {
    await connection.ping()
    return true
  } catch {
    return false
  } finally {
    await closeQueueRedisConnection(connection)
  }
}

async function readUpstreamOperations(connection: Redis) {
  const operations = Object.keys(esiOperationCatalog) as EsiOperation[]
  const values = await Promise.all(
    operations.map(
      async (operation) =>
        [operation, await connection.hgetall(getEsiUpstreamTelemetryKey(operation))] as const,
    ),
  )
  return values.map(([operation, value]) => ({
    operation,
    policy: operationPolicy(esiOperationCatalog[operation]),
    outcomes: {
      success: parseCount(value.success),
      notModified: parseCount(value.notModified),
      redirect: parseCount(value.redirect),
      rateLimited: parseCount(value.rateLimited),
      clientError: parseCount(value.clientError),
      serverError: parseCount(value.serverError),
    },
    observedRateGroup: value.observedRateGroup || null,
    rateGroupMismatches: parseCount(value.rateGroupMismatches),
    cacheSources: getEsiCacheSourceCounts(operation),
    checkedAt: parseTimestamp(value.checkedAt),
  }))
}

function emptyUpstreamOperations() {
  return (Object.keys(esiOperationCatalog) as EsiOperation[]).map((operation) => ({
    operation,
    policy: operationPolicy(esiOperationCatalog[operation]),
    outcomes: {
      success: 0,
      notModified: 0,
      redirect: 0,
      rateLimited: 0,
      clientError: 0,
      serverError: 0,
    },
    observedRateGroup: null,
    rateGroupMismatches: 0,
    cacheSources: getEsiCacheSourceCounts(operation),
    checkedAt: null,
  }))
}

function cacheDependencyTelemetry(
  available: boolean,
  checkedAt: string,
): EsiCacheDependencyTelemetry {
  const counters = getEsiCacheEnvelopeCounterSnapshot()
  return {
    status: recordEsiDependencyProbe('cache', available),
    checkedAt,
    connectionErrors: getCacheConnectionErrorCounts(),
    envelopeRejections: counters.rejections,
    envelopeVersionMismatches: counters.versionMismatches,
  }
}

function coordinationTelemetry(available: boolean, checkedAt: string) {
  return {
    status: recordEsiDependencyProbe('coordination', available),
    checkedAt,
    operationFailures: getEsiCoordinationFailureCount(),
  }
}

function operationPolicy(policy: EsiOperationContract): EsiUpstreamOperationTelemetry['policy'] {
  return {
    authorization: policy.authorization.kind,
    cache: policy.cache.kind,
    freshness: policy.freshness.kind,
    rateGroup: policy.rateGroup.kind,
    declaredRateGroup: getDeclaredEsiRateLimit(policy)?.group ?? null,
  }
}

function parseTimestamp(value: string | undefined) {
  return value && !Number.isNaN(Date.parse(value)) ? value : null
}
