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
    execute: (input: unknown) => mocks.get(definition, input, undefined),
    operation: definition.operation,
    requiredScope: null,
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
    cachedUntil: new Date(currentTime + 60_000).toISOString(),
    data: mappedStatus(),
    quota: { errorRemaining: 99, errorResetSeconds: 10 },
    source: 'esi',
    stale: false,
    validatedAt: new Date(currentTime).toISOString(),
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
      cachedUntil: '2026-08-20T12:00:30.000Z',
      checkedAt: '2026-08-20T12:00:00.000Z',
      services: {
        api: { checkedAt: '2026-08-20T12:00:00.000Z', status: 'operational' },
        database: { checkedAt: '2026-08-20T12:00:00.000Z', status: 'operational' },
        esi: { players: 31_337, status: 'operational' },
        esiResilience: {
          cache: { status: 'operational' },
          coordination: { status: 'operational' },
        },
        eventRelay: { checkedAt: '2026-08-20T12:00:00.000Z' },
        queue: { checkedAt: '2026-08-20T12:00:00.000Z' },
        sde: {
          buildNumber: 3_503_375,
          checkedAt: '2026-08-20T12:00:00.000Z',
          ingestVersion: 4,
          ingestedAt: '2026-08-20T11:30:00.000Z',
          status: 'operational',
        },
      },
      status: 'operational',
    })
    expect(mocks.get.mock.calls[0]?.[1]).toStrictEqual({})
    expect(mocks.get).toHaveBeenCalledOnce()
    const observationPending = mocks.probeEsiStatus.mock.calls[0]?.[0]
    await expect(observationPending).resolves.toStrictEqual({ status: 'operational' })
  })

  test('passes stale refresh failure details to telemetry without exposing them in the service DTO', async () => {
    mocks.get.mockResolvedValue({
      cachedUntil: '2026-08-20T12:01:00.000Z',
      data: mappedStatus(),
      quota: { errorRemaining: 99, errorResetSeconds: 10 },
      refreshFailureClass: 'esi-unavailable',
      source: 'cache',
      stale: true,
      validatedAt: '2026-08-20T11:59:00.000Z',
    })

    const status = await getSystemStatus()

    expect(mocks.get).toHaveBeenCalledOnce()
    expect(mocks.probeEsiStatus).toHaveBeenCalledOnce()
    const observationPending = mocks.probeEsiStatus.mock.calls[0]?.[0]
    await expect(observationPending).resolves.toStrictEqual({
      refreshFailureClass: 'esi-unavailable',
      status: 'stale',
    })
    expect(status.services.esi).not.toHaveProperty('refreshFailureClass')
  })

  test('degrades only at the gateway error-budget floor', async () => {
    mocks.get.mockResolvedValue({
      cachedUntil: '2026-08-20T12:01:00.000Z',
      data: mappedStatus(),
      quota: { errorRemaining: 11, errorResetSeconds: 10 },
      source: 'esi',
      stale: false,
      validatedAt: '2026-08-20T12:00:00.000Z',
    })

    await expect(getSystemStatus()).resolves.toMatchObject({
      services: { esi: { errorBudgetRemaining: 11, status: 'operational' } },
    })

    await vi.advanceTimersByTimeAsync(30_001)
    mocks.get.mockResolvedValue({
      cachedUntil: '2026-08-20T12:01:00.000Z',
      data: mappedStatus(),
      quota: { errorRemaining: 10, errorResetSeconds: 10 },
      source: 'esi',
      stale: false,
      validatedAt: '2026-08-20T12:00:00.000Z',
    })

    await expect(getSystemStatus()).resolves.toMatchObject({
      services: { esi: { errorBudgetRemaining: 10, status: 'degraded' } },
    })
  })

  test('uses the least-fresh ESI deadline for the composed status response', async () => {
    const cachedUntil = new Date(currentTime + 10_000).toISOString()
    mocks.get.mockImplementation(() => ({
      cachedUntil,
      data: mappedStatus(),
      quota: {},
      source: 'cache',
      stale: false,
      validatedAt: new Date(currentTime).toISOString(),
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
        cause: new Error('ESI unavailable'),
        operationId: 'GetStatus',
        phase: 'request',
        reason: 'network',
      }),
    )

    await expect(getSystemStatus()).resolves.toMatchObject({
      services: {
        database: { status: 'unavailable' },
        esi: { players: null, status: 'unavailable' },
      },
      status: 'unavailable',
    })
  })

  test('degrades when the committed SDE projection is unavailable', async () => {
    mocks.readStaticLocationRevision.mockRejectedValue(new Error('Revision missing'))

    await expect(getSystemStatus()).resolves.toMatchObject({
      services: {
        sde: {
          buildNumber: null,
          ingestVersion: null,
          ingestedAt: null,
          status: 'unavailable',
        },
      },
      status: 'degraded',
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
              issues: [],
              operationId: 'GetStatus',
              status: 200,
            })
      mocks.get.mockRejectedValue(error)

      const status = await getSystemStatus()
      const observationPending = mocks.probeEsiStatus.mock.calls[0]?.[0]

      expect(status).toMatchObject({
        services: { esi: { players: null, status: 'degraded' } },
        status: 'degraded',
      })
      expect(status.services.esi).not.toHaveProperty('refreshFailureClass')
      await expect(observationPending).resolves.toStrictEqual({
        refreshFailureClass,
        status: 'degraded',
      })
    },
  )

  test('reports an unknown cold ESI failure as unavailable', async () => {
    mocks.sql.mockRejectedValue(new Error('Database unavailable'))
    mocks.get.mockRejectedValue(new Error('Unexpected ESI probe failure'))

    const status = await getSystemStatus()
    const observationPending = mocks.probeEsiStatus.mock.calls[0]?.[0]

    expect(status).toMatchObject({
      services: {
        database: { status: 'unavailable' },
        esi: { players: null, status: 'unavailable' },
      },
      status: 'unavailable',
    })
    await expect(observationPending).resolves.toStrictEqual({
      refreshFailureClass: 'unknown',
      status: 'unavailable',
    })
  })

  test('degrades cache and coordination telemetry before marking repeated outages unavailable', async () => {
    mocks.probeEsiStatus.mockResolvedValue({
      ...resilienceTelemetry(),
      cache: { checkedAt: '2026-08-20T12:00:00.000Z', status: 'degraded' },
      cooldown: {
        activeOperations: [],
        checkedAt: '2026-08-20T12:00:00.000Z',
        globalRetryAt: null,
        status: 'unavailable',
      },
      coordination: { checkedAt: '2026-08-20T12:00:00.000Z', status: 'unavailable' },
      upstream: { checkedAt: '2026-08-20T12:00:00.000Z', operations: [], status: 'unavailable' },
    })

    await expect(getSystemStatus()).resolves.toMatchObject({
      services: {
        esiResilience: {
          cache: { status: 'degraded' },
          coordination: { status: 'unavailable' },
        },
      },
      status: 'degraded',
    })
  })
})

