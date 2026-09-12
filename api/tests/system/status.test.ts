import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createFeatureExecutionMock } from '../support/mock-feature-execution.js'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  probeDomainEventStatus: vi.fn(),
  probeEsiStatus: vi.fn(),
  probeQueueStatus: vi.fn(),
  sql: vi.fn(),
}))

vi.mock('../../src/db/client.js', () => ({ sql: mocks.sql }))

vi.mock('../../src/esi-gateway/feature-execution.js', () => createFeatureExecutionMock(mocks.get))

vi.mock('../../src/esi-gateway/status-interface.js', () => ({
  isEsiErrorBudgetAtFloor: (remaining: number | null) => remaining !== null && remaining <= 10,
  probeEsiStatus: mocks.probeEsiStatus,
}))

vi.mock('../../src/domain-events/status.js', () => ({
  probeDomainEventStatus: mocks.probeDomainEventStatus,
}))

vi.mock('../../src/queue/status.js', () => ({ probeQueueStatus: mocks.probeQueueStatus }))

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-20T12:00:00.000Z'))
  mocks.get.mockImplementation(() => ({
    data: mappedStatus(),
    cachedUntil: '2026-08-20T12:01:00.000Z',
    validatedAt: '2026-08-20T12:00:00.000Z',
    quota: { errorRemaining: 99, errorResetSeconds: 10 },
    source: 'esi',
    stale: false,
  }))
  mocks.sql.mockResolvedValue([{ '?column?': 1 }])
  mocks.probeQueueStatus.mockResolvedValue(queueStatus())
  mocks.probeDomainEventStatus.mockResolvedValue(eventRelayStatus())
  mocks.probeEsiStatus.mockResolvedValue(resilienceTelemetry())
})

