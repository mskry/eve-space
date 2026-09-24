import { beforeEach, describe, expect, test, vi } from 'vitest'
import { workerHeartbeatStaleAfterMs } from '../../src/queue/policy.js'

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  connection: {
    config: vi.fn(),
    get: vi.fn(),
    info: vi.fn(),
    mget: vi.fn(),
    ping: vi.fn(),
    smembers: vi.fn(),
  },
  createProbe: vi.fn(),
  queue: {
    close: vi.fn(),
    getJobCounts: vi.fn(),
    getJobSchedulersCount: vi.fn(),
    getJobs: vi.fn(),
    on: vi.fn(),
  },
}))

vi.mock('bullmq', () => ({
  Queue: function Queue() {
    return mocks.queue
  },
}))
vi.mock('../../src/coordination-redis.js', () => ({
  closeCoordinationRedisConnection: mocks.close,
  createCoordinationRedisProbe: mocks.createProbe,
}))

/** Heartbeats now live one key per replica behind a registry set. */
function withHeartbeats(beats: Record<string, string | null>) {
  mocks.connection.smembers.mockResolvedValue(Object.keys(beats))
  mocks.connection.mget.mockImplementation(async (keys: string[]) =>
    keys.map((key) => beats[key.replace('eve-space:v1:worker:heartbeat:', '')] ?? null),
  )
}

beforeEach(() => {
  vi.resetModules()
  mocks.connection.ping.mockReset()
  mocks.connection.get.mockReset()
  mocks.connection.smembers.mockReset()
  mocks.connection.mget.mockReset()
  mocks.connection.info.mockReset()
  mocks.connection.config.mockReset()
  mocks.createProbe.mockReset()
  mocks.queue.close.mockReset()
  mocks.queue.getJobCounts.mockReset()
  mocks.queue.getJobs.mockReset()
  mocks.queue.on.mockReset()
  mocks.close.mockReset()
  mocks.queue.close.mockResolvedValue(undefined)
  mocks.close.mockResolvedValue(undefined)
  mocks.createProbe.mockReturnValue(mocks.connection)
  mocks.connection.ping.mockResolvedValue('PONG')
  mocks.connection.info.mockResolvedValue('# Memory\r\nused_memory:53687091\r\n')
  mocks.connection.config.mockResolvedValue(['maxmemory', '536870912'])
  withHeartbeats({ 'worker-a': '2026-08-20T12:00:00.000Z' })
  mocks.connection.get
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(
      JSON.stringify({
        category: null,
        outcome: 'published',
        recordedAt: '2026-08-20T12:00:00.000Z',
      }),
    )
    .mockResolvedValueOnce('registered')
    .mockResolvedValueOnce(
      JSON.stringify({
        outcome: 'scheduled',
        planned: 2,
        recordedAt: '2026-08-20T12:00:00.000Z',
      }),
    )
  mocks.queue.getJobCounts.mockResolvedValue({
    active: 3,
    delayed: 2,
    failed: 4,
    prioritized: 2,
    waiting: 1,
  })
  mocks.queue.getJobs.mockImplementation(async ([state]: string[]) => {
    if (state === 'waiting') {
      return [{ attemptsMade: 0, timestamp: Date.now() - 5000 }]
    }
    if (state === 'prioritized') {
      return [
        { attemptsMade: 0, timestamp: Date.now() - 10_000 },
        { attemptsMade: 0, timestamp: Date.now() - 2000 },
      ]
    }
    return [{ attemptsMade: 0 }, { attemptsMade: 1 }]
  })
})

