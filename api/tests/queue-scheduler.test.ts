import { expect, test, vi } from 'vitest'
import { defaultRepeatStrategy } from 'bullmq'
import {
  createPlannerRepeatStrategy,
  diagnosticOverlapPolicy,
  diagnosticSchedulerId,
  eventRetentionIntervalMs,
  eventRetentionSchedulerId,
  getJobScheduler,
  outboxRelaySchedulerId,
  plannerInitialDelay,
  registerSchedulers,
  runWithSchedulerOverlapPolicy,
  SchedulerLeaseLostError,
} from '../src/queue/scheduler.js'

test('upserts stable skip-overlap planner, relay, and retention schedulers', async () => {
  const client = { set: vi.fn() }
  const queue = {
    upsertJobScheduler: vi.fn(),
    getBackend: () => ({ client: Promise.resolve(client) }),
  }

  await registerSchedulers(queue as never)

  expect(queue.upsertJobScheduler).toHaveBeenNthCalledWith(
    1,
    diagnosticSchedulerId,
    { pattern: '*/15 * * * *' },
    {
      name: 'planner',
      data: { operationId: 'queue-planner' },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1_000, jitter: 0.25 },
        removeOnComplete: { age: 86_400, count: 1_000 },
        removeOnFail: { age: 604_800, count: 5_000 },
      },
    },
  )
  expect(queue.upsertJobScheduler).toHaveBeenNthCalledWith(
    2,
    outboxRelaySchedulerId,
    { every: 5_000 },
    {
      name: 'outbox-relay',
      data: { operationId: 'outbox-relay' },
      opts: expect.objectContaining({ attempts: 3 }),
    },
  )
  expect(queue.upsertJobScheduler).toHaveBeenNthCalledWith(
    3,
    eventRetentionSchedulerId,
    { every: eventRetentionIntervalMs },
    {
      name: 'domain-event-retention',
      data: { operationId: 'domain-event-retention' },
      opts: expect.objectContaining({ attempts: 3 }),
    },
  )
  expect(getJobScheduler('outbox-relay')).toEqual({
    schedulerId: outboxRelaySchedulerId,
    overlap: 'skip',
  })
  expect(getJobScheduler('domain-event-retention')).toEqual({
    schedulerId: eventRetentionSchedulerId,
    overlap: 'skip',
  })
  expect(getJobScheduler('domain-event')).toBeUndefined()
  expect(client.set).toHaveBeenCalledWith('eve-space:v1:scheduler:outcome', 'registered', {
    EX: 60,
  })
})

test('applies a stable deployment offset without crossing the next occurrence', async () => {
  const now = Date.parse('2026-08-23T12:01:00.000Z')
  const options = { pattern: '*/15 * * * *' }
  const base = await defaultRepeatStrategy(now, options)
  const firstDeployment = createPlannerRepeatStrategy(30_000, 60_000)
  const secondDeployment = createPlannerRepeatStrategy(90_000, 60_000)

  await expect(firstDeployment(now, options, 'planner')).resolves.toBe(base! + 30_000)
  await expect(secondDeployment(now, options, 'planner')).resolves.toBe(base! + 90_000)
  await expect(firstDeployment(now, options, 'other')).resolves.toBe(base)
  await expect(
    createPlannerRepeatStrategy(14 * 60_000, 60_000)(now, options, 'planner'),
  ).rejects.toThrow('must fit before its next occurrence')
})

test('preserves fixed intervals used by outbox and retention schedulers', async () => {
  const now = Date.parse('2026-08-23T12:00:01.250Z')
  const strategy = createPlannerRepeatStrategy(30_000, 60_000)

  await expect(strategy(now, { every: 5_000 }, 'outbox-relay')).resolves.toBe(
    Date.parse('2026-08-23T12:00:05.000Z'),
  )
  await expect(strategy(now, { every: 5_000, immediately: true }, 'outbox-relay')).resolves.toBe(
    Date.parse('2026-08-23T12:00:00.000Z'),
  )
  await expect(strategy(now, { every: 5_000, pattern: '* * * * * *' }, 'invalid')).rejects.toThrow(
    'both pattern and every',
  )
})

test('bounds each planner output delay before the next schedule occurrence', async () => {
  const options = { pattern: '*/15 * * * *' }
  const ordinaryStart = Date.parse('2026-08-23T12:00:30.000Z')
  const lateStart = Date.parse('2026-08-23T12:14:59.995Z')

  await expect(
    plannerInitialDelay(ordinaryStart, options, 60_000, (maximum) => maximum),
  ).resolves.toBe(60_000)
  await expect(plannerInitialDelay(lateStart, options, 60_000, (maximum) => maximum)).resolves.toBe(
    4,
  )
})