describe('system status service', () => {
  test('composes local API and database checks with a resilient Tranquility resource', async () => {
    const { getSystemStatus } = await import('../../src/system/status.js')

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
    expect(mocks.get.mock.calls[0]?.[1]).toEqual({})
    expect(mocks.get).toHaveBeenCalledOnce()
    const observationPending = mocks.probeEsiStatus.mock.calls[0]?.[0]
    await expect(observationPending).resolves.toEqual({ status: 'operational' })
  })

  test('passes stale refresh failure details to telemetry without exposing them in the service DTO', async () => {
    mocks.get.mockResolvedValue({
      data: mappedStatus(),
      cachedUntil: '2026-08-20T12:01:00.000Z',
      validatedAt: '2026-08-20T11:59:00.000Z',
      quota: { errorRemaining: 99, errorResetSeconds: 10 },
      source: 'cache',
      stale: true,
      refreshFailureClass: 'esi-unavailable',
    })
    const { getSystemStatus } = await import('../../src/system/status.js')

    const status = await getSystemStatus()

    expect(mocks.get).toHaveBeenCalledOnce()
    expect(mocks.probeEsiStatus).toHaveBeenCalledOnce()
    const observationPending = mocks.probeEsiStatus.mock.calls[0]?.[0]
    await expect(observationPending).resolves.toEqual({
      status: 'stale',
      refreshFailureClass: 'esi-unavailable',
    })
    expect(status.services.esi).not.toHaveProperty('refreshFailureClass')
  })

  test('degrades only at the gateway error-budget floor', async () => {
    mocks.get.mockResolvedValue({
      data: mappedStatus(),
      cachedUntil: '2026-08-20T12:01:00.000Z',
      validatedAt: '2026-08-20T12:00:00.000Z',
      quota: { errorRemaining: 11, errorResetSeconds: 10 },
      source: 'esi',
      stale: false,
    })
    const { getSystemStatus } = await import('../../src/system/status.js')

    await expect(getSystemStatus()).resolves.toMatchObject({
      services: { esi: { status: 'operational', errorBudgetRemaining: 11 } },
    })

    vi.resetModules()
    mocks.get.mockResolvedValue({
      data: mappedStatus(),
      cachedUntil: '2026-08-20T12:01:00.000Z',
      validatedAt: '2026-08-20T12:00:00.000Z',
      quota: { errorRemaining: 10, errorResetSeconds: 10 },
      source: 'esi',
      stale: false,
    })
    const { getSystemStatus: getLimitedSystemStatus } = await import('../../src/system/status.js')

    await expect(getLimitedSystemStatus()).resolves.toMatchObject({
      services: { esi: { status: 'degraded', errorBudgetRemaining: 10 } },
    })
  })

  test('uses the least-fresh ESI deadline for the composed status response', async () => {
    mocks.get.mockImplementation(() => ({
      data: mappedStatus(),
      cachedUntil: '2026-08-20T12:00:10.000Z',
      validatedAt: '2026-08-20T12:00:00.000Z',
      quota: {},
      source: 'cache',
      stale: false,
    }))
    const { getSystemStatus } = await import('../../src/system/status.js')

    await expect(getSystemStatus()).resolves.toMatchObject({
      cachedUntil: '2026-08-20T12:00:10.000Z',
    })
  })

  test('collapses concurrent probes and reuses the replica-local result for its TTL', async () => {
    const { getSystemStatus } = await import('../../src/system/status.js')

    await Promise.all([getSystemStatus(), getSystemStatus()])
    await getSystemStatus()
    expect(mocks.probeQueueStatus).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(30_001)
    await getSystemStatus()
    expect(mocks.probeQueueStatus).toHaveBeenCalledTimes(2)
  })

  test('degrades safely when local database or shared ESI data is unavailable', async () => {
    mocks.sql.mockRejectedValue(new Error('Database unavailable'))
    const { EsiTransportError } = await import('@evespace/esi-client')
    mocks.get.mockRejectedValue(
      new EsiTransportError({
        operationId: 'GetStatus',
        reason: 'network',
        phase: 'request',
        cause: new Error('ESI unavailable'),
      }),
    )
    const { getSystemStatus } = await import('../../src/system/status.js')

    await expect(getSystemStatus()).resolves.toMatchObject({
      status: 'unavailable',
      services: {
        database: { status: 'unavailable' },
        esi: { status: 'unavailable', players: null },
      },
    })
  })

  test.each([
    ['cooldown', 'esi-cooldown'],
    ['invalid response', 'response-invalid'],
  ] as const)(
    'reports a cold %s failure as degraded with its failure class',
    async (label, refreshFailureClass) => {
      const error =
        label === 'cooldown'
          ? new (await import('../../src/esi-gateway/failures.js')).EsiQuotaError(12)
          : new (await import('@evespace/esi-client')).EsiResponseValidationError({
              operationId: 'GetStatus',
              status: 200,
              issues: [],
            })
      mocks.get.mockRejectedValue(error)
      const { getSystemStatus } = await import('../../src/system/status.js')

      const status = await getSystemStatus()
      const observationPending = mocks.probeEsiStatus.mock.calls[0]?.[0]

      expect(status).toMatchObject({
        status: 'degraded',
        services: { esi: { status: 'degraded', players: null } },
      })
      expect(status.services.esi).not.toHaveProperty('refreshFailureClass')
      await expect(observationPending).resolves.toEqual({
        status: 'degraded',
        refreshFailureClass,
      })
    },
  )

  test('reports an unknown cold ESI failure as unavailable', async () => {
    mocks.sql.mockRejectedValue(new Error('Database unavailable'))
    mocks.get.mockRejectedValue(new Error('Unexpected ESI probe failure'))
    const { getSystemStatus } = await import('../../src/system/status.js')

    const status = await getSystemStatus()
    const observationPending = mocks.probeEsiStatus.mock.calls[0]?.[0]

    expect(status).toMatchObject({
      status: 'unavailable',
      services: {
        database: { status: 'unavailable' },
        esi: { status: 'unavailable', players: null },
      },
    })
    await expect(observationPending).resolves.toEqual({
      status: 'unavailable',
      refreshFailureClass: 'unknown',
    })
  })

  test('degrades cache and coordination telemetry before marking repeated outages unavailable', async () => {
    mocks.probeEsiStatus.mockResolvedValue({
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
    const { getSystemStatus } = await import('../../src/system/status.js')

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
    memoryUsedBytes: 53_687_091,
    memoryMaxBytes: 536_870_912,
    memoryUsedPercent: 10,
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

function mappedStatus() {
  return {
    players: 31_337,
    serverVersion: '2.5.7',
    startedAt: '2026-08-20T11:00:00Z',
    vip: false,
  }
}
