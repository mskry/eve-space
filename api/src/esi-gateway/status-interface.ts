import {
  closeSharedCacheRedisConnection,
  getSharedCacheRedisConnection,
  waitForCacheRedisConnection,
} from '../cache-redis.js'
import { esiErrorBudgetFloor } from './internal/policy.js'
import { readEsiRateMeasurement } from './internal/rate-measurement.js'
import { probeEsiResilienceTelemetry } from './internal/telemetry.js'
import type { EsiStatusTelemetry, EsiUpstreamObservation } from './internal/telemetry.js'

export type { EsiStatusTelemetry, EsiUpstreamObservation } from './internal/telemetry.js'

export function isEsiErrorBudgetAtFloor(remaining: number | null) {
  return remaining !== null && remaining <= esiErrorBudgetFloor
}

export interface EsiCallRateReport {
  readonly bucketStartedAt: string
  readonly bucketEndedAt: string
  readonly complete: boolean
  readonly operations: readonly {
    readonly operation: string
    readonly group: string
    readonly scope: 'public' | 'character'
    readonly requests: number
    readonly weightedTokens: number
    readonly distinctCharacters: number | null
    readonly averageRequestsPerCharacter: number | null
    readonly averageWeightedTokensPerCharacter: number | null
    readonly capacityUsedPercent: number
  }[]
  readonly groups: readonly {
    readonly group: string
    readonly scope: 'public' | 'character'
    readonly maximumTokens: number
    readonly window: string
    readonly requests: number
    readonly weightedTokens: number
    readonly distinctCharacters: number | null
    readonly averageWeightedTokensPerCharacter: number | null
    readonly capacityUsedPercent: number
  }[]
}

export async function probeEsiStatus(
  upstreamObservation: EsiUpstreamObservation | PromiseLike<EsiUpstreamObservation>,
): Promise<EsiStatusTelemetry> {
  const telemetry = await probeEsiResilienceTelemetry(upstreamObservation)
  return {
    checkedAt: telemetry.checkedAt,
    cache: {
      status: telemetry.cache.status,
      checkedAt: telemetry.cache.checkedAt,
      connectionErrors: { ...telemetry.cache.connectionErrors },
      envelopeRejections: { ...telemetry.cache.envelopeRejections },
      envelopeVersionMismatches: {
        expected: telemetry.cache.envelopeVersionMismatches.expected,
        found: { ...telemetry.cache.envelopeVersionMismatches.found },
        overflow: telemetry.cache.envelopeVersionMismatches.overflow,
      },
    },
    coordination: {
      status: telemetry.coordination.status,
      checkedAt: telemetry.coordination.checkedAt,
      ...(telemetry.coordination.operationFailures === undefined
        ? {}
        : { operationFailures: telemetry.coordination.operationFailures }),
    },
    cooldown: {
      status: telemetry.cooldown.status,
      checkedAt: telemetry.cooldown.checkedAt,
      globalRetryAt: telemetry.cooldown.globalRetryAt,
      activeOperations: telemetry.cooldown.activeOperations.map(({ operation, retryAt }) => ({
        operation,
        retryAt,
      })),
    },
    upstream: {
      status: telemetry.upstream.status,
      checkedAt: telemetry.upstream.checkedAt,
      operations: telemetry.upstream.operations.map((operation) => ({
        operation: operation.operation,
        policy: { ...operation.policy },
        observedRateGroup: operation.observedRateGroup,
        rateGroupMismatches: operation.rateGroupMismatches,
        cacheSources: { ...operation.cacheSources },
        outcomes: { ...operation.outcomes },
        checkedAt: operation.checkedAt,
      })),
    },
  }
}

export async function readEsiCallRateReport(windowOffset = 1): Promise<EsiCallRateReport> {
  const connection = getSharedCacheRedisConnection()
  try {
    await waitForCacheRedisConnection(connection)
    const measurement = await readEsiRateMeasurement(connection, { windowOffset })
    return {
      bucketStartedAt: measurement.bucketStartedAt,
      bucketEndedAt: measurement.bucketEndedAt,
      complete: measurement.complete,
      operations: measurement.operations.map((operation) => ({
        operation: operation.operation,
        group: operation.group,
        scope: operation.scope,
        requests: operation.requests,
        weightedTokens: operation.weightedTokens,
        distinctCharacters: operation.distinctCharacters,
        averageRequestsPerCharacter: operation.averageRequestsPerCharacter,
        averageWeightedTokensPerCharacter: operation.averageWeightedTokensPerCharacter,
        capacityUsedPercent: operation.capacityUsedPercent,
      })),
      groups: measurement.groups.map((group) => ({
        group: group.group,
        scope: group.scope,
        maximumTokens: group.maximumTokens,
        window: group.window,
        requests: group.requests,
        weightedTokens: group.weightedTokens,
        distinctCharacters: group.distinctCharacters,
        averageWeightedTokensPerCharacter: group.averageWeightedTokensPerCharacter,
        capacityUsedPercent: group.capacityUsedPercent,
      })),
    }
  } finally {
    await closeSharedCacheRedisConnection()
  }
}