test('skips an overlapping scheduler execution under a renewable lease', async () => {
  let release: (() => void) | undefined
  let started: (() => void) | undefined
  const operationStarted = new Promise<void>((resolve) => (started = resolve))
  const operationBlocked = new Promise<void>((resolve) => (release = resolve))
  const connection = {
    set: vi.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce(null),
    eval: vi.fn().mockResolvedValue(1),
  }

  const first = runWithSchedulerOverlapPolicy(
    connection as never,
    diagnosticSchedulerId,
    diagnosticOverlapPolicy,
    async () => {
      started?.()
      await operationBlocked
    },
  )
  await operationStarted

  await expect(
    runWithSchedulerOverlapPolicy(
      connection as never,
      diagnosticSchedulerId,
      diagnosticOverlapPolicy,
      async () => undefined,
    ),
  ).resolves.toEqual({ executed: false })
  release?.()
  await expect(first).resolves.toMatchObject({ executed: true })
  expect(connection.eval).toHaveBeenCalledOnce()
})

test('aborts the operation when Redis reports the scheduler lease was taken', async () => {
  vi.useFakeTimers()
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const connection = {
    set: vi.fn().mockResolvedValue('OK'),
    eval: vi.fn().mockResolvedValue(0),
  }
  let aborted: string | undefined

  const run = runWithSchedulerOverlapPolicy(
    connection as never,
    diagnosticSchedulerId,
    diagnosticOverlapPolicy,
    (signal) =>
      new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => {
          aborted = (signal.reason as Error).message
          resolve()
        })
      }),
  )

  // Attach the handler before advancing: the rejection lands inside the timer advance.
  const settled = run.catch((reason: unknown) => reason)
  await vi.advanceTimersByTimeAsync(10_000)

  await expect(settled).resolves.toBeInstanceOf(SchedulerLeaseLostError)
  expect(aborted).toContain(diagnosticSchedulerId)
  expect(error).toHaveBeenCalledWith('Scheduler overlap lock lost')
  // Releasing would be a pointless round trip: the key belongs to the new owner.
  expect(connection.eval).toHaveBeenCalledOnce()
  vi.useRealTimers()
  error.mockRestore()
})

test('survives a single renewal failure while the lease TTL still covers it', async () => {
  vi.useFakeTimers()
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  let release: (() => void) | undefined
  const blocked = new Promise<void>((resolve) => (release = resolve))
  const connection = {
    set: vi.fn().mockResolvedValue('OK'),
    eval: vi.fn().mockRejectedValueOnce(new Error('connection reset')).mockResolvedValue(1),
  }

  const run = runWithSchedulerOverlapPolicy(
    connection as never,
    diagnosticSchedulerId,
    diagnosticOverlapPolicy,
    async () => blocked,
  )

  await vi.advanceTimersByTimeAsync(10_000)
  expect(error).toHaveBeenCalledWith('Scheduler overlap lock renewal failed')

  release?.()
  await expect(run).resolves.toMatchObject({ executed: true })
  vi.useRealTimers()
  error.mockRestore()
})

test('gives up the lease when renewals keep failing past its TTL', async () => {
  vi.useFakeTimers()
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const connection = {
    set: vi.fn().mockResolvedValue('OK'),
    eval: vi.fn().mockRejectedValue(new Error('connection reset')),
  }

  const run = runWithSchedulerOverlapPolicy(
    connection as never,
    diagnosticSchedulerId,
    diagnosticOverlapPolicy,
    () => new Promise<void>(() => {}),
  )

  const settled = run.catch((reason: unknown) => reason)
  // Renewals at 10s and 20s stay inside the 30s TTL; the one at 30s cannot prove the lease.
  await vi.advanceTimersByTimeAsync(30_000)

  await expect(settled).resolves.toBeInstanceOf(SchedulerLeaseLostError)
  vi.useRealTimers()
  error.mockRestore()
})

test('gives up the lease when renewals hang instead of rejecting', async () => {
  vi.useFakeTimers()
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const connection = {
    set: vi.fn().mockResolvedValue('OK'),
    // Retrying without limit, a partitioned renewal stays pending rather than rejecting.
    eval: vi.fn().mockReturnValue(new Promise(() => {})),
  }

  const run = runWithSchedulerOverlapPolicy(
    connection as never,
    diagnosticSchedulerId,
    diagnosticOverlapPolicy,
    () => new Promise<void>(() => {}),
  )
  const settled = run.catch((reason: unknown) => reason)
  await vi.advanceTimersByTimeAsync(30_000)

  await expect(settled).resolves.toBeInstanceOf(SchedulerLeaseLostError)
  expect(error).toHaveBeenCalledWith('Scheduler overlap lock expired without a confirmed renewal')
  vi.useRealTimers()
  error.mockRestore()
})

test('holds a lease across a run far longer than its TTL while renewals confirm', async () => {
  vi.useFakeTimers()
  let release: (() => void) | undefined
  const blocked = new Promise<void>((resolve) => (release = resolve))
  const connection = {
    set: vi.fn().mockResolvedValue('OK'),
    eval: vi.fn().mockResolvedValue(1),
  }

  const run = runWithSchedulerOverlapPolicy(
    connection as never,
    diagnosticSchedulerId,
    diagnosticOverlapPolicy,
    async () => blocked,
  )

  // Each confirmed renewal has to re-arm the watchdog, or a healthy long run would abort itself.
  await vi.advanceTimersByTimeAsync(120_000)
  release?.()

  await expect(run).resolves.toMatchObject({ executed: true })
  vi.useRealTimers()
})
