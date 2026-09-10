import { Queue, Worker } from 'bullmq'
import { Redis } from 'ioredis'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'

let container: StartedTestContainer
let redisUrl: string
let containerRunning = false
let platforms: Array<{ close(timeoutMs?: number): Promise<unknown> }> = []

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
  vi.resetModules()
  vi.restoreAllMocks()
})

afterAll(async () => {
  if (containerRunning) await container.stop()
})

describe('durable worker platform', () => {
  test('registers stable scheduler identities before processing mixed-version-compatible jobs', async () => {
    await flushQueueRedis()
    const sql = vi.fn().mockResolvedValue([{ ok: 1 }])
    const { startWorkerPlatform, enqueueDiagnostic } = await loadPlatform(sql)
    const platform = await startWorkerPlatform()
    platforms.push(platform)
    const handle = await openQueue()
    try {
      for (const schedulerId of ['diagnostic-planner', 'outbox-relay', 'domain-event-retention'])
        expect(await handle.queue.getJobScheduler(schedulerId)).toBeDefined()
      const { probeQueueStatus } = await import('../../../src/queue/status.js')
      await expect(probeQueueStatus()).resolves.toMatchObject({
        latestSchedulerOutcome: 'registered',
      })

      await expect(enqueueDiagnostic('on-demand')).resolves.toMatchObject({ status: 'accepted' })
      await handle.queue.add('diagnostic', { operationId: 'queue-diagnostic' })
      await waitFor(async () => (await countJobs(handle.queue, 'completed', 'diagnostic')) >= 2)
      expect(sql).toHaveBeenCalled()
    } finally {
      await handle.close()
    }
  })

  test('returns typed on-demand rejection and planner coalescing outcomes', async () => {
    await flushQueueRedis()
    const handle = await openQueue()
    const { createBullMqQueueProducer } = await import('../../../src/queue/bullmq-producer.js')
    const producer = createBullMqQueueProducer({ handle, highWaterMark: 1 })
    try {
      await handle.queue.add('held', {}, { delay: 60_000 })
      await expect(
        producer.enqueue({
          name: 'diagnostic',
          payload: { operationId: 'queue-diagnostic' },
          source: 'on-demand',
        }),
      ).resolves.toMatchObject({ status: 'rejected', reason: 'on-demand-rejected' })

      await handle.queue.drain(true)
      const plannerProducer = createBullMqQueueProducer({ handle, highWaterMark: 2 })
      await expect(
        plannerProducer.enqueue({
          name: 'diagnostic',
          payload: { operationId: 'queue-diagnostic' },
          source: 'planner',
        }),
      ).resolves.toMatchObject({ status: 'accepted' })
      await expect(
        plannerProducer.enqueue({
          name: 'diagnostic',
          payload: { operationId: 'queue-diagnostic' },
          source: 'planner',
        }),
      ).resolves.toMatchObject({ status: 'rejected', reason: 'coalesced' })
    } finally {
      await handle.queue.drain(true)
      await handle.close()
    }
  })

  test('persists and logs only sanitized dependency failures', async () => {
    await flushQueueRedis()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const sql = vi
      .fn()
      .mockRejectedValue(new Error('postgres://user:password@private-host/eve-space'))
    const { startWorkerPlatform, enqueueDiagnostic } = await loadPlatform(sql)
    const platform = await startWorkerPlatform()
    platforms.push(platform)
    const handle = await openQueue()
    try {
      await enqueueDiagnostic('on-demand')
      await waitFor(async () => (await countJobs(handle.queue, 'failed', 'diagnostic')) === 1)
      const failed = (await handle.queue.getJobs(['failed'])).find(
        (job) => job.name === 'diagnostic',
      )

      expect(failed?.failedReason).toBe('retryable dependency failure')
      const serializedLogs = JSON.stringify(consoleError.mock.calls)
      expect(serializedLogs).not.toContain('private-host')
      expect(serializedLogs).not.toContain('password')
    } finally {
      await handle.close()
    }
  })

  test('defers cooldown dispositions without consuming an attempt', async () => {
    await flushQueueRedis()
    const retryAt = new Date(Date.now() + 30_000)
    vi.doMock('../../../src/characters/affiliation-sync.js', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../../src/characters/affiliation-sync.js')>()),
      processAffiliationBatch: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('cooldown'), { retryAt })),
    }))
    const { startWorkerPlatform } = await loadPlatform(vi.fn())
    const platform = await startWorkerPlatform()
    platforms.push(platform)
    const handle = await openQueue()
    try {
      await handle.queue.add('affiliation', {
        operationId: 'affiliation-1',
        characterIds: [1],
      })
      await waitFor(async () =>
        (await handle.queue.getJobs(['delayed'])).some((job) => job.name === 'affiliation'),
      )
      const delayed = (await handle.queue.getJobs(['delayed'])).find(
        (job) => job.name === 'affiliation',
      )
      expect(delayed?.attemptsMade).toBe(0)
    } finally {
      await handle.close()
    }
  })

  test('does not claim waiting work until schedulers and the first heartbeat are ready', async () => {
    await flushQueueRedis()
    const seed = await openQueue()
    await seed.queue.add('diagnostic', { operationId: 'queue-diagnostic' })
    await seed.close()

    let releaseHeartbeat: (() => void) | undefined
    const heartbeatReady = new Promise<void>((resolve) => (releaseHeartbeat = resolve))
    vi.doMock('../../../src/queue/worker-lifecycle.js', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../../src/queue/worker-lifecycle.js')>()),
      startWorkerHeartbeat: vi.fn().mockImplementation(async () => {
        await heartbeatReady
        return () => {}
      }),
    }))
    const { startWorkerPlatform } = await loadPlatform(vi.fn().mockResolvedValue([{ ok: 1 }]))
    const starting = startWorkerPlatform()
    const inspection = await openQueue()
    try {
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(await countJobs(inspection.queue, 'waiting', 'diagnostic')).toBe(1)
      expect(await inspection.queue.getJobSchedulersCount()).toBe(3)
      releaseHeartbeat?.()
      const platform = await starting
      platforms.push(platform)
      await waitFor(
        async () => (await countJobs(inspection.queue, 'completed', 'diagnostic')) === 1,
      )
    } finally {
      await inspection.close()
    }
  })

  test('reconstructs deterministic authoritative work after deliberate queue loss', async () => {
    await flushQueueRedis()
    process.env.QUEUE_REDIS_URL = redisUrl
    const handle = await openQueue()
    const { createBullMqQueueProducer } = await import('../../../src/queue/bullmq-producer.js')
    const { assertSelectedDomainEventJobsAbsent } =
      await import('../../../src/queue/domain-event-inspection.js')
    const producer = createBullMqQueueProducer({ handle })
    const command = {
      name: 'domain-event',
      payload: { eventId: 'a4fc5c0f-fb4d-4423-af88-9af3a8b60b86' },
      source: 'outbox',
    } as const
    try {
      await producer.enqueue(command)
      expect((await handle.queue.getWaiting())[0]?.id).toBe(
        `domain-event-${command.payload.eventId}`,
      )
      await expect(assertSelectedDomainEventJobsAbsent([command.payload.eventId])).rejects.toThrow(
        'selected domain-event jobs still exist',
      )
      await handle.queue.obliterate({ force: true })
      await expect(
        assertSelectedDomainEventJobsAbsent([command.payload.eventId]),
      ).resolves.toBeUndefined()
      await producer.enqueue(command)
      expect((await handle.queue.getWaiting())[0]?.id).toBe(
        `domain-event-${command.payload.eventId}`,
      )
    } finally {
      await handle.close()
    }
  })

  test('recovers accepted waiting and delayed jobs after an AOF Redis restart', async () => {
    await flushQueueRedis()
    const handle = await openQueue()
    await handle.queue.add('diagnostic', { operationId: 'queue-diagnostic' })
    await handle.queue.add('diagnostic', { operationId: 'queue-diagnostic' }, { delay: 60_000 })
    await handle.close()

    await container.restart()
    redisUrl = `redis://${container.getHost()}:${container.getMappedPort(6379)}`
    await waitForRedis()
    const recovered = await openQueue()
    try {
      await expect(recovered.queue.getJobCounts('waiting', 'delayed')).resolves.toMatchObject({
        waiting: 1,
        delayed: 1,
      })
    } finally {
      await recovered.queue.drain(true)
      await recovered.close()
    }
  })

  // Must stay last because it stops the suite's shared Redis container.
  test('bounds shutdown when queue Redis stops answering', async () => {
    await flushQueueRedis()
    const timeoutLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const workerDisconnect = vi.spyOn(Worker.prototype, 'disconnect')
    const { startWorkerPlatform } = await loadPlatform(vi.fn().mockResolvedValue([{ ok: 1 }]))
    const platform = await startWorkerPlatform()

    await container.stop()
    containerRunning = false
    const workerPause = vi
      .spyOn(Worker.prototype, 'pause')
      .mockReturnValue(new Promise<void>(() => {}))
    const startedAt = Date.now()
    await expect(platform.close(1_000)).resolves.toBeTypeOf('boolean')
    expect(Date.now() - startedAt).toBeLessThan(3_000)
    expect(timeoutLog).toHaveBeenCalledWith(
      'Worker shutdown exceeded its timeout; dropping queue connections',
    )
    expect(workerDisconnect).toHaveBeenCalled()
    workerPause.mockRestore()
  })
})

