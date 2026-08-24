import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createStatusClient: vi.fn(),
  get: vi.fn(),
  getStatus: vi.fn(),
  probeDomainEventStatus: vi.fn(),
  probeEsiResilienceTelemetry: vi.fn(),
  probeQueueStatus: vi.fn(),
  sql: vi.fn(),
}))

vi.mock('@evespace/esi-client/domains/status', () => ({
  createStatusClient: mocks.createStatusClient,
}))

vi.mock('../src/db/client.js', () => ({ sql: mocks.sql }))

vi.mock('../src/esi-resilience/resilience.js', () => ({
  getEsiResilienceLayer: () => ({ get: mocks.get }),
}))

vi.mock('../src/esi-resilience/transport.js', () => ({ createEsiTransport: vi.fn() }))

vi.mock('../src/esi-resilience/telemetry.js', () => ({
  probeEsiResilienceTelemetry: mocks.probeEsiResilienceTelemetry,
}))

vi.mock('../src/domain-event-status.js', () => ({
  probeDomainEventStatus: mocks.probeDomainEventStatus,
}))

vi.mock('../src/queue/status.js', () => ({ probeQueueStatus: mocks.probeQueueStatus }))

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-20T12:00:00.000Z'))
  mocks.createStatusClient.mockReturnValue({
    withMetadata: () => ({ get: mocks.getStatus }),
  })
  mocks.get.mockImplementation(async (resource) => {
    const response = await resource.load({})
    return {
      data: response.data,
      cachedUntil: '2026-08-20T12:01:00.000Z',
      quota: { errorRemaining: 99, errorResetSeconds: 10 },
      source: 'esi',
      stale: false,
    }
  })
  mocks.sql.mockResolvedValue([{ '?column?': 1 }])
  mocks.getStatus.mockResolvedValue(statusResponse())
  mocks.probeQueueStatus.mockResolvedValue(queueStatus())
  mocks.probeDomainEventStatus.mockResolvedValue(eventRelayStatus())
  mocks.probeEsiResilienceTelemetry.mockResolvedValue(resilienceTelemetry())
})

describe('system status service', () => {
  test('composes local API and database checks with a resilient Tranquility resource', async () => {
    const { getSystemStatus } = await import('../src/system-status-service.js')

    await expect(getSystemStatus()).resolves.toMatchObject({
      status: 'operational',
      checkedAt: '2026-08-20T12:00:00.000Z',
      cachedUntil: '2026-08-20T12:00:30.000Z',
      services: {
        api: { status: 'operational', checkedAt: '2026-08-20T12:00:00.000Z' },
        database: { status: 'operational', checkedAt: '2026-08-20T12:00:00.000Z' },
        esi: { status: 'operational', players: 31_337 },
        queue: { checkedAt: '2026-08-20T12:00:00.000Z' },
        eventRelay: { checkedAt: '2026-08-20T12:00:00.000Z' },
        esiResilience: {
          cache: { status: 'operational' },
          coordination: { status: 'operational' },
        },
      },
    })
    expect(mocks.get.mock.calls[0]?.[0]).toMatchObject({
      operation: 'status',
      resource: 'tranquility-status',
    })
  })

  test('uses the least-fresh ESI deadline for the composed status response', async () => {
    mocks.get.mockImplementation(async (resource) => {
      const response = await resource.load({})
      return {
        data: response.data,
        cachedUntil: '2026-08-20T12:00:10.000Z',
        quota: {},
        source: 'cache',
        stale: false,
      }
    })
    const { getSystemStatus } = await import('../src/system-status-service.js')

    await expect(getSystemStatus()).resolves.toMatchObject({
      cachedUntil: '2026-08-20T12:00:10.000Z',
    })
  })

  test('collapses concurrent probes and reuses the replica-local result for its TTL', async () => {
    const { getSystemStatus } = await import('../src/system-status-service.js')

    await Promise.all([getSystemStatus(), getSystemStatus()])
    await getSystemStatus()
    expect(mocks.probeQueueStatus).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(30_001)
    await getSystemStatus()
    expect(mocks.probeQueueStatus).toHaveBeenCalledTimes(2)
  })

  test('degrades safely when local database or shared ESI data is unavailable', async () => {
    mocks.sql.mockRejectedValue(new Error('Database unavailable'))
    mocks.get.mockRejectedValue(new Error('ESI unavailable'))
    const { getSystemStatus } = await import('../src/system-status-service.js')

    await expect(getSystemStatus()).resolves.toMatchObject({
      status: 'unavailable',
      services: {
        database: { status: 'unavailable' },
        esi: { status: 'unavailable', players: null },
      },
    })
  })

  test('degrades cache and coordination telemetry before marking repeated outages unavailable', async () => {
    mocks.probeEsiResilienceTelemetry.mockResolvedValue({
      ...resilienceTelemetry(),
      cache: { status: 'degraded', checkedAt: '2026-08-20T12:00:00.000Z' },
      coordination: { status: 'unavailable', checkedAt: '2026-08-20T12:00:00.000Z' },
      cooldown: {
        status: 'unavailable',
        checkedAt: '2026-08-20T12:00:00.000Z',
        globalRetryAt: null,
        activeOperations: [],
      },
      upstream: { status: 'unavailable', checkedAt: '2026-08-20T12:00:00.000Z', operations: [] },
    })
    const { getSystemStatus } = await import('../src/system-status-service.js')

    await expect(getSystemStatus()).resolves.toMatchObject({
      status: 'degraded',
      services: {
        esiResilience: {
          cache: { status: 'degraded' },
          coordination: { status: 'unavailable' },
        },
      },
    })
  })
})

function statusResponse() {
  return {
    data: {
      players: 31_337,
      server_version: '2.5.7',
      start_time: '2026-08-20T11:00:00Z',
      vip: false,
    },
    meta: { headers: {} },
  }
}

function queueStatus() {
  return {
    status: 'operational' as const,
    workerHeartbeatAt: '2026-08-20T12:00:00.000Z',
    workers: 1,
    depth: 0,
    oldestWaitingAgeSeconds: null,
    active: 0,
    retrying: 0,
    failed: 0,
    plannerPaused: false,
    outboxRelayPaused: false,
    latestOutboxRelayOutcome: null,
    latestSchedulerOutcome: 'registered' as const,
  }
}

function eventRelayStatus() {
  return {
    status: 'operational' as const,
    pendingCount: 0,
    oldestPendingAgeSeconds: null,
    relayPaused: false,
    latestRelayOutcome: null,
  }
}

function resilienceTelemetry() {
  return {
    checkedAt: '2026-08-20T12:00:00.000Z',
    cache: { status: 'operational' as const, checkedAt: '2026-08-20T12:00:00.000Z' },
    coordination: { status: 'operational' as const, checkedAt: '2026-08-20T12:00:00.000Z' },
    cooldown: {
      status: 'inactive' as const,
      checkedAt: '2026-08-20T12:00:00.000Z',
      globalRetryAt: null,
      activeOperations: [],
    },
    upstream: {
      status: 'operational' as const,
      checkedAt: '2026-08-20T12:00:00.000Z',
      operations: [],
    },
  }
}
