import type { Redis } from 'ioredis'
import { createCacheRedisConnection, closeCacheRedisConnection } from './cache-redis.js'
import { esiOperationCatalog, type EsiOperation, type EsiOperationContract } from './catalog.js'
import { getSharedEsiCooldownStatus, type EsiCooldownStatus } from './cooldowns.js'
import { closeQueueRedisConnection, createProbeRedisConnection } from '../queue/redis.js'

const upstreamTelemetryPrefix = 'eve-space:v1:esi-resilience:telemetry:upstream'
const upstreamTelemetryTtlMs = 86_400_000
const unavailableAfterConsecutiveFailures = 3

type UpstreamOutcome = 'success' | 'notModified' | 'rateLimited' | 'clientError' | 'serverError'
type DependencyState = 'operational' | 'degraded' | 'unavailable'
type CacheSource = 'esi' | 'cache' | 'not-modified'

const cacheSourceCounts = new Map<EsiOperation, Record<CacheSource, number> & { stale: number }>()

interface EsiDependencyTelemetry {
  status: DependencyState
  checkedAt: string
  operationFailures?: number
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
  outcomes: Record<UpstreamOutcome, number>
  checkedAt: string | null
}

export interface EsiResilienceTelemetry {
  checkedAt: string
  cache: EsiDependencyTelemetry
  coordination: EsiDependencyTelemetry
  cooldown: EsiCooldownStatus
  upstream: {
    status: 'operational' | 'unavailable'
    checkedAt: string
    operations: EsiUpstreamOperationTelemetry[]
  }
}

const failures = { cache: 0, coordination: 0 }
let coordinationOperationFailures = 0

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

export function recordEsiCoordinationFailure() {
  coordinationOperationFailures += 1
}

export async function recordEsiUpstreamOutcome(
  connection: Redis,
  operation: EsiOperation,
  status: number,
  observedRateGroup?: string | null,
) {
  const outcome = classifyUpstreamOutcome(status)
  const key = `${upstreamTelemetryPrefix}:${operation}`
  const declaredRateGroup = getDeclaredRateGroup(esiOperationCatalog[operation])
  const transaction = connection
    .multi()
    .hincrby(key, outcome, 1)
    .hset(key, 'checkedAt', new Date().toISOString())
  if (observedRateGroup) transaction.hset(key, 'observedRateGroup', observedRateGroup)
  if (declaredRateGroup && observedRateGroup && declaredRateGroup !== observedRateGroup)
    transaction.hincrby(key, 'rateGroupMismatches', 1)
  await transaction.pexpire(key, upstreamTelemetryTtlMs).exec()
}

export async function probeEsiResilienceTelemetry(
  dependencies: {
    probeCache?: () => Promise<boolean>
    probeCoordination?: () => Promise<boolean>
    cacheConnection?: Redis
    coordinationConnection?: Redis
  } = {},
): Promise<EsiResilienceTelemetry> {
  const checkedAt = new Date().toISOString()
  const [cacheAvailable, coordinationAvailable] = await Promise.all([
    (dependencies.probeCache ?? probeCache)(),
    (dependencies.probeCoordination ?? probeCoordination)(),
  ])
  let cache = dependencyTelemetry('cache', cacheAvailable, checkedAt)
  let coordination = coordinationTelemetry(coordinationAvailable, checkedAt)
  const cacheConnection =
    cacheAvailable && !dependencies.cacheConnection ? createCacheRedisConnection() : undefined
  const coordinationConnection =
    coordinationAvailable && !dependencies.coordinationConnection
      ? createProbeRedisConnection()
      : undefined
  const cooldownPending = coordinationAvailable
    ? getSharedEsiCooldownStatus(dependencies.coordinationConnection ?? coordinationConnection!)
    : Promise.reject(new Error('Coordination unavailable'))
  const upstreamPending = cacheAvailable
    ? readUpstreamOperations(dependencies.cacheConnection ?? cacheConnection!)
    : Promise.reject(new Error('Cache unavailable'))
  try {
    const [cooldownResult, upstreamResult] = await Promise.allSettled([
      cooldownPending,
      upstreamPending,
    ])
    if (coordinationAvailable && cooldownResult.status === 'rejected')
      coordination = coordinationTelemetry(false, checkedAt)
    if (cacheAvailable && upstreamResult.status === 'rejected')
      cache = dependencyTelemetry('cache', false, checkedAt)
    return {
      checkedAt,
      cache,
      coordination,
      cooldown:
        cooldownResult.status === 'fulfilled'
          ? cooldownResult.value
          : { status: 'unavailable', checkedAt, globalRetryAt: null, activeOperations: [] },
      upstream:
        upstreamResult.status === 'fulfilled'
          ? { status: 'operational', checkedAt, operations: upstreamResult.value }
          : { status: 'unavailable', checkedAt, operations: emptyUpstreamOperations() },
    }
  } finally {
    await Promise.all([
      cacheConnection ? closeCacheRedisConnection(cacheConnection).catch(() => {}) : undefined,
      coordinationConnection
        ? closeQueueRedisConnection(coordinationConnection).catch(() => {})
        : undefined,
    ])
  }
}

