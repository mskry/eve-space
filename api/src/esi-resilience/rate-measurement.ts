import { createHash } from 'node:crypto'
import type { Redis } from 'ioredis'
import { esiOperationCatalog, esiOperations, type EsiOperation } from './catalog.js'

const keyPrefix = 'eve-space:v1:esi-resilience:telemetry:rate-window'
export const esiRateMeasurementWindowMs = 15 * 60_000
const measurementRetentionMs = 24 * 60 * 60_000
type EsiRateMeasurementScope = 'public' | 'character'

export interface EsiRateMeasurement {
  bucketStartedAt: string
  bucketEndedAt: string
  complete: boolean
  operations: Array<{
    operation: EsiOperation
    group: string
    scope: EsiRateMeasurementScope
    requests: number
    weightedTokens: number
    distinctCharacters: number | null
    averageRequestsPerCharacter: number | null
    averageWeightedTokensPerCharacter: number | null
    capacityUsedPercent: number
  }>
  groups: Array<{
    group: string
    scope: EsiRateMeasurementScope
    maximumTokens: number
    window: string
    requests: number
    weightedTokens: number
    distinctCharacters: number | null
    averageWeightedTokensPerCharacter: number | null
    capacityUsedPercent: number
  }>
}

export async function recordEsiRateMeasurement(
  connection: Redis,
  options: {
    operation: EsiOperation
    principal?: string
    status: number
    now?: number
  },
) {
  const contract = esiOperationCatalog[options.operation]
  if (contract.rateGroup.kind !== 'declared') return
  const scope = contract.authorization.kind === 'character' ? 'character' : 'public'
  if (scope === 'character' && !options.principal) return

  const now = options.now ?? Date.now()
  const bucketStart = toBucketStart(now)
  const expiresAt = bucketStart + esiRateMeasurementWindowMs + measurementRetentionMs
  const principalHash =
    scope === 'character'
      ? createHash('sha256').update(options.principal!).digest('hex')
      : undefined
  const weightedTokens = responseTokenCost(options.status)
  const operationKey = measurementKey('operation', options.operation, bucketStart)
  const groupKey = measurementKey('group', contract.rateGroup.group, bucketStart)
  const transaction = connection.multi()

  for (const key of [operationKey, groupKey]) {
    transaction.hincrby(key, 'requests', 1)
    transaction.hincrby(key, 'weightedTokens', weightedTokens)
    transaction.pexpireat(key, expiresAt)
    if (principalHash) {
      transaction.pfadd(`${key}:characters`, principalHash)
      transaction.pexpireat(`${key}:characters`, expiresAt)
    }
  }

  await transaction.exec()
}

export async function readEsiRateMeasurement(
  connection: Redis,
  options: { now?: number; windowOffset?: number } = {},
): Promise<EsiRateMeasurement> {
  const now = options.now ?? Date.now()
  const windowOffset = options.windowOffset ?? 1
  if (!Number.isSafeInteger(windowOffset) || windowOffset < 0)
    throw new Error('ESI rate measurement window offset must be a non-negative integer')

  const bucketStart = toBucketStart(now) - windowOffset * esiRateMeasurementWindowMs
  const operationContracts = esiOperations.flatMap((operation) => {
    const contract = esiOperationCatalog[operation]
    return contract.rateGroup.kind === 'declared'
      ? [
          {
            operation,
            rateLimit: contract.rateGroup,
            scope:
              contract.authorization.kind === 'character'
                ? ('character' as const)
                : ('public' as const),
          },
        ]
      : []
  })
  const operations = await Promise.all(
    operationContracts.map(async ({ operation, rateLimit, scope }) => {
      const counts = await readCounts(
        connection,
        measurementKey('operation', operation, bucketStart),
        scope,
      )
      const averageRequestsPerCharacter = characterAverage(
        counts.requests,
        counts.distinctCharacters,
      )
      const averageWeightedTokensPerCharacter = characterAverage(
        counts.weightedTokens,
        counts.distinctCharacters,
      )
      return {
        operation,
        group: rateLimit.group,
        scope,
        requests: counts.requests,
        weightedTokens: counts.weightedTokens,
        distinctCharacters: counts.distinctCharacters,
        averageRequestsPerCharacter,
        averageWeightedTokensPerCharacter,
        capacityUsedPercent: percentage(
          scope === 'character' ? (averageWeightedTokensPerCharacter ?? 0) : counts.weightedTokens,
          rateLimit.maximumTokens,
        ),
      }
    }),
  )
  const groupContracts = new Map<
    string,
    { maximumTokens: number; window: string; scope: EsiRateMeasurementScope }
  >()
  for (const { rateLimit, scope } of operationContracts) {
    const current = groupContracts.get(rateLimit.group)
    if (
      current &&
      (current.maximumTokens !== rateLimit.maximumTokens ||
        current.window !== rateLimit.window ||
        current.scope !== scope)
    )
      throw new Error(`Inconsistent ESI rate-limit metadata for group: ${rateLimit.group}`)
    groupContracts.set(rateLimit.group, { ...rateLimit, scope })
  }
  const groups = await Promise.all(
    [...groupContracts].map(async ([group, contract]) => {
      const counts = await readCounts(
        connection,
        measurementKey('group', group, bucketStart),
        contract.scope,
      )
      const averageWeightedTokensPerCharacter = characterAverage(
        counts.weightedTokens,
        counts.distinctCharacters,
      )
      return {
        group,
        scope: contract.scope,
        maximumTokens: contract.maximumTokens,
        window: contract.window,
        requests: counts.requests,
        weightedTokens: counts.weightedTokens,
        distinctCharacters: counts.distinctCharacters,
        averageWeightedTokensPerCharacter,
        capacityUsedPercent: percentage(
          contract.scope === 'character'
            ? (averageWeightedTokensPerCharacter ?? 0)
            : counts.weightedTokens,
          contract.maximumTokens,
        ),
      }
    }),
  )

  return {
    bucketStartedAt: new Date(bucketStart).toISOString(),
    bucketEndedAt: new Date(bucketStart + esiRateMeasurementWindowMs).toISOString(),
    complete: bucketStart + esiRateMeasurementWindowMs <= now,
    operations,
    groups,
  }
}

function measurementKey(kind: 'operation' | 'group', identity: string, bucketStart: number) {
  return `${keyPrefix}:${kind}:${identity}:${bucketStart}`
}

async function readCounts(connection: Redis, key: string, scope: EsiRateMeasurementScope) {
  const [value, distinctCharacters] = await Promise.all([
    connection.hgetall(key),
    scope === 'character' ? connection.pfcount(`${key}:characters`) : Promise.resolve(null),
  ])
  return {
    requests: asCount(value.requests),
    weightedTokens: asCount(value.weightedTokens),
    distinctCharacters,
  }
}

function toBucketStart(now: number) {
  return Math.floor(now / esiRateMeasurementWindowMs) * esiRateMeasurementWindowMs
}

function responseTokenCost(status: number) {
  if (status >= 200 && status < 300) return 2
  if (status >= 300 && status < 400) return 1
  if (status >= 400 && status < 500 && status !== 429) return 5
  return 0
}

function asCount(value: string | undefined) {
  const count = Number(value)
  return Number.isSafeInteger(count) && count >= 0 ? count : 0
}

function characterAverage(value: number, count: number | null) {
  return count === null ? null : count > 0 ? round(value / count) : 0
}

function percentage(value: number, maximum: number) {
  return round((value / maximum) * 100)
}

function round(value: number) {
  return Math.round(value * 10_000) / 10_000
}
