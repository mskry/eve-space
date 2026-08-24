import type { Redis } from 'ioredis'
import { createCacheRedisConnection, closeCacheRedisConnection } from './cache-redis.js'
import { getSharedEsiCooldownStatus, type EsiCooldownStatus } from './cooldowns.js'
import { esiOperationPolicies, type EsiOperation, type EsiOperationPolicy } from './policy.js'
import { closeQueueRedisConnection, createProbeRedisConnection } from '../queue/redis.js'

const upstreamTelemetryPrefix = 'eve-space:v1:esi-resilience:telemetry:upstream'
const upstreamTelemetryTtlMs = 86_400_000
const unavailableAfterConsecutiveFailures = 3

type UpstreamOutcome = 'success' | 'notModified' | 'rateLimited' | 'clientError' | 'serverError'
type DependencyState = 'operational' | 'degraded' | 'unavailable'

interface EsiDependencyTelemetry {
  status: DependencyState
  checkedAt: string
}

interface EsiUpstreamOperationTelemetry {
  operation: EsiOperation
  policy: Pick<
    EsiOperationPolicy,
    | 'valueCache'
    | 'collapse'
    | 'revalidate'
    | 'upstreamExpiryFallbackMs'
    | 'maximumStaleAgeMs'
    | 'allowStale'
  >
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

export async function recordEsiUpstreamOutcome(
  connection: Redis,
  operation: EsiOperation,
  status: number,
) {
  const outcome = classifyUpstreamOutcome(status)
  const key = `${upstreamTelemetryPrefix}:${operation}`
  await connection
    .multi()
    .hincrby(key, outcome, 1)
    .hset(key, 'checkedAt', new Date().toISOString())
    .pexpire(key, upstreamTelemetryTtlMs)
    .exec()
}

export async function probeEsiResilienceTelemetry(
  dependencies: {
    probeCache?: () => Promise<boolean>
    probeCoordination?: () => Promise<boolean>
    connection?: Redis
  } = {},
): Promise<EsiResilienceTelemetry> {
  const checkedAt = new Date().toISOString()
  const [cacheAvailable, coordinationAvailable] = await Promise.all([
    (dependencies.probeCache ?? probeCache)(),
    (dependencies.probeCoordination ?? probeCoordination)(),
  ])
  const cache = dependencyTelemetry('cache', cacheAvailable, checkedAt)
  const coordination = dependencyTelemetry('coordination', coordinationAvailable, checkedAt)

  if (!coordinationAvailable) {
    return {
      checkedAt,
      cache,
      coordination,
      cooldown: { status: 'unavailable', checkedAt, globalRetryAt: null, activeOperations: [] },
      upstream: { status: 'unavailable', checkedAt, operations: emptyUpstreamOperations() },
    }
  }

  const connection = dependencies.connection ?? createProbeRedisConnection()
  try {
    const [cooldown, operations] = await Promise.all([
      getSharedEsiCooldownStatus(connection),
      readUpstreamOperations(connection),
    ])
    return {
      checkedAt,
      cache,
      coordination,
      cooldown,
      upstream: { status: 'operational', checkedAt, operations },
    }
  } catch {
    return {
      checkedAt,
      cache,
      coordination: dependencyTelemetry('coordination', false, checkedAt),
      cooldown: { status: 'unavailable', checkedAt, globalRetryAt: null, activeOperations: [] },
      upstream: { status: 'unavailable', checkedAt, operations: emptyUpstreamOperations() },
    }
  } finally {
    if (!dependencies.connection) await closeQueueRedisConnection(connection).catch(() => {})
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
  const operations = Object.keys(esiOperationPolicies) as EsiOperation[]
  const values = await Promise.all(
    operations.map(
      async (operation) =>
        [operation, await connection.hgetall(`${upstreamTelemetryPrefix}:${operation}`)] as const,
    ),
  )
  return values.map(([operation, value]) => ({
    operation,
    policy: cachingPolicy(esiOperationPolicies[operation]),
    outcomes: {
      success: asCount(value.success),
      notModified: asCount(value.notModified),
      rateLimited: asCount(value.rateLimited),
      clientError: asCount(value.clientError),
      serverError: asCount(value.serverError),
    },
    checkedAt: parseTimestamp(value.checkedAt),
  }))
}

function emptyUpstreamOperations() {
  return (Object.keys(esiOperationPolicies) as EsiOperation[]).map((operation) => ({
    operation,
    policy: cachingPolicy(esiOperationPolicies[operation]),
    outcomes: { success: 0, notModified: 0, rateLimited: 0, clientError: 0, serverError: 0 },
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

function cachingPolicy(policy: EsiOperationPolicy): EsiUpstreamOperationTelemetry['policy'] {
  return {
    valueCache: policy.valueCache,
    collapse: policy.collapse,
    revalidate: policy.revalidate,
    upstreamExpiryFallbackMs: policy.upstreamExpiryFallbackMs,
    maximumStaleAgeMs: policy.maximumStaleAgeMs,
    allowStale: policy.allowStale,
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
