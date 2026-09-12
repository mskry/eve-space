import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  close: vi.fn().mockResolvedValue(undefined),
  connection: { address: 'redis://cache.internal:6379' },
  probe: vi.fn(),
  read: vi.fn(),
  wait: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/cache-redis.js', () => ({
  closeSharedCacheRedisConnection: mocks.close,
  getSharedCacheRedisConnection: () => mocks.connection,
  waitForCacheRedisConnection: mocks.wait,
}))

vi.mock('../../src/esi-gateway/internal/rate-measurement.js', () => ({
  readEsiRateMeasurement: mocks.read,
}))

vi.mock('../../src/esi-gateway/internal/telemetry.js', () => ({
  probeEsiResilienceTelemetry: mocks.probe,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.probe.mockResolvedValue(telemetryFixture())
  mocks.read.mockResolvedValue(rateFixture())
})

describe('ESI status interface', () => {
  test('uses the gateway error-budget floor', async () => {
    const { isEsiErrorBudgetAtFloor } = await import('../../src/esi-gateway/status-interface.js')

    expect(isEsiErrorBudgetAtFloor(null)).toBe(false)
    expect(isEsiErrorBudgetAtFloor(11)).toBe(false)
    expect(isEsiErrorBudgetAtFloor(10)).toBe(true)
  })

  test('returns only aggregate status fields', async () => {
    const { probeEsiStatus } = await import('../../src/esi-gateway/status-interface.js')

    const status = await probeEsiStatus({ status: 'operational' })

    expect(status).not.toHaveProperty('redisUrl')
    expect(status.cache).not.toHaveProperty('payload')
    expect(status.upstream.operations[0]).not.toHaveProperty('headers')
    const serialized = JSON.stringify(status)
    expect(serialized).not.toContain('redis://')
    expect(serialized).not.toContain('secret-cache-payload')
    expect(serialized).not.toContain('If-None-Match')
    expect(serialized).not.toContain('dependency stack')
  })

  test('owns Cache Redis lifecycle for the safe operator report', async () => {
    const { readEsiCallRateReport } = await import('../../src/esi-gateway/status-interface.js')

    const report = await readEsiCallRateReport(0)

    expect(mocks.wait).toHaveBeenCalledWith(mocks.connection)
    expect(mocks.read).toHaveBeenCalledWith(mocks.connection, { windowOffset: 0 })
    expect(mocks.close).toHaveBeenCalledOnce()
    expect(report).not.toHaveProperty('connection')
    expect(JSON.stringify(report)).not.toContain('redis://')
  })
})

function telemetryFixture() {
  return {
    checkedAt: '2026-09-11T12:00:00.000Z',
    redisUrl: 'redis://coordination.internal:6379',
    cache: {
      status: 'operational',
      checkedAt: '2026-09-11T12:00:00.000Z',
      connectionErrors: {},
      envelopeRejections: {},
      envelopeVersionMismatches: { expected: 3, found: {}, overflow: 0 },
      payload: 'secret-cache-payload',
    },
    coordination: {
      status: 'operational',
      checkedAt: '2026-09-11T12:00:00.000Z',
      operationFailures: 0,
      dependencyError: new Error('dependency stack'),
    },
    cooldown: {
      status: 'inactive',
      checkedAt: '2026-09-11T12:00:00.000Z',
      globalRetryAt: null,
      activeOperations: [],
    },
    upstream: {
      status: 'operational',
      checkedAt: '2026-09-11T12:00:00.000Z',
      operations: [
        {
          operation: 'status',
          policy: {
            authorization: 'public',
            cache: 'shared',
            freshness: 'relative',
            rateGroup: 'declared',
            declaredRateGroup: 'status',
          },
          observedRateGroup: 'status',
          rateGroupMismatches: 0,
          cacheSources: { esi: 1, cache: 0, 'not-modified': 0, stale: 0 },
          outcomes: {
            success: 1,
            notModified: 0,
            redirect: 0,
            rateLimited: 0,
            clientError: 0,
            serverError: 0,
          },
          checkedAt: '2026-09-11T12:00:00.000Z',
          headers: { 'If-None-Match': 'private-etag' },
        },
      ],
    },
  }
}

function rateFixture() {
  return {
    bucketStartedAt: '2026-09-11T12:00:00.000Z',
    bucketEndedAt: '2026-09-11T12:15:00.000Z',
    complete: false,
    operations: [],
    groups: [],
    connection: mocks.connection,
  }
}
