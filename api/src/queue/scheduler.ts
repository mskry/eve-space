import { randomInt, randomUUID } from 'node:crypto'
import { defaultRepeatStrategy, type Queue, type RepeatOptions, type RepeatStrategy } from 'bullmq'
import type { QueueRedisConnection } from './redis.js'
import { env } from '../env.js'
import { schedulerLockKey, schedulerOutcomeKey } from './namespaces.js'
import { schedulerLockRenewalMs, schedulerLockTtlMs, workerHeartbeatTtlSeconds } from './policy.js'
import { getJobDefinition, jobOptions, type JobDefinition } from './job-registry.js'

export const diagnosticSchedulerId = 'diagnostic-planner'
export const outboxRelaySchedulerId = 'outbox-relay'
export const eventRetentionSchedulerId = 'domain-event-retention'
export const diagnosticOverlapPolicy = 'skip' as const
export const eventRetentionIntervalMs = 24 * 60 * 60 * 1_000

export function createPlannerRepeatStrategy(
  deploymentOffsetMs: number,
  initialDelayMaximumMs: number,
): RepeatStrategy {
  return async (millis, options, name) => {
    if (options.every) {
      if (options.pattern) throw new Error('Scheduler cannot define both pattern and every')
      return (
        Math.floor(millis / options.every) * options.every +
        (options.immediately ? 0 : options.every)
      )
    }
    const next = await defaultRepeatStrategy(millis, options)
    if (name !== 'planner' || next === undefined) return next

    const following = await defaultRepeatStrategy(next, options)
    if (following !== undefined && next + deploymentOffsetMs + initialDelayMaximumMs >= following) {
      throw new Error(
        'Planner schedule offset and initial delay must fit before its next occurrence',
      )
    }
    return next + deploymentOffsetMs
  }
}

export async function plannerInitialDelay(
  now = Date.now(),
  options: RepeatOptions = { pattern: env.QUEUE_PLANNER_SCHEDULE },
  maximumMs = env.QUEUE_PLANNER_INITIAL_DELAY_MAX_MS,
  sample: (maximumInclusive: number) => number = (maximumInclusive) =>
    randomInt(1, maximumInclusive + 1),
) {
  const next = await defaultRepeatStrategy(now, options)
  if (next === undefined) return 0

  const boundedMaximum = Math.min(maximumMs, Math.max(0, next - now - 1))
  return boundedMaximum > 0 ? sample(boundedMaximum) : 0
}

export async function registerSchedulers(queue: Queue) {
  const planner = getJobDefinition('planner') as JobDefinition<{ operationId: 'queue-planner' }>
  await queue.upsertJobScheduler(diagnosticSchedulerId, schedulerOptions(diagnosticOverlapPolicy), {
    name: planner.name,
    data: { operationId: 'queue-planner' },
    opts: jobOptions(planner),
  })
  const relay = getJobDefinition('outbox-relay') as JobDefinition<{
    operationId: 'outbox-relay'
  }>
  await queue.upsertJobScheduler(
    outboxRelaySchedulerId,
    intervalSchedulerOptions(env.OUTBOX_RELAY_INTERVAL_MS),
    {
      name: relay.name,
      data: { operationId: 'outbox-relay' },
      opts: jobOptions(relay),
    },
  )
  const retention = getJobDefinition('domain-event-retention') as JobDefinition<{
    operationId: 'domain-event-retention'
  }>
  await queue.upsertJobScheduler(
    eventRetentionSchedulerId,
    intervalSchedulerOptions(eventRetentionIntervalMs),
    {
      name: retention.name,
      data: { operationId: 'domain-event-retention' },
      opts: jobOptions(retention),
    },
  )
  await queue
    .getBackend()
    .client.then((connection) =>
      connection.set(schedulerOutcomeKey, 'registered', { EX: workerHeartbeatTtlSeconds }),
    )
}

