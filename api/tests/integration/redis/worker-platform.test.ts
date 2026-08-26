import { defaultRepeatStrategy, Queue, Worker } from 'bullmq'
import { Redis } from 'ioredis'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'

let container: StartedTestContainer
let redisUrl: string
let containerRunning = false
let platforms: Array<{ close(): Promise<unknown> }> = []

beforeAll(async () => {
  container = await new GenericContainer('redis:7.4.7-alpine')
    .withCommand(['redis-server', '--appendonly', 'yes', '--appendfsync', 'always'])
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start()
  containerRunning = true
  redisUrl = `redis://${container.getHost()}:${container.getMappedPort(6379)}`
})

afterEach(async () => {
  await Promise.all(platforms.map((platform) => platform.close()))
  platforms = []
  vi.doUnmock('../../../src/db/client.js')
  vi.doUnmock('../../../src/domain-event-store.js')
  vi.doUnmock('../../../src/deployment-installation-settings.js')
  vi.doUnmock('../../../src/queue/scheduler.js')
  vi.doUnmock('../../../src/queue/worker-lifecycle.js')
  vi.doUnmock('../../../src/queue/redis.js')
  vi.resetModules()
})

afterAll(async () => {
  if (containerRunning) await container.stop()
})

describe('durable worker platform', () => {
  test('processes one derived diagnostic job and idempotently shares a scheduler', async () => {
    const sql = vi.fn().mockResolvedValue([{ ok: 1 }])
    const { startWorkerPlatform, enqueueDiagnostic, createOperationsQueue, closeOperationsQueue } =
      await loadPlatform(sql)
    const first = await startWorkerPlatform()
    const second = await startWorkerPlatform()
    platforms.push(first, second)

    await expect(enqueueDiagnostic('on-demand')).resolves.toMatchObject({ admitted: true })
    const queue = createOperationsQueue()
    await waitFor(async () => (await countJobs(queue, 'completed', 'diagnostic')) === 1)
    expect(await queue.getJobSchedulersCount()).toBe(3)
    expect(sql).toHaveBeenCalled()

    const { getJobDefinition } = await import('../../../src/queue/job-registry.js')
    const planner = getJobDefinition('planner') as unknown as {
      process(payload?: unknown): Promise<void>
    }
    const originalPlannerProcess = planner.process
    let plannerCalls = 0
    let releasePlanner: (() => void) | undefined
    const plannerBlocked = new Promise<void>((resolve) => (releasePlanner = resolve))
    planner.process = async () => {
      plannerCalls += 1
      await plannerBlocked
    }
    await Promise.all([
      queue.add('planner', { operationId: 'queue-planner' }),
      queue.add('planner', { operationId: 'queue-planner' }),
    ])
    await waitFor(() => Promise.resolve(plannerCalls === 1))
    expect(plannerCalls).toBe(1)
    releasePlanner?.()
    await waitFor(async () => (await countJobs(queue, 'completed', 'planner')) >= 2)
    planner.process = originalPlannerProcess

    const diagnostic = getJobDefinition('diagnostic') as unknown as {
      process(payload?: unknown): Promise<void>
      classifyError(error: unknown): 'retryable' | 'permanent'
      attempts: number
    }
    const originalProcess = diagnostic.process
    const originalClassification = diagnostic.classifyError
    let release: (() => void) | undefined
    const blocked = new Promise<void>((resolve) => (release = resolve))
    diagnostic.process = async () => blocked
    await enqueueDiagnostic('on-demand')
    await waitFor(async () => (await countJobs(queue, 'active', 'diagnostic')) === 1)
    await expect(enqueueDiagnostic('planner')).resolves.toMatchObject({
      admitted: false,
      reason: 'coalesced',
    })
    release?.()
    await waitFor(async () => (await countJobs(queue, 'completed', 'diagnostic')) >= 2)

    diagnostic.process = async () => {
      throw new Error('permanent diagnostic failure')
    }
    diagnostic.classifyError = () => 'permanent'
    await enqueueDiagnostic('on-demand')
    await waitFor(async () => (await countJobs(queue, 'failed', 'diagnostic')) === 1)

    diagnostic.classifyError = () => 'retryable'
    diagnostic.attempts = 1
    await enqueueDiagnostic('on-demand')
    await waitFor(async () => (await countJobs(queue, 'failed', 'diagnostic')) === 2)
    diagnostic.process = originalProcess
    diagnostic.classifyError = originalClassification
    diagnostic.attempts = 3

    const failureLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    await queue.add('unknown', {}, { attempts: 1, removeOnFail: true })
    await waitFor(() => Promise.resolve(failureLog.mock.calls.length === 1))
    failureLog.mockRestore()

    await closeOperationsQueue(queue)
  })

  test('delays planner output before the next schedule while on-demand work stays immediate', async () => {
    const { enqueueDiagnostic, createOperationsQueue, closeOperationsQueue } = await loadPlatform(
      vi.fn(),
    )
    const queue = createOperationsQueue()

    try {
      await expect(enqueueDiagnostic('planner')).resolves.toMatchObject({ admitted: true })
      const delayed = (await queue.getJobs(['delayed'])).find((job) => job.name === 'diagnostic')
      expect(delayed?.opts.delay).toBeGreaterThan(0)
      expect(delayed?.opts.delay).toBeLessThanOrEqual(60_000)
      const nextOccurrence = await defaultRepeatStrategy(delayed!.timestamp, {
        pattern: '*/15 * * * *',
      })
      expect(delayed!.timestamp + delayed!.opts.delay!).toBeLessThan(nextOccurrence!)

      await expect(enqueueDiagnostic('planner')).resolves.toMatchObject({
        admitted: false,
        reason: 'coalesced',
      })
      await expect(enqueueDiagnostic('on-demand')).resolves.toMatchObject({ admitted: true })
      const waiting = (await queue.getJobs(['waiting'])).find((job) => job.name === 'diagnostic')
      expect(waiting?.opts.delay ?? 0).toBe(0)
    } finally {
      await queue.drain(true)
      await closeOperationsQueue(queue)
    }
  })

  test('moves resource cooldowns to delayed without consuming the delivery attempt', async () => {
    const { startWorkerPlatform, createOperationsQueue, closeOperationsQueue } = await loadPlatform(
      vi.fn(),
    )
    const { EsiQuotaError } = await import('../../../src/esi-resilience/cooldowns.js')
    const { getJobDefinition, jobOptions } = await import('../../../src/queue/job-registry.js')
    const definition = getJobDefinition('resource-refresh') as unknown as {
      name: string
      process(): Promise<void>
    }
    const originalProcess = definition.process
    const retryAt = new Date(Date.now() + 30_000)
    definition.process = async () => {
      throw new EsiQuotaError(30, retryAt.getTime() - 30_000)
    }
    const platform = await startWorkerPlatform()
    platforms.push(platform)
    const queue = createOperationsQueue()
    try {
      await queue.add(
        definition.name,
        {
          moduleId: 'member-audit',
          resourceId: 'character-skills',
          subjectKind: 'character',
          subjectLifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
          subjectId: '1404328063',
        },
        jobOptions(definition as never),
      )
      await waitFor(async () =>
        (await queue.getJobs(['delayed'])).some((job) => job.name === 'resource-refresh'),
      )
      const delayed = (await queue.getJobs(['delayed'])).find(
        (job) => job.name === 'resource-refresh',
      )
      expect(delayed?.attemptsMade).toBe(0)
      expect(delayed?.name).toBe('resource-refresh')
    } finally {
      definition.process = originalProcess
      await closeOperationsQueue(queue)
    }
  })

  test('preserves the deployment offset when the worker schedules the next occurrence', async () => {
    const previousSchedule = process.env.QUEUE_PLANNER_SCHEDULE
    const previousOffset = process.env.QUEUE_PLANNER_SCHEDULE_OFFSET_MS
    const previousDelay = process.env.QUEUE_PLANNER_INITIAL_DELAY_MAX_MS
    process.env.QUEUE_PLANNER_SCHEDULE = '*/2 * * * * *'
    process.env.QUEUE_PLANNER_SCHEDULE_OFFSET_MS = '500'
    process.env.QUEUE_PLANNER_INITIAL_DELAY_MAX_MS = '250'

    try {
      const { startWorkerPlatform, createOperationsQueue, closeOperationsQueue } =
        await loadPlatform(vi.fn().mockResolvedValue([{ ok: 1 }]))
      const platform = await startWorkerPlatform()
      platforms.push(platform)
      const queue = createOperationsQueue()

      try {
        const first = await queue.getJobScheduler('diagnostic-planner')
        const firstNext = first?.next
        expect(firstNext).toBeTypeOf('number')
        if (firstNext === undefined) throw new Error('Scheduler has no first occurrence')
        expect(firstNext % 2_000).toBe(500)
        await waitFor(async () => {
          const current = await queue.getJobScheduler('diagnostic-planner')
          return current?.next !== undefined && current.next > firstNext
        })
        const second = await queue.getJobScheduler('diagnostic-planner')
        const secondNext = second?.next
        expect(secondNext).toBeTypeOf('number')
        expect(secondNext! % 2_000).toBe(500)
      } finally {
        await closeOperationsQueue(queue)
      }
    } finally {
      restoreEnvironment('QUEUE_PLANNER_SCHEDULE', previousSchedule)
      restoreEnvironment('QUEUE_PLANNER_SCHEDULE_OFFSET_MS', previousOffset)
      restoreEnvironment('QUEUE_PLANNER_INITIAL_DELAY_MAX_MS', previousDelay)
    }
  })

  test('closes producer and worker Redis connections without leaking shutdown errors', async () => {
    const {
      closeQueueRedisConnection,
      createProbeRedisConnection,
      createProducerRedisConnection,
      createWorkerRedisConnection,
    } = await import('../../../src/queue/redis.js')
    const producer = createProducerRedisConnection(redisUrl)
    const probe = createProbeRedisConnection(redisUrl)
    const worker = createWorkerRedisConnection(redisUrl)
    expect(producer.options.retryStrategy?.(1)).toBe(100)
    expect(producer.options.retryStrategy?.(4)).toBeNull()
    expect(worker.options.retryStrategy?.(4)).toBe(400)
    producer.emit('error', new Error('connection unavailable'))
    worker.emit('error', new Error('connection unavailable'))
    await closeQueueRedisConnection(producer)
    await closeQueueRedisConnection(probe)
    await closeQueueRedisConnection(worker)

    const quit = vi.fn().mockRejectedValue(new Error('shutdown timeout'))
    const disconnect = vi.fn()

    await closeQueueRedisConnection({ status: 'ready', quit, disconnect } as never)
    await closeQueueRedisConnection({ status: 'end', quit, disconnect } as never)

    expect(disconnect).toHaveBeenCalledOnce()
  })

  test('cleans up BullMQ connections when scheduler registration fails', async () => {
    process.env.QUEUE_REDIS_URL = redisUrl
    vi.doMock('../../../src/deployment-installation-settings.js', () => ({
      loadPlannerScheduleOffset: vi.fn().mockResolvedValue(30_000),
    }))
    vi.doMock('../../../src/queue/scheduler.js', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../../src/queue/scheduler.js')>()),
      registerSchedulers: vi.fn().mockRejectedValue(new Error('scheduler unavailable')),
    }))
    const { startWorkerPlatform } = await import('../../../src/queue/platform.js')

    await expect(startWorkerPlatform()).rejects.toThrow('scheduler unavailable')
  })

  test('recovers a job left active by a stopped worker', async () => {
    const {
      createProducerRedisConnection,
      createWorkerRedisConnection,
      closeQueueRedisConnection,
    } = await import('../../../src/queue/redis.js')
    const { operationsQueueName, queuePrefix } = await import('../../../src/queue/namespaces.js')
    const queueName = `${operationsQueueName}-stalled-recovery`
    const producer = createProducerRedisConnection(redisUrl)
    const queue = new Queue(queueName, { connection: producer, prefix: queuePrefix })
    try {
      let markStarted: (() => void) | undefined
      const started = new Promise<void>((resolve) => (markStarted = resolve))
      const stoppedConnection = createWorkerRedisConnection(redisUrl)
      const stoppedWorker = new Worker(
        queueName,
        async () => {
          markStarted?.()
          await new Promise<void>(() => {})
        },
        {
          connection: stoppedConnection,
          lockDuration: 1_000,
          stalledInterval: 1_000,
          prefix: queuePrefix,
        },
      )
      const eventId = '98a782d2-e042-47d7-9659-03b218121a1a'
      await queue.add(
        'domain-event',
        { eventId },
        { jobId: `domain-event-${eventId}`, removeOnComplete: true },
      )
      await started
      await stoppedWorker.close(true)
      await closeQueueRedisConnection(stoppedConnection)

      let recovered = 0
      const recoveryConnection = createWorkerRedisConnection(redisUrl)
      const recoveryWorker = new Worker(
        queueName,
        async () => {
          recovered += 1
        },
        {
          connection: recoveryConnection,
          lockDuration: 1_000,
          stalledInterval: 1_000,
          prefix: queuePrefix,
        },
      )
      await waitFor(() => Promise.resolve(recovered === 1), 20_000)
      expect(recovered).toBe(1)
      await recoveryWorker.close()
      await closeQueueRedisConnection(recoveryConnection)
    } finally {
      await queue.close()
      await closeQueueRedisConnection(producer)
    }
  })

  test('deduplicates concurrent event relay and retries enqueue-success acknowledgement failure', async () => {
    const { runOutboxRelayBatch } = await import('../../../src/queue/outbox-relay.js')
    const { assertSelectedDomainEventJobsAbsent } =
      await import('../../../src/domain-event-redrive-queue.js')
    const { createProducerRedisConnection, closeQueueRedisConnection } =
      await import('../../../src/queue/redis.js')
    const { operationsQueueName, queuePrefix } = await import('../../../src/queue/namespaces.js')
    const connection = createProducerRedisConnection(redisUrl)
    const queue = new Queue(`${operationsQueueName}-event-relay`, {
      connection,
      prefix: queuePrefix,
    })
    const eventId = 'a4fc5c0f-fb4d-4423-af88-9af3a8b60b86'
    const claimToken = 'b7e7be31-3547-48aa-baaa-9b86e89e4420'
    const claim = {
      valid: true as const,
      event: { eventId },
      claimToken,
      claimExpiresAt: new Date(Date.now() + 30_000),
      publishAttempts: 1,
    }
    const acknowledge = vi.fn().mockResolvedValue(true)
    const recordFailure = vi.fn().mockResolvedValue(true)
    const dependencies = {
      claim: vi.fn().mockResolvedValue([claim]),
      acknowledge,
      recordFailure,
    }

    try {
      await Promise.all([
        runOutboxRelayBatch(queue, { highWaterMark: 10 }, dependencies as never),
        runOutboxRelayBatch(queue, { highWaterMark: 10 }, dependencies as never),
      ])
      expect(await queue.getWaitingCount()).toBe(1)
      expect((await queue.getWaiting())[0]?.id).toBe(`domain-event-${eventId}`)
      await expect(assertSelectedDomainEventJobsAbsent([eventId], queue)).rejects.toThrow(
        'selected domain-event jobs still exist',
      )

      acknowledge.mockRejectedValueOnce(new Error('acknowledgement unavailable'))
      await expect(
        runOutboxRelayBatch(queue, { highWaterMark: 10 }, dependencies as never),
      ).resolves.toMatchObject({ failed: 1 })
      expect(recordFailure).toHaveBeenCalledWith(expect.objectContaining({ category: 'unknown' }))
      expect(await queue.getWaitingCount()).toBe(1)

      acknowledge.mockResolvedValue(true)
      await expect(
        runOutboxRelayBatch(queue, { highWaterMark: 10 }, dependencies as never),
      ).resolves.toMatchObject({ published: 1 })
      expect(await queue.getWaitingCount()).toBe(1)

      await queue.obliterate({ force: true })
      expect(await queue.getJobCounts('waiting', 'delayed', 'active')).toMatchObject({ waiting: 0 })
      await expect(assertSelectedDomainEventJobsAbsent([eventId], queue)).resolves.toBeUndefined()
      await expect(
        runOutboxRelayBatch(queue, { highWaterMark: 10 }, dependencies as never),
      ).resolves.toMatchObject({ published: 1 })
      expect((await queue.getWaiting())[0]?.id).toBe(`domain-event-${eventId}`)
    } finally {
      await queue.close()
      await closeQueueRedisConnection(connection)
    }
  })

  test('holds planner output at the high-water mark until production can resume', async () => {
    const { admitQueueWork } = await import('../../../src/queue/admission.js')
    const { operationsQueueName, queuePrefix } = await import('../../../src/queue/namespaces.js')
    const { createProducerRedisConnection, closeQueueRedisConnection } =
      await import('../../../src/queue/redis.js')
    const connection = createProducerRedisConnection(redisUrl)
    const queue = new Queue(`${operationsQueueName}-saturation`, {
      connection,
      prefix: queuePrefix,
    })
    const highWaterMark = 3

    try {
      await queue.add('derived', { operationId: 'subject-a' }, { delay: 60_000 })
      await queue.add('derived', { operationId: 'subject-b' }, { delay: 60_000 })
      await queue.add('derived', { operationId: 'subject-c' }, { delay: 60_000 })

      for (let interval = 0; interval < 4; interval += 1) {
        await expect(
          admitQueueWork(queue, 'subject-a', 'planner', highWaterMark),
        ).resolves.toMatchObject({
          admitted: false,
          depth: highWaterMark,
          reason: 'planner-paused',
        })
        expect(await queue.getDelayedCount()).toBe(highWaterMark)
        const jobs = await queue.getJobs(['waiting', 'delayed'])
        expect(jobs.filter((job) => job.data.operationId === 'subject-a')).toHaveLength(1)
      }

      await expect(
        admitQueueWork(queue, 'domain-event', 'outbox', highWaterMark),
      ).resolves.toMatchObject({
        admitted: false,
        reason: 'outbox-paused',
      })

      await queue.drain(true)
      await expect(
        admitQueueWork(queue, 'subject-a', 'planner', highWaterMark),
      ).resolves.toMatchObject({
        admitted: true,
        depth: 0,
      })
      await expect(
        admitQueueWork(queue, 'domain-event', 'outbox', highWaterMark),
      ).resolves.toMatchObject({ admitted: true })
      await queue.add('derived', { operationId: 'subject-a' })
      await expect(queue.getWaitingCount()).resolves.toBe(1)
    } finally {
      await queue.close()
      await closeQueueRedisConnection(connection)
    }
  })

  test('recovers accepted waiting and delayed jobs after a Redis restart', async () => {
    const { createProducerRedisConnection, closeQueueRedisConnection } =
      await import('../../../src/queue/redis.js')
    const { operationsQueueName, queuePrefix } = await import('../../../src/queue/namespaces.js')
    const queueName = `${operationsQueueName}-restart-recovery`
    const beforeRestart = createProducerRedisConnection(redisUrl)
    const queue = new Queue(queueName, { connection: beforeRestart, prefix: queuePrefix })

    try {
      await queue.add(
        'domain-event',
        { eventId: 'a4fc5c0f-fb4d-4423-af88-9af3a8b60b86' },
        { jobId: 'domain-event-a4fc5c0f-fb4d-4423-af88-9af3a8b60b86' },
      )
      await queue.add(
        'domain-event',
        { eventId: 'b9d03bf1-b12a-4b61-89b5-ad15f2de53ab' },
        { jobId: 'domain-event-b9d03bf1-b12a-4b61-89b5-ad15f2de53ab', delay: 60_000 },
      )
    } finally {
      await queue.close()
      await closeQueueRedisConnection(beforeRestart)
    }

    await container.restart()
    containerRunning = true
    redisUrl = `redis://${container.getHost()}:${container.getMappedPort(6379)}`
    await waitForRedis(redisUrl)
    const afterRestart = createProducerRedisConnection(redisUrl)
    const recoveredQueue = new Queue(queueName, { connection: afterRestart, prefix: queuePrefix })

    try {
      await waitFor(async () => {
        const counts = await recoveredQueue.getJobCounts('waiting', 'delayed')
        return counts.waiting === 1 && counts.delayed === 1
      }, 20_000)
      await expect(recoveredQueue.getJobCounts('waiting', 'delayed')).resolves.toMatchObject({
        waiting: 1,
        delayed: 1,
      })
    } finally {
      await recoveredQueue.close()
      await closeQueueRedisConnection(afterRestart)
    }
  })

  test('starts the first worker against a queue Redis holding no heartbeat', async () => {
    await flushQueueRedis()
    const { startWorkerPlatform } = await loadPlatform(vi.fn().mockResolvedValue([{ ok: 1 }]))
    const { probeQueueStatus } = await import('../../../src/queue/status.js')
    const { assertWorkerDependencies, assertWorkerStartupDependencies } =
      await import('../../../src/worker-readiness.js')

    await expect(probeQueueStatus()).resolves.toMatchObject({
      status: 'degraded',
      workerHeartbeatAt: null,
    })
    await expect(
      assertWorkerStartupDependencies(migratedConnection() as never, probeQueueStatus),
    ).resolves.toBeUndefined()
    await expect(
      assertWorkerDependencies(migratedConnection() as never, probeQueueStatus),
    ).rejects.toThrow('Worker dependency unavailable: Worker heartbeat stale')

    platforms.push(await startWorkerPlatform())

    await expect(probeQueueStatus()).resolves.toMatchObject({ status: 'operational' })
    await expect(
      assertWorkerDependencies(migratedConnection() as never, probeQueueStatus),
    ).resolves.toBeUndefined()
  })

  test('closes the worker when the first heartbeat write fails', async () => {
    await flushQueueRedis()
    let workerConnection: Redis | undefined
    vi.doMock('../../../src/queue/redis.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../../src/queue/redis.js')>()
      return {
        ...actual,
        createWorkerRedisConnection: (url?: string) => {
          workerConnection = actual.createWorkerRedisConnection(url)
          return workerConnection
        },
      }
    })
    vi.doMock('../../../src/queue/worker-lifecycle.js', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../../src/queue/worker-lifecycle.js')>()),
      startWorkerHeartbeat: vi
        .fn()
        .mockRejectedValue(new Error('OOM command not allowed when used memory > maxmemory')),
    }))
    const { startWorkerPlatform, createOperationsQueue, closeOperationsQueue } = await loadPlatform(
      vi.fn().mockResolvedValue([{ ok: 1 }]),
    )

    await expect(startWorkerPlatform()).rejects.toThrow('OOM command not allowed')

    // ioredis reports 'end' shortly after the QUIT reply, so settle rather than sample once.
    await waitFor(() => Promise.resolve(workerConnection?.status === 'end'))
    const queue = createOperationsQueue()
    try {
      // A worker surviving the failed startup would consume this without heartbeat telemetry.
      await queue.add('diagnostic', { operationId: 'queue-diagnostic' })
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      await expect(countJobs(queue, 'waiting', 'diagnostic')).resolves.toBe(1)
      await expect(countJobs(queue, 'active', 'diagnostic')).resolves.toBe(0)
      await expect(countJobs(queue, 'completed', 'diagnostic')).resolves.toBe(0)
    } finally {
      await queue.drain(true)
      await closeOperationsQueue(queue)
    }
  })
  test('leaves queued work untouched when startup fails before consumption begins', async () => {
    await flushQueueRedis()
    const { operationsQueueName, queuePrefix } = await import('../../../src/queue/namespaces.js')
    const seedConnection = new Redis(redisUrl, { maxRetriesPerRequest: null })
    const seedQueue = new Queue(operationsQueueName, {
      connection: seedConnection,
      prefix: queuePrefix,
    })
    // A job left waiting by an earlier deployment, ready for whichever worker starts next.
    await seedQueue.add('diagnostic', { operationId: 'queue-diagnostic' })
    await seedQueue.close()
    seedConnection.disconnect()

    vi.doMock('../../../src/queue/worker-lifecycle.js', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../../src/queue/worker-lifecycle.js')>()),
      // Held open long enough that an autorunning worker would certainly have claimed the job.
      startWorkerHeartbeat: vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 750))
        throw new Error('OOM command not allowed when used memory > maxmemory')
      }),
    }))
    const { startWorkerPlatform, createOperationsQueue, closeOperationsQueue } = await loadPlatform(
      vi.fn().mockResolvedValue([{ ok: 1 }]),
    )

    await expect(startWorkerPlatform()).rejects.toThrow('OOM command not allowed')

    const queue = createOperationsQueue()
    try {
      await expect(countJobs(queue, 'waiting', 'diagnostic')).resolves.toBe(1)
      await expect(countJobs(queue, 'active', 'diagnostic')).resolves.toBe(0)
      await expect(countJobs(queue, 'completed', 'diagnostic')).resolves.toBe(0)
    } finally {
      await queue.drain(true)
      await closeOperationsQueue(queue)
    }
  })

  test('does not produce planner output once the scheduler lease is lost', async () => {
    await flushQueueRedis()
    const { enqueueDiagnostic, createOperationsQueue, closeOperationsQueue } = await loadPlatform(
      vi.fn().mockResolvedValue([{ ok: 1 }]),
    )
    const lost = new AbortController()
    lost.abort(new Error('Scheduler lease lost for diagnostic-planner'))

    await expect(enqueueDiagnostic('planner', lost.signal)).rejects.toThrow('Scheduler lease lost')

    const queue = createOperationsQueue()
    try {
      await expect(queue.getJobCounts('waiting', 'delayed')).resolves.toMatchObject({
        waiting: 0,
        delayed: 0,
      })
    } finally {
      await closeOperationsQueue(queue)
    }
  })

  test('checks the lease again after admission, before it writes', async () => {
    await flushQueueRedis()
    const lost = new AbortController()
    vi.doMock('../../../src/queue/scheduler.js', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../../src/queue/scheduler.js')>()),
      // Admission and the delay lookup are both round trips; the lease can go during them.
      plannerInitialDelay: vi.fn().mockImplementation(async () => {
        lost.abort(new Error('Scheduler lease lost for diagnostic-planner'))
        return 0
      }),
    }))
    const { enqueueDiagnostic, createOperationsQueue, closeOperationsQueue } = await loadPlatform(
      vi.fn().mockResolvedValue([{ ok: 1 }]),
    )

    await expect(enqueueDiagnostic('planner', lost.signal)).rejects.toThrow('Scheduler lease lost')

    const queue = createOperationsQueue()
    try {
      await expect(queue.getJobCounts('waiting', 'delayed')).resolves.toMatchObject({
        waiting: 0,
        delayed: 0,
      })
    } finally {
      await closeOperationsQueue(queue)
    }
  })

  test('wires the lease signal through the registered planner job', async () => {
    await flushQueueRedis()
    const { createOperationsQueue, closeOperationsQueue } = await loadPlatform(
      vi.fn().mockResolvedValue([{ ok: 1 }]),
    )
    const { getJobDefinition } = await import('../../../src/queue/job-registry.js')
    const planner = getJobDefinition('planner')
    const lost = new AbortController()
    lost.abort(new Error('Scheduler lease lost for diagnostic-planner'))

    await expect(
      planner?.process({ operationId: 'queue-planner' } as never, lost.signal),
    ).rejects.toThrow('Scheduler lease lost')

    const queue = createOperationsQueue()
    try {
      await expect(queue.getJobCounts('waiting', 'delayed')).resolves.toMatchObject({
        waiting: 0,
        delayed: 0,
      })
    } finally {
      await closeOperationsQueue(queue)
    }
  })

  // Must stay last: it stops the suite's shared Redis container.
  test('bounds shutdown when the queue Redis stops answering', async () => {
    await integrationDeadline(flushQueueRedis(), 5_000, 'Redis flush')
    const timedOut = vi.spyOn(console, 'error').mockImplementation(() => {})
    const workerDisconnect = vi.spyOn(Worker.prototype, 'disconnect')
    const { startWorkerPlatform } = await loadPlatform(vi.fn().mockResolvedValue([{ ok: 1 }]))
    const platform = await integrationDeadline(startWorkerPlatform(), 5_000, 'worker startup')

    await integrationDeadline(container.stop(), 10_000, 'Redis stop')
    containerRunning = false
    const workerPause = vi
      .spyOn(Worker.prototype, 'pause')
      .mockReturnValue(new Promise<void>(() => {}))

    const startedAt = Date.now()
    await expect(
      integrationDeadline(platform.close(1_000), 5_000, 'worker shutdown'),
    ).resolves.toBeTypeOf('boolean')
    expect(Date.now() - startedAt).toBeLessThan(3_000)
    expect(timedOut).toHaveBeenCalledWith(
      'Worker shutdown exceeded its timeout; dropping queue connections',
    )
    // Dropping only our own connections would leave BullMQ's blocking client retrying.
    expect(workerDisconnect).toHaveBeenCalled()
    workerPause.mockRestore()
    workerDisconnect.mockRestore()
    timedOut.mockRestore()
  })
})