async function openQueue() {
  const { createCoordinationRedisConnection } = await import('../../../src/coordination-redis.js')
  const { createOperationsQueueHandle } = await import('../../../src/queue/operations-queue.js')
  return createOperationsQueueHandle({ connection: createCoordinationRedisConnection(redisUrl) })
}

async function loadPlatform(sql: ReturnType<typeof vi.fn>) {
  process.env.QUEUE_REDIS_URL = redisUrl
  vi.doMock('../../../src/db/client.js', () => ({ sql }))
  vi.doMock('../../../src/domain-events/store.js', () => ({
    claimPendingDomainEvents: vi.fn().mockResolvedValue([]),
    deletePublishedDomainEvents: vi.fn().mockResolvedValue(0),
    loadDomainEvent: vi.fn().mockResolvedValue(null),
    markDomainEventPublished: vi.fn().mockResolvedValue(true),
    recordDomainEventPublishFailure: vi.fn().mockResolvedValue(true),
  }))
  vi.doMock('../../../src/deployment/installation-settings.js', () => ({
    loadPlannerScheduleOffset: vi.fn().mockResolvedValue(30_000),
  }))
  return import('../../../src/queue/platform.js')
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

async function waitForRedis() {
  await waitFor(async () => {
    const connection = new Redis(redisUrl, {
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

async function countJobs(queue: Queue, state: 'waiting' | 'completed' | 'failed', name: string) {
  return (await queue.getJobs([state])).filter((job) => job.name === name).length
}

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Timed out waiting for queue state')
}
