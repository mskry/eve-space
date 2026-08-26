import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  connection: {
    ping: vi.fn(),
    get: vi.fn(),
    smembers: vi.fn(),
    mget: vi.fn(),
  },
  queue: {
    close: vi.fn(),
    getJobCounts: vi.fn(),
    getJobSchedulersCount: vi.fn(),
    getJobs: vi.fn(),
  },
}))

vi.mock('bullmq', () => ({
  Queue: function Queue() {
    return mocks.queue
  },
}))
vi.mock('../src/queue/redis.js', () => ({
  createProbeRedisConnection: () => mocks.connection,
  closeQueueRedisConnection: mocks.close,
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
  mocks.queue.close.mockReset()
  mocks.queue.getJobCounts.mockReset()
  mocks.queue.getJobs.mockReset()
  mocks.close.mockReset()
  mocks.connection.ping.mockResolvedValue('PONG')
  withHeartbeats({ 'worker-a': '2026-08-20T12:00:00.000Z' })
  mocks.connection.get
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(
      JSON.stringify({
        outcome: 'published',
        category: null,
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
    waiting: 1,
    delayed: 2,
    prioritized: 2,
    active: 3,
    failed: 4,
  })
  mocks.queue.getJobs.mockImplementation(async ([state]: string[]) => {
    if (state === 'waiting') return [{ attemptsMade: 0, timestamp: Date.now() - 5_000 }]
    if (state === 'prioritized')
      return [
        { attemptsMade: 0, timestamp: Date.now() - 10_000 },
        { attemptsMade: 0, timestamp: Date.now() - 2_000 },
      ]
    return [{ attemptsMade: 0 }, { attemptsMade: 1 }]
  })
})

describe('queue telemetry probe', () => {
  test('reports safe aggregate queue telemetry', async () => {
    const { probeQueueStatus } = await import('../src/queue/status.js')

    const status = await probeQueueStatus()
    expect(status).toMatchObject({
      status: 'degraded',
      depth: 5,
      active: 3,
      retrying: 1,
      failed: 4,
      plannerPaused: false,
      outboxRelayPaused: false,
      latestOutboxRelayOutcome: {
        outcome: 'published',
        category: null,
        recordedAt: '2026-08-20T12:00:00.000Z',
      },
      latestSchedulerOutcome: 'registered',
      latestAffiliationPlannerOutcome: {
        outcome: 'scheduled',
        planned: 2,
        recordedAt: '2026-08-20T12:00:00.000Z',
      },
    })
    expect(status.oldestWaitingAgeSeconds).toBeGreaterThanOrEqual(9)
    expect(mocks.queue.getJobs).toHaveBeenCalledWith(['waiting'], 0, 0, true)
    expect(mocks.queue.getJobs).toHaveBeenCalledWith(['prioritized'], 0, 1_000, true)
    expect(mocks.queue.getJobs).toHaveBeenCalledWith(['delayed'], 0, 1_000, true)
  })

  test('does not expose connection details when Redis is unavailable', async () => {
    mocks.connection.ping.mockRejectedValueOnce(new Error('redis://secret-host:6379 unavailable'))
    const { probeQueueStatus } = await import('../src/queue/status.js')

    await expect(probeQueueStatus()).resolves.toEqual({
      status: 'unavailable',
      workerHeartbeatAt: null,
      workers: null,
      depth: null,
      oldestWaitingAgeSeconds: null,
      active: null,
      retrying: null,
      failed: null,
      plannerPaused: false,
      outboxRelayPaused: false,
      latestOutboxRelayOutcome: null,
      latestSchedulerOutcome: null,
      latestAffiliationPlannerOutcome: null,
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
    mocks.queue.getJobCounts.mockResolvedValue({ waiting: 0, delayed: 0, active: 0, failed: 0 })
    mocks.queue.getJobs.mockResolvedValue([])
    const { probeQueueStatus } = await import('../src/queue/status.js')

    await expect(probeQueueStatus()).resolves.toMatchObject({
      status: 'operational',
      workers: 1,
      depth: 0,
      oldestWaitingAgeSeconds: null,
      plannerPaused: true,
      outboxRelayPaused: true,
      latestSchedulerOutcome: null,
    })
  })

  test('treats a malformed heartbeat as stale', async () => {
    withHeartbeats({ 'worker-a': 'not-a-date' })
    mocks.queue.getJobCounts.mockResolvedValue({ waiting: 0, delayed: 1, active: 0, failed: 0 })
    mocks.queue.getJobs.mockResolvedValue([])
    const { probeQueueStatus } = await import('../src/queue/status.js')

    await expect(probeQueueStatus()).resolves.toMatchObject({
      status: 'degraded',
      retrying: 0,
      workerHeartbeatAt: 'not-a-date',
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
    mocks.queue.getJobCounts.mockResolvedValue({ waiting: 0, delayed: 0, active: 0, failed: 0 })
    mocks.queue.getJobs.mockResolvedValue([])
    const { probeQueueStatus } = await import('../src/queue/status.js')

    await expect(probeQueueStatus()).resolves.toMatchObject({
      status: 'operational',
      latestOutboxRelayOutcome: null,
      latestAffiliationPlannerOutcome: null,
    })
  })

  test('reports the freshest beat and live replica count across workers', async () => {
    const fresh = new Date().toISOString()
    withHeartbeats({
      'worker-a': '2026-08-20T12:00:00.000Z',
      'worker-b': fresh,
      'worker-c': null,
    })
    mocks.queue.getJobCounts.mockResolvedValue({ waiting: 0, delayed: 0, active: 0, failed: 0 })
    mocks.queue.getJobs.mockResolvedValue([])
    const { probeQueueStatus } = await import('../src/queue/status.js')

    await expect(probeQueueStatus()).resolves.toMatchObject({
      status: 'operational',
      workerHeartbeatAt: fresh,
      workers: 2,
    })
  })

  test('scopes worker liveness to one replica when asked', async () => {
    withHeartbeats({ 'worker-a': new Date().toISOString(), 'stuck-worker': null })
    mocks.queue.getJobCounts.mockResolvedValue({ waiting: 0, delayed: 0, active: 0, failed: 0 })
    mocks.queue.getJobs.mockResolvedValue([])
    const { probeQueueStatus } = await import('../src/queue/status.js')

    // A healthy sibling must not vouch for the stuck replica.
    await expect(probeQueueStatus('stuck-worker')).resolves.toMatchObject({
      status: 'degraded',
      workerHeartbeatAt: null,
      workers: 0,
    })
    expect(mocks.connection.smembers).not.toHaveBeenCalled()
    expect(mocks.connection.mget).toHaveBeenCalledWith([
      'eve-space:v1:worker:heartbeat:stuck-worker',
    ])
  })

  test('reports no workers when the registry is empty', async () => {
    withHeartbeats({})
    mocks.queue.getJobCounts.mockResolvedValue({ waiting: 0, delayed: 0, active: 0, failed: 0 })
    mocks.queue.getJobs.mockResolvedValue([])
    const { probeQueueStatus } = await import('../src/queue/status.js')

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
    const { probeQueueStatus } = await import('../src/queue/status.js')

    await expect(probeQueueStatus()).resolves.toMatchObject({ status: 'unavailable' })
  })
})