function migratedConnection() {
  return vi
    .fn()
    .mockResolvedValueOnce([{ exists: true, qualified: true }])
    .mockResolvedValueOnce([
      { module: 'core', name: '019_platform_resource_failure_eligibility.sql' },
    ])
}

async function flushQueueRedis() {
  const connection = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 })
  connection.on('error', () => {})
  try {
    await connection.connect()
    await connection.flushdb()
  } finally {
    connection.disconnect()
  }
}

async function loadPlatform(sql: ReturnType<typeof vi.fn>) {
  process.env.QUEUE_REDIS_URL = redisUrl
  vi.doMock('../../../src/db/client.js', () => ({ sql }))
  vi.doMock('../../../src/domain-event-store.js', () => ({
    claimPendingDomainEvents: vi.fn().mockResolvedValue([]),
    deletePublishedDomainEvents: vi.fn().mockResolvedValue(0),
    getPendingDomainEventAggregates: vi
      .fn()
      .mockResolvedValue({ pendingCount: 0, oldestPendingAt: null }),
    loadDomainEvent: vi.fn().mockResolvedValue(null),
    markDomainEventPublished: vi.fn().mockResolvedValue(true),
    recordDomainEventPublishFailure: vi.fn().mockResolvedValue(true),
  }))
  vi.doMock('../../../src/deployment-installation-settings.js', () => ({
    loadPlannerScheduleOffset: vi
      .fn()
      .mockResolvedValue(Number(process.env.QUEUE_PLANNER_SCHEDULE_OFFSET_MS || 30_000)),
  }))
  return import('../../../src/queue/platform.js')
}

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Timed out waiting for queue state')
}

async function waitForRedis(url: string) {
  await waitFor(async () => {
    const connection = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    })
    connection.on('error', () => {})
    try {
      await connection.connect()
      return (await connection.ping()) === 'PONG'
    } catch {
      return false
    } finally {
      connection.disconnect()
    }
  }, 20_000)
}

async function countJobs(
  queue: Queue,
  state: 'waiting' | 'active' | 'completed' | 'failed',
  name: string,
) {
  return (await queue.getJobs([state])).filter((job) => job.name === name).length
}

async function integrationDeadline<T>(operation: Promise<T>, timeoutMs: number, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
