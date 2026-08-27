import { env } from '../env.js'

/**
 * How many heartbeat intervals may be missed before the worker reads as stale. The Redis key TTL
 * and the `/api/status` staleness window are both derived from it so they cannot drift apart: the
 * key must outlive the interval, and telemetry must not call a worker stale while its key is alive.
 */
const heartbeatToleranceFactor = 4

export const workerHeartbeatIntervalMs = env.WORKER_HEARTBEAT_INTERVAL_MS
export const workerHeartbeatStaleAfterMs = workerHeartbeatIntervalMs * heartbeatToleranceFactor
export const workerHeartbeatTtlSeconds = Math.ceil(workerHeartbeatStaleAfterMs / 1_000)

export const schedulerLockTtlMs = 30_000
export const schedulerLockRenewalMs = 10_000

export const derivedResourcePriorityBand = {
  highest: 1,
  lowest: 2_097_151,
} as const

export function resourceRefreshPriority(materializationIntervalSeconds: number) {
  if (!Number.isSafeInteger(materializationIntervalSeconds) || materializationIntervalSeconds <= 0)
    throw new Error('Resource materialization interval must be a positive safe integer')

  return Math.min(materializationIntervalSeconds, derivedResourcePriorityBand.lowest)
}