describe('queue telemetry probe', () => {
  test('reports safe aggregate queue telemetry', async () => {
    const { probeQueueStatus } = await import('../../src/queue/status.js')

    const status = await probeQueueStatus()
    expect(status).toMatchObject({
      active: 3,
      depth: 5,
      failed: 4,
      latestAffiliationPlannerOutcome: {
        outcome: 'scheduled',
        planned: 2,
        recordedAt: '2026-08-20T12:00:00.000Z',
      },
      latestOutboxRelayOutcome: {
        category: null,
        outcome: 'published',
        recordedAt: '2026-08-20T12:00:00.000Z',
      },
      latestSchedulerOutcome: 'registered',
      memoryMaxBytes: 536_870_912,
      memoryUsedBytes: 53_687_091,
      memoryUsedPercent: 10,
      outboxRelayPaused: false,
      plannerPaused: false,
      retrying: 1,
      status: 'degraded',
    })
    expect(status.oldestWaitingAgeSeconds).toBeGreaterThanOrEqual(9)
    expect(mocks.queue.getJobs).toHaveBeenCalledWith(['waiting'], 0, 0, true)
    expect(mocks.queue.getJobs).toHaveBeenCalledWith(['prioritized'], 0, 1000, true)
    expect(mocks.queue.getJobs).toHaveBeenCalledWith(['delayed'], 0, 1000, true)
  })

  test('does not expose connection details when Redis is unavailable', async () => {
    mocks.connection.ping.mockRejectedValueOnce(new Error('redis://secret-host:6379 unavailable'))
    const { probeQueueStatus } = await import('../../src/queue/status.js')

    await expect(probeQueueStatus()).resolves.toStrictEqual({
      active: null,
      depth: null,
      failed: null,
      latestAffiliationPlannerOutcome: null,
      latestOutboxRelayOutcome: null,
      latestSchedulerOutcome: null,
      memoryMaxBytes: null,
      memoryUsedBytes: null,
      memoryUsedPercent: null,
      oldestWaitingAgeSeconds: null,
      outboxRelayPaused: false,
      plannerPaused: false,
      retrying: null,
      status: 'unavailable',
      workerHeartbeatAt: null,
      workers: null,
    })
  })

  test('reports a healthy empty queue with a current heartbeat', async () => {
    withHeartbeats({ 'worker-a': new Date().toISOString() })
    mocks.connection.get.mockReset()
    mocks.connection.get
      .mockResolvedValueOnce('paused')
      .mockResolvedValueOnce('paused')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    mocks.queue.getJobCounts.mockResolvedValue({ active: 0, delayed: 0, failed: 0, waiting: 0 })
    mocks.queue.getJobs.mockResolvedValue([])
    const { probeQueueStatus } = await import('../../src/queue/status.js')

    await expect(probeQueueStatus()).resolves.toMatchObject({
      depth: 0,
      latestSchedulerOutcome: null,
      oldestWaitingAgeSeconds: null,
      outboxRelayPaused: true,
      plannerPaused: true,
      status: 'operational',
      workers: 1,
    })
  })

  test('treats a malformed heartbeat as stale', async () => {
    withHeartbeats({ 'worker-a': 'not-a-date' })
    mocks.queue.getJobCounts.mockResolvedValue({ active: 0, delayed: 1, failed: 0, waiting: 0 })
    mocks.queue.getJobs.mockResolvedValue([])
    const { probeQueueStatus } = await import('../../src/queue/status.js')

    await expect(probeQueueStatus()).resolves.toMatchObject({
      retrying: 0,
      status: 'degraded',
      workerHeartbeatAt: null,
      workers: 0,
    })
  })

  test.each([
    '2026-09-10',
    new Date(Date.now() - workerHeartbeatStaleAfterMs - 1).toISOString(),
    new Date(Date.now() + workerHeartbeatStaleAfterMs * 2).toISOString(),
  ])('does not expose or count invalid heartbeat %s', async (heartbeat) => {
    withHeartbeats({ 'worker-a': heartbeat })
    mocks.queue.getJobCounts.mockResolvedValue({ active: 0, delayed: 0, failed: 0, waiting: 0 })
    mocks.queue.getJobs.mockResolvedValue([])
    const { probeQueueStatus } = await import('../../src/queue/status.js')

    await expect(probeQueueStatus()).resolves.toMatchObject({
      status: 'degraded',
      workerHeartbeatAt: null,
      workers: 0,
    })
  })

  test('degrades aggregate status for backlog while a replica heartbeat is fresh', async () => {
    withHeartbeats({ 'worker-a': new Date().toISOString() })
    mocks.queue.getJobCounts.mockResolvedValue({ active: 0, delayed: 0, failed: 0, waiting: 1 })
    mocks.queue.getJobs.mockImplementation(async ([state]: string[]) =>
      state === 'waiting'
        ? [
            {
              attemptsMade: 0,
              timestamp:
                Date.now() - (Number(process.env.QUEUE_LAG_DEGRADED_SECONDS ?? 300) + 1) * 1000,
            },
          ]
        : [],
    )
    const { probeQueueStatus } = await import('../../src/queue/status.js')

    await expect(probeQueueStatus()).resolves.toMatchObject({
      status: 'degraded',
      workers: 1,
    })
  })

  test('degrades before queue Redis reaches its noeviction limit', async () => {
    withHeartbeats({ 'worker-a': new Date().toISOString() })
    mocks.connection.info.mockResolvedValue('# Memory\r\nused_memory:483183821\r\n')
    mocks.queue.getJobCounts.mockResolvedValue({ active: 0, delayed: 0, failed: 0, waiting: 0 })
    mocks.queue.getJobs.mockResolvedValue([])
    const { probeQueueStatus } = await import('../../src/queue/status.js')

    await expect(probeQueueStatus()).resolves.toMatchObject({
      memoryMaxBytes: 536_870_912,
      memoryUsedBytes: 483_183_821,
      memoryUsedPercent: 90,
      status: 'degraded',
    })
  })

  test('discards malformed relay outcomes instead of exposing Redis contents', async () => {
    withHeartbeats({ 'worker-a': new Date().toISOString() })
    mocks.connection.get.mockReset()
    mocks.connection.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('redis://private-host payload')
      .mockResolvedValueOnce('registered')
      .mockResolvedValueOnce('redis://private-host payload')
    mocks.queue.getJobCounts.mockResolvedValue({ active: 0, delayed: 0, failed: 0, waiting: 0 })
    mocks.queue.getJobs.mockResolvedValue([])
    const { probeQueueStatus } = await import('../../src/queue/status.js')

    await expect(probeQueueStatus()).resolves.toMatchObject({
      latestAffiliationPlannerOutcome: null,
      latestOutboxRelayOutcome: null,
      status: 'operational',
    })
  })

  test('reports the freshest beat and live replica count across workers', async () => {
    const fresh = new Date().toISOString()
    withHeartbeats({
      'worker-a': '2026-08-20T12:00:00.000Z',
      'worker-b': fresh,
      'worker-c': null,
    })
    mocks.queue.getJobCounts.mockResolvedValue({ active: 0, delayed: 0, failed: 0, waiting: 0 })
    mocks.queue.getJobs.mockResolvedValue([])
    const { probeQueueStatus } = await import('../../src/queue/status.js')

    await expect(probeQueueStatus()).resolves.toMatchObject({
      status: 'operational',
      workerHeartbeatAt: fresh,
      workers: 1,
    })
  })

  test('reports no workers when the registry is empty', async () => {
    withHeartbeats({})
    mocks.queue.getJobCounts.mockResolvedValue({ active: 0, delayed: 0, failed: 0, waiting: 0 })
    mocks.queue.getJobs.mockResolvedValue([])
    const { probeQueueStatus } = await import('../../src/queue/status.js')

    await expect(probeQueueStatus()).resolves.toMatchObject({
      status: 'degraded',
      workerHeartbeatAt: null,
      workers: 0,
    })
    expect(mocks.connection.mget).not.toHaveBeenCalled()
  })

  test('does not leak cleanup failures from a dependency probe', async () => {
    mocks.connection.ping.mockRejectedValueOnce(new Error('unavailable'))
    mocks.queue.close.mockRejectedValueOnce(new Error('close failed'))
    mocks.close.mockRejectedValueOnce(new Error('quit failed'))
    const { probeQueueStatus } = await import('../../src/queue/status.js')

    await expect(probeQueueStatus()).resolves.toMatchObject({ status: 'unavailable' })
  })

  test('contains synchronous probe-construction failures', async () => {
    mocks.createProbe.mockImplementationOnce(() => {
      throw new Error('redis://user:password@private-host unavailable')
    })
    const { probeQueueStatus } = await import('../../src/queue/status.js')

    const status = await probeQueueStatus()

    expect(status).toMatchObject({ status: 'unavailable' })
    expect(JSON.stringify(status)).not.toContain('private-host')
  })
})
