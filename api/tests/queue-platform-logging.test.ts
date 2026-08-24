import { beforeEach, describe, expect, test, vi } from 'vitest'

const eventId = '98a782d2-e042-47d7-9659-03b218121a1a'
const mocks = vi.hoisted(() => {
  const queue = {
    close: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  }
  const worker = {
    close: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    pause: vi.fn().mockResolvedValue(undefined),
    run: vi.fn().mockReturnValue(new Promise(() => {})),
  }
  return {
    connection: { disconnect: vi.fn() },
    failedListener: undefined as ((job: unknown, error: Error) => void) | undefined,
    process: vi.fn().mockResolvedValue(undefined),
    processor: undefined as ((job: unknown) => Promise<void>) | undefined,
    queue,
    stopHeartbeat: vi.fn(),
    worker,
  }
})

vi.mock('bullmq', () => ({
  DelayedError: class DelayedError extends Error {},
  Queue: function Queue() {
    return mocks.queue
  },
  UnrecoverableError: class UnrecoverableError extends Error {},
  Worker: function Worker(_name: string, processor: (job: unknown) => Promise<void>) {
    mocks.processor = processor
    return mocks.worker
  },
}))
vi.mock('../src/deployment-installation-settings.js', () => ({
  loadPlannerScheduleOffset: vi.fn().mockResolvedValue(0),
}))
vi.mock('../src/domain-event-handlers.js', () => ({ verifyDomainEventHandlers: vi.fn() }))
vi.mock('../src/queue/job-registry.js', () => ({
  getJobDefinition: vi.fn(() => ({
    name: 'domain-event',
    classifyError: vi.fn(() => 'retryable'),
    process: mocks.process,
  })),
  jobOptions: vi.fn(() => ({})),
  validateJobPayload: vi.fn((_definition, payload) => payload),
  verifyJobRegistry: vi.fn(),
}))
vi.mock('../src/queue/redis.js', () => ({
  closeQueueRedisConnection: vi.fn().mockResolvedValue(undefined),
  createProducerRedisConnection: vi.fn(() => mocks.connection),
  createWorkerRedisConnection: vi.fn(() => mocks.connection),
}))
vi.mock('../src/queue/scheduler.js', () => ({
  createPlannerRepeatStrategy: vi.fn(() => vi.fn()),
  getJobScheduler: vi.fn(() => undefined),
  plannerInitialDelay: vi.fn().mockResolvedValue(0),
  registerSchedulers: vi.fn().mockResolvedValue(undefined),
  runWithSchedulerOverlapPolicy: vi.fn(),
}))
vi.mock('../src/queue/worker-lifecycle.js', () => ({
  createActiveJobTracker: vi.fn(() => ({
    run: (operation: () => Promise<void>) => operation(),
    waitForIdle: vi.fn().mockResolvedValue(true),
  })),
  startWorkerHeartbeat: vi.fn().mockResolvedValue(mocks.stopHeartbeat),
}))

describe('worker platform event logging', () => {
  beforeEach(() => {
    mocks.worker.on.mockImplementation((event: string, listener: typeof mocks.failedListener) => {
      if (event === 'failed') mocks.failedListener = listener
    })
  })

  test('logs stable event identity without raw payloads or dependency errors', async () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { startWorkerPlatform } = await import('../src/queue/platform.js')
    const platform = await startWorkerPlatform()
    const job = {
      name: 'domain-event',
      data: {
        eventId,
        payload: { characterName: 'Payload Pilot', refreshToken: 'not-for-logs' },
      },
    }

    await mocks.processor?.(job)
    mocks.failedListener?.(job, new Error('redis://private-host:6379'))

    expect(consoleInfo).toHaveBeenCalledWith('Domain event job processed', { eventId })
    expect(consoleError).toHaveBeenCalledWith('Worker job failed', {
      jobName: 'domain-event',
      eventId,
      category: 'retryable dependency failure',
      reason: 'retryable dependency failure',
    })
    const serializedLogs = JSON.stringify([...consoleInfo.mock.calls, ...consoleError.mock.calls])
    expect(serializedLogs).not.toContain('Payload Pilot')
    expect(serializedLogs).not.toContain('refreshToken')
    expect(serializedLogs).not.toContain('private-host')

    await platform.close()
  })

  test('defers affiliation work until the shared ESI cooldown expires without consuming an attempt', async () => {
    const { AffiliationCooldownError } = await import('../src/affiliation-sync.js')
    const { startWorkerPlatform } = await import('../src/queue/platform.js')
    const platform = await startWorkerPlatform()
    const moveToDelayed = vi.fn().mockResolvedValue(undefined)
    mocks.process.mockRejectedValueOnce(new AffiliationCooldownError(30))

    await expect(
      mocks.processor?.({
        name: 'affiliation',
        data: { operationId: 'affiliation-1', characterIds: [1] },
        moveToDelayed,
        token: 'worker-token',
      }),
    ).rejects.toThrow('ESI cooldown deferred')
    expect(moveToDelayed).toHaveBeenCalledWith(expect.any(Number), 'worker-token')
    const delayedAt = moveToDelayed.mock.calls[0]?.[0] as number
    expect(delayedAt).toBeGreaterThanOrEqual(Date.now() + 29_000)

    await platform.close()
  })
})
