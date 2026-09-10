import { randomInt, randomUUID } from 'node:crypto'
import { defaultRepeatStrategy, type Queue, type RepeatOptions, type RepeatStrategy } from 'bullmq'
import type { CoordinationRedisConnection } from '../coordination-redis.js'
import { env } from '../env.js'
import {
  getJobContract,
  parseJobPayload,
  type JobName,
  type JobPayloadByName,
} from './job-contracts.js'
import { schedulerLockKey, schedulerOutcomeKey } from './namespaces.js'
import { schedulerLockRenewalMs, schedulerLockTtlMs, workerHeartbeatTtlSeconds } from './policy.js'

export const diagnosticSchedulerId = 'diagnostic-planner'
export const outboxRelaySchedulerId = 'outbox-relay'
export const eventRetentionSchedulerId = 'domain-event-retention'
export const diagnosticOverlapPolicy = 'skip' as const
export const eventRetentionIntervalMs = 24 * 60 * 60 * 1_000

type ScheduledJobName = 'planner' | 'outbox-relay' | 'domain-event-retention'

interface SchedulerDeclaration<Name extends ScheduledJobName> {
  readonly schedulerId: string
  readonly name: Name
  readonly payload: JobPayloadByName[Name]
  readonly schedule: () => Omit<RepeatOptions, 'key'>
  readonly overlap: typeof diagnosticOverlapPolicy
}

const schedulerCatalog = [
  scheduler({
    schedulerId: diagnosticSchedulerId,
    name: 'planner',
    payload: { operationId: 'queue-planner' },
    schedule: () => schedulerOptions(diagnosticOverlapPolicy),
    overlap: diagnosticOverlapPolicy,
  }),
  scheduler({
    schedulerId: outboxRelaySchedulerId,
    name: 'outbox-relay',
    payload: { operationId: 'outbox-relay' },
    schedule: () => intervalSchedulerOptions(env.OUTBOX_RELAY_INTERVAL_MS),
    overlap: diagnosticOverlapPolicy,
  }),
  scheduler({
    schedulerId: eventRetentionSchedulerId,
    name: 'domain-event-retention',
    payload: { operationId: 'domain-event-retention' },
    schedule: () => intervalSchedulerOptions(eventRetentionIntervalMs),
    overlap: diagnosticOverlapPolicy,
  }),
] as const

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
    const next = defaultRepeatStrategy(millis, options)
    if (name !== 'planner' || next === undefined) return next

    const following = defaultRepeatStrategy(next, options)
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
  options?: RepeatOptions,
  maximumMs = env.QUEUE_PLANNER_INITIAL_DELAY_MAX_MS,
  sample: (maximumInclusive: number) => number = (maximumInclusive) =>
    randomInt(1, maximumInclusive + 1),
) {
  const next = defaultRepeatStrategy(now, options ?? { pattern: env.QUEUE_PLANNER_SCHEDULE })
  if (next === undefined) return 0

  const boundedMaximum = Math.min(maximumMs, Math.max(0, next - now - 1))
  return boundedMaximum > 0 ? sample(boundedMaximum) : 0
}

export async function registerSchedulers(queue: Queue) {
  for (const declaration of schedulerCatalog)
    // oxlint-disable-next-line no-await-in-loop -- stable registration order is intentional.
    await registerScheduler(queue, declaration)
  await queue
    .getBackend()
    .client.then((connection) =>
      connection.set(schedulerOutcomeKey, 'registered', { EX: workerHeartbeatTtlSeconds }),
    )
    .catch(() => console.error('Scheduler outcome marker update failed'))
}

async function registerScheduler<Name extends ScheduledJobName>(
  queue: Queue,
  declaration: SchedulerDeclaration<Name>,
) {
  const contract = getJobContract(declaration.name)
  await queue.upsertJobScheduler(declaration.schedulerId, declaration.schedule(), {
    name: contract.name,
    data: parseJobPayload(declaration.name, declaration.payload),
    opts: schedulerJobOptions(contract.name),
  })
}

function schedulerJobOptions(name: JobName) {
  const contract = getJobContract(name)
  return {
    attempts: contract.attempts,
    backoff: { type: 'exponential' as const, delay: 1_000, jitter: 0.25 },
    removeOnComplete: contract.retention.completed,
    removeOnFail: contract.retention.failed,
  }
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
  const declaration = schedulerCatalog.find((candidate) => candidate.name === jobName)
  return declaration
    ? { schedulerId: declaration.schedulerId, overlap: declaration.overlap }
    : undefined
}

export class SchedulerLeaseLostError extends Error {
  constructor(schedulerId: string) {
    super(`Scheduler lease lost for ${schedulerId}`)
  }
}

export async function runWithSchedulerOverlapPolicy<T>(
  connection: CoordinationRedisConnection,
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
    if (!held) {
      const reason = lease.signal.reason
      if (reason instanceof Error) throw reason
      throw new SchedulerLeaseLostError(schedulerId)
    }
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

function renewSchedulerLock(connection: CoordinationRedisConnection, key: string, token: string) {
  return connection.eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
    1,
    key,
    token,
    schedulerLockTtlMs,
  )
}

function releaseSchedulerLock(connection: CoordinationRedisConnection, key: string, token: string) {
  return connection.eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    1,
    key,
    token,
  )
}

function scheduler<Name extends ScheduledJobName>(
  declaration: SchedulerDeclaration<Name>,
): SchedulerDeclaration<Name> {
  return declaration
}