function schedulerOptions(overlap: typeof diagnosticOverlapPolicy) {
  if (overlap !== 'skip') throw new Error(`Unsupported scheduler overlap policy: ${overlap}`)
  // BullMQ Job Schedulers implement skip overlap by producing the next occurrence only when the
  // preceding scheduled job begins processing.
  return { pattern: env.QUEUE_PLANNER_SCHEDULE }
}

function intervalSchedulerOptions(intervalMs: number) {
  return { every: intervalMs }
}

export function getJobScheduler(jobName: string) {
  if (jobName === 'planner')
    return { schedulerId: diagnosticSchedulerId, overlap: diagnosticOverlapPolicy }
  if (jobName === 'outbox-relay')
    return { schedulerId: outboxRelaySchedulerId, overlap: diagnosticOverlapPolicy }
  if (jobName === 'domain-event-retention')
    return { schedulerId: eventRetentionSchedulerId, overlap: diagnosticOverlapPolicy }
  return undefined
}

export class SchedulerLeaseLostError extends Error {
  constructor(schedulerId: string) {
    super(`Scheduler lease lost for ${schedulerId}`)
  }
}

export async function runWithSchedulerOverlapPolicy<T>(
  connection: QueueRedisConnection,
  schedulerId: string,
  overlap: typeof diagnosticOverlapPolicy,
  operation: (signal: AbortSignal) => Promise<T>,
) {
  if (overlap !== 'skip') throw new Error(`Unsupported scheduler overlap policy: ${overlap}`)
  const key = schedulerLockKey(schedulerId)
  const token = randomUUID()
  const acquired = await connection.set(key, token, 'PX', schedulerLockTtlMs, 'NX')
  if (acquired !== 'OK') return { executed: false as const }

  const lease = new AbortController()
  let held = true
  const loseLease = () => {
    if (!held) return
    held = false
    lease.abort(new SchedulerLeaseLostError(schedulerId))
  }

  // Independent of the renewal round trip: the worker connection retries without limit, so a
  // partitioned renewal stays pending rather than rejecting. Only a confirmed renewal buys a TTL.
  let watchdog: ReturnType<typeof setTimeout> | undefined
  const armLeaseWatchdog = () => {
    clearTimeout(watchdog)
    watchdog = setTimeout(() => {
      console.error('Scheduler overlap lock expired without a confirmed renewal')
      loseLease()
    }, schedulerLockTtlMs)
  }
  armLeaseWatchdog()

  const renewal = setInterval(() => {
    void renewSchedulerLock(connection, key, token).then(
      (renewed) => {
        // 0 means the key is gone or another replica owns it.
        if (renewed !== 1) {
          console.error('Scheduler overlap lock lost')
          return loseLease()
        }
        armLeaseWatchdog()
      },
      () => console.error('Scheduler overlap lock renewal failed'),
    )
  }, schedulerLockRenewalMs)

  try {
    const result = await Promise.race([operation(lease.signal), rejectWhenLeaseLost(lease.signal)])
    // A new owner may have run this concurrently, so it is not this replica's completed run.
    if (!held) throw lease.signal.reason as Error
    return { executed: true as const, result }
  } finally {
    clearInterval(renewal)
    clearTimeout(watchdog)
    if (held)
      await releaseSchedulerLock(connection, key, token).catch(() =>
        console.error('Scheduler overlap lock release failed'),
      )
  }
}

function rejectWhenLeaseLost(signal: AbortSignal) {
  const lost = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason as Error), { once: true })
  })
  // The operation can win the race, leaving this rejection with no other handler.
  lost.catch(() => {})
  return lost
}

function renewSchedulerLock(connection: QueueRedisConnection, key: string, token: string) {
  return connection.eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
    1,
    key,
    token,
    schedulerLockTtlMs,
  )
}

function releaseSchedulerLock(connection: QueueRedisConnection, key: string, token: string) {
  return connection.eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    1,
    key,
    token,
  )
}
