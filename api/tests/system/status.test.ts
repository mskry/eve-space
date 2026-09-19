import { EsiResponseValidationError, EsiTransportError } from '@evespace/esi-client'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { EsiQuotaError } from '../../src/esi-gateway/failures.js'
import { getSystemStatus } from '../../src/system/status.js'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  probeDomainEventStatus: vi.fn(),
  probeEsiStatus: vi.fn(),
  probeQueueStatus: vi.fn(),
  readStaticLocationRevision: vi.fn(),
  sql: vi.fn(),
}))

vi.mock('../../src/db/client.js', () => ({ sql: mocks.sql }))

vi.mock('../../src/esi-gateway/feature-execution.js', () => ({
  createPublicEsiRead: (definition: { operation: string }) => ({
    operation: definition.operation,
    requiredScope: null,
    execute: (input: unknown) => mocks.get(definition, input, undefined),
  }),
}))

vi.mock('../../src/esi-gateway/status-interface.js', () => ({
  isEsiErrorBudgetAtFloor: (remaining: number | null) => remaining !== null && remaining <= 10,
  probeEsiStatus: mocks.probeEsiStatus,
}))

vi.mock('../../src/domain-events/status.js', () => ({
  probeDomainEventStatus: mocks.probeDomainEventStatus,
}))

vi.mock('../../src/queue/status.js', () => ({ probeQueueStatus: mocks.probeQueueStatus }))

vi.mock('../../src/universe/static-location-store.js', () => ({
  readStaticLocationRevision: mocks.readStaticLocationRevision,
}))

const initialTime = Date.parse('2026-08-20T12:00:00.000Z')
let currentTime = initialTime - 120_000

beforeEach(() => {
  vi.useFakeTimers()
  currentTime += 120_000
  vi.setSystemTime(currentTime)
  mocks.get.mockImplementation(() => ({
    data: mappedStatus(),
    cachedUntil: new Date(currentTime + 60_000).toISOString(),
    validatedAt: new Date(currentTime).toISOString(),
    quota: { errorRemaining: 99, errorResetSeconds: 10 },
    source: 'esi',
    stale: false,
  }))
  mocks.sql.mockResolvedValue([{ '?column?': 1 }])
  mocks.probeQueueStatus.mockResolvedValue(queueStatus())
  mocks.probeDomainEventStatus.mockResolvedValue(eventRelayStatus())
  mocks.probeEsiStatus.mockResolvedValue(resilienceTelemetry())
  mocks.readStaticLocationRevision.mockResolvedValue({
    buildNumber: 3_503_375,
    ingestVersion: 4,
    ingestedAt: '2026-08-20T11:30:00.000Z',
  })
})

describe('system status service', () => {
  test('composes local API and database checks with a resilient Tranquility resource', async () => {
    await expect(getSystemStatus()).resolves.toMatchObject({
      status: 'operational',
      checkedAt: '2026-08-20T12:00:00.000Z',
      cachedUntil: '2026-08-20T12:00:30.000Z',
      services: {
        api: { status: 'operational', checkedAt: '2026-08-20T12:00:00.000Z' },
        database: { status: 'operational', checkedAt: '2026-08-20T12:00:00.000Z' },
        sde: {
          status: 'operational',
          checkedAt: '2026-08-20T12:00:00.000Z',
          buildNumber: 3_503_375,
          ingestVersion: 4,
          ingestedAt: '2026-08-20T11:30:00.000Z',
        },
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

    await expect(getSystemStatus()).resolves.toMatchObject({
      services: { esi: { status: 'operational', errorBudgetRemaining: 11 } },
    })

    await vi.advanceTimersByTimeAsync(30_001)
    mocks.get.mockResolvedValue({
      data: mappedStatus(),
      cachedUntil: '2026-08-20T12:01:00.000Z',
      validatedAt: '2026-08-20T12:00:00.000Z',
      quota: { errorRemaining: 10, errorResetSeconds: 10 },
      source: 'esi',
      stale: false,
    })

    await expect(getSystemStatus()).resolves.toMatchObject({
      services: { esi: { status: 'degraded', errorBudgetRemaining: 10 } },
    })
  })

  test('uses the least-fresh ESI deadline for the composed status response', async () => {
    const cachedUntil = new Date(currentTime + 10_000).toISOString()
    mocks.get.mockImplementation(() => ({
      data: mappedStatus(),
      cachedUntil,
      validatedAt: new Date(currentTime).toISOString(),
      quota: {},
      source: 'cache',
      stale: false,
    }))

    await expect(getSystemStatus()).resolves.toMatchObject({
      cachedUntil,
    })
  })

  test('collapses concurrent probes and reuses the replica-local result for its TTL', async () => {
    await Promise.all([getSystemStatus(), getSystemStatus()])
    await getSystemStatus()
    expect(mocks.probeQueueStatus).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(30_001)
    await getSystemStatus()
    expect(mocks.probeQueueStatus).toHaveBeenCalledTimes(2)
  })

  test('degrades safely when local database or shared ESI data is unavailable', async () => {
    mocks.sql.mockRejectedValue(new Error('Database unavailable'))
    mocks.get.mockRejectedValue(
      new EsiTransportError({
        operationId: 'GetStatus',
        reason: 'network',
        phase: 'request',
        cause: new Error('ESI unavailable'),
      }),
    )

    await expect(getSystemStatus()).resolves.toMatchObject({
      status: 'unavailable',
      services: {
        database: { status: 'unavailable' },
        esi: { status: 'unavailable', players: null },
      },
    })
  })

  test('degrades when the committed SDE projection is unavailable', async () => {
    mocks.readStaticLocationRevision.mockRejectedValue(new Error('Revision missing'))

    await expect(getSystemStatus()).resolves.toMatchObject({
      status: 'degraded',
      services: {
        sde: {
          status: 'unavailable',
          buildNumber: null,
          ingestVersion: null,
          ingestedAt: null,
        },
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
          ? new EsiQuotaError(12)
          : new EsiResponseValidationError({
              operationId: 'GetStatus',
              status: 200,
              issues: [],
            })
      mocks.get.mockRejectedValue(error)

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