function queueStatus() {
  return {
    active: 0,
    depth: 0,
    failed: 0,
    latestOutboxRelayOutcome: null,
    latestSchedulerOutcome: 'registered' as const,
    memoryMaxBytes: 536_870_912,
    memoryUsedBytes: 53_687_091,
    memoryUsedPercent: 10,
    oldestWaitingAgeSeconds: null,
    outboxRelayPaused: false,
    plannerPaused: false,
    retrying: 0,
    status: 'operational' as const,
    workerHeartbeatAt: '2026-08-20T12:00:00.000Z',
    workers: 1,
  }
}

function eventRelayStatus() {
  return {
    latestRelayOutcome: null,
    oldestPendingAgeSeconds: null,
    pendingCount: 0,
    relayPaused: false,
    status: 'operational' as const,
  }
}

function resilienceTelemetry() {
  return {
    cache: { checkedAt: '2026-08-20T12:00:00.000Z', status: 'operational' as const },
    checkedAt: '2026-08-20T12:00:00.000Z',
    cooldown: {
      activeOperations: [],
      checkedAt: '2026-08-20T12:00:00.000Z',
      globalRetryAt: null,
      status: 'inactive' as const,
    },
    coordination: { checkedAt: '2026-08-20T12:00:00.000Z', status: 'operational' as const },
    upstream: {
      checkedAt: '2026-08-20T12:00:00.000Z',
      operations: [],
      status: 'operational' as const,
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