async function probeCache() {
  const connection = createCacheRedisConnection()
  try {
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
        [operation, await connection.hgetall(`${upstreamTelemetryPrefix}:${operation}`)] as const,
    ),
  )
  return values.map(([operation, value]) => ({
    operation,
    policy: operationPolicy(esiOperationCatalog[operation]),
    outcomes: {
      success: asCount(value.success),
      notModified: asCount(value.notModified),
      rateLimited: asCount(value.rateLimited),
      clientError: asCount(value.clientError),
      serverError: asCount(value.serverError),
    },
    observedRateGroup: value.observedRateGroup || null,
    rateGroupMismatches: asCount(value.rateGroupMismatches),
    cacheSources: getCacheSourceCounts(operation),
    checkedAt: parseTimestamp(value.checkedAt),
  }))
}

function emptyUpstreamOperations() {
  return (Object.keys(esiOperationCatalog) as EsiOperation[]).map((operation) => ({
    operation,
    policy: operationPolicy(esiOperationCatalog[operation]),
    outcomes: { success: 0, notModified: 0, rateLimited: 0, clientError: 0, serverError: 0 },
    observedRateGroup: null,
    rateGroupMismatches: 0,
    cacheSources: getCacheSourceCounts(operation),
    checkedAt: null,
  }))
}

function dependencyTelemetry(
  dependency: keyof typeof failures,
  available: boolean,
  checkedAt: string,
) {
  if (available) failures[dependency] = 0
  else failures[dependency] += 1
  return {
    status: available
      ? ('operational' as const)
      : failures[dependency] >= unavailableAfterConsecutiveFailures
        ? ('unavailable' as const)
        : ('degraded' as const),
    checkedAt,
  }
}

function coordinationTelemetry(available: boolean, checkedAt: string) {
  return {
    ...dependencyTelemetry('coordination', available, checkedAt),
    operationFailures: coordinationOperationFailures,
  }
}

function operationPolicy(policy: EsiOperationContract): EsiUpstreamOperationTelemetry['policy'] {
  return {
    authorization: policy.authorization.kind,
    cache: policy.cache.kind,
    freshness: policy.freshness.kind,
    rateGroup: policy.rateGroup.kind,
    declaredRateGroup: getDeclaredRateGroup(policy),
  }
}

function getDeclaredRateGroup(policy: EsiOperationContract) {
  return policy.rateGroup.kind === 'declared' ? policy.rateGroup.group : null
}

function getCacheSourceCounts(operation: EsiOperation) {
  return {
    esi: cacheSourceCounts.get(operation)?.esi ?? 0,
    cache: cacheSourceCounts.get(operation)?.cache ?? 0,
    'not-modified': cacheSourceCounts.get(operation)?.['not-modified'] ?? 0,
    stale: cacheSourceCounts.get(operation)?.stale ?? 0,
  }
}

function classifyUpstreamOutcome(status: number): UpstreamOutcome {
  if (status >= 200 && status < 300) return 'success'
  if (status === 304) return 'notModified'
  if (status === 429) return 'rateLimited'
  if (status >= 400 && status < 500) return 'clientError'
  return 'serverError'
}

function asCount(value: string | undefined) {
  const count = Number(value)
  return Number.isSafeInteger(count) && count >= 0 ? count : 0
}

function parseTimestamp(value: string | undefined) {
  return value && !Number.isNaN(Date.parse(value)) ? value : null
}
