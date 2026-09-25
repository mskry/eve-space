import { describe, expect, test, vi } from 'vitest'
import { esiOperationCatalog } from '../../src/esi-gateway/internal/catalog.js'
import { ESI_CACHE_ENVELOPE_VERSION } from '../../src/esi-gateway/internal/envelope.js'
import { probeEsiResilienceTelemetry } from '../../src/esi-gateway/internal/telemetry.js'
import {
  recordEsiCacheEnvelopeRejection,
  recordEsiCacheSource,
  recordEsiCoordinationFailure,
  recordEsiUpstreamOutcome,
  recordCacheConnectionError,
} from '../../src/esi-gateway/internal/telemetry-counters.js'

const operationalObservation = { status: 'operational' as const }

describe('ESI resilience telemetry', () => {
  test('starts dependency probes before a pending upstream observation settles', async () => {
    let resolveObservation!: (observation: typeof operationalObservation) => void
    const observationPending = new Promise<typeof operationalObservation>((resolve) => {
      resolveObservation = resolve
    })
    const dependencies = availableDependencies()
    const probeCache = vi.fn(dependencies.probeCache)
    const probeCoordination = vi.fn(dependencies.probeCoordination)

    const telemetryPending = probeEsiResilienceTelemetry(observationPending, {
      ...dependencies,
      probeCache,
      probeCoordination,
    })

    expect(probeCache).toHaveBeenCalledOnce()
    expect(probeCoordination).toHaveBeenCalledOnce()

    resolveObservation(operationalObservation)
    await expect(telemetryPending).resolves.toMatchObject({
      upstream: { status: 'operational' },
    })
  })

  test('marks dependency failures degraded before three consecutive failed probes mark them unavailable', async () => {
    const dependencies = {
      probeCache: async () => false,
      probeCoordination: async () => false,
    }

    await expect(
      probeEsiResilienceTelemetry(operationalObservation, dependencies),
    ).resolves.toMatchObject({
      cache: { status: 'degraded' },
      cooldown: { status: 'unavailable' },
      coordination: { status: 'degraded' },
      upstream: { status: 'operational' },
    })
    await probeEsiResilienceTelemetry(operationalObservation, dependencies)
    const telemetry = await probeEsiResilienceTelemetry(operationalObservation, dependencies)

    expect(telemetry).toMatchObject({
      cache: { status: 'unavailable' },
      coordination: { status: 'unavailable' },
    })
    expect(JSON.stringify(telemetry)).not.toContain('redis://')
  })

  test('reports safe aggregate outcomes beside each operation cache policy', async () => {
    const operations = Object.keys(esiOperationCatalog)
    const coordinationConnection = {
      get: async () => null,
      mget: async () => Array<string | null>(operations.length + 1).fill(null),
    }
    const cacheConnection = {
      hgetall: async (key: string) =>
        key.endsWith(':status') ? { checkedAt: '2026-08-20T12:00:00.000Z', success: '3' } : {},
    }

    const telemetry = await probeEsiResilienceTelemetry(operationalObservation, {
      cacheConnection: cacheConnection as never,
      coordinationConnection: coordinationConnection as never,
      probeCache: async () => true,
      probeCoordination: async () => true,
    })

    expect(telemetry.upstream.operations).toContainEqual({
      cacheSources: { cache: 0, esi: 0, 'not-modified': 0, stale: 0 },
      checkedAt: '2026-08-20T12:00:00.000Z',
      observedRateGroup: null,
      operation: 'status',
      outcomes: {
        clientError: 0,
        notModified: 0,
        rateLimited: 0,
        redirect: 0,
        serverError: 0,
        success: 3,
      },
      policy: {
        authorization: 'public',
        cache: 'shared',
        declaredRateGroup: 'status',
        freshness: 'relative',
        rateGroup: 'declared',
      },
      rateGroupMismatches: 0,
    })
  })

  test('records an observed route-group mismatch without changing policy', async () => {
    const calls: unknown[][] = []
    const transaction = {
      async exec() {
        return []
      },
      hincrby(...args: unknown[]) {
        calls.push(['hincrby', ...args])
        return this
      },
      hset(...args: unknown[]) {
        calls.push(['hset', ...args])
        return this
      },
      pexpire(...args: unknown[]) {
        calls.push(['pexpire', ...args])
        return this
      },
    }
    const connection = { multi: () => transaction }

    await recordEsiUpstreamOutcome(
      connection as never,
      'wallet-balance',
      200,
      'unexpected-wallet-group',
    )

    expect(calls).toContainEqual([
      'hincrby',
      expect.stringContaining(':wallet-balance'),
      'rateGroupMismatches',
      1,
    ])
  })

  test('counts cache sources without recording principals or payloads', async () => {
    recordEsiCacheSource('wallet-balance', 'cache', true)
    const coordinationConnection = { get: async () => null, mget: async () => [] }
    const cacheConnection = { hgetall: async () => ({}) }

    const telemetry = await probeEsiResilienceTelemetry(operationalObservation, {
      cacheConnection: cacheConnection as never,
      coordinationConnection: coordinationConnection as never,
      probeCache: async () => true,
      probeCoordination: async () => true,
    })

    expect(
      telemetry.upstream.operations.find(({ operation }) => operation === 'wallet-balance'),
    ).toMatchObject({
      cacheSources: { cache: 1, esi: 0, 'not-modified': 0, stale: 1 },
    })
    expect(JSON.stringify(telemetry)).not.toMatch(/character-\d/)
  })

  test('counts cache envelope version and shape rejections separately', async () => {
    const dependencies = {
      cacheConnection: { hgetall: async () => ({}) } as never,
      probeCache: async () => true,
      probeCoordination: async () => false,
    }
    const before = await probeEsiResilienceTelemetry(operationalObservation, dependencies)

    recordEsiCacheEnvelopeRejection({ found: 2, reason: 'versionMismatch', success: false })
    recordEsiCacheEnvelopeRejection({ reason: 'invalidShape', success: false })
    recordEsiCacheEnvelopeRejection({ reason: 'invalidShape', success: false })
    recordEsiCacheEnvelopeRejection({ reason: 'invalidPayload', success: false })

    const after = await probeEsiResilienceTelemetry(operationalObservation, dependencies)
    expect(after.cache.envelopeRejections).toStrictEqual({
      incoherentFreshnessWindow: before.cache.envelopeRejections.incoherentFreshnessWindow,
      invalidPayload: before.cache.envelopeRejections.invalidPayload + 1,
      ['invalidShape']: before.cache.envelopeRejections.invalidShape + 2,
      malformedJson: before.cache.envelopeRejections.malformedJson,
      versionMismatch: before.cache.envelopeRejections.versionMismatch + 1,
    })
    expect(after.cache.envelopeVersionMismatches).toMatchObject({
      expected: ESI_CACHE_ENVELOPE_VERSION,
      found: {
        2: (before.cache.envelopeVersionMismatches.found['2'] ?? 0) + 1,
      },
    })
  })

  test('reports cache telemetry independently when coordination is unavailable', async () => {
    const telemetry = await probeEsiResilienceTelemetry(operationalObservation, {
      cacheConnection: { hgetall: async () => ({}) } as never,
      probeCache: async () => true,
      probeCoordination: async () => false,
    })

    expect(telemetry.cooldown.status).toBe('unavailable')
    expect(telemetry.upstream.status).toBe('operational')
  })

  test('reports a stale upstream-unavailable observation as unavailable', async () => {
    const telemetry = await probeEsiResilienceTelemetry(
      { refreshFailureClass: 'esi-unavailable', status: 'stale' },
      availableDependencies(),
    )

    expect(telemetry.upstream.status).toBe('unavailable')
  })

  test('reports a stale cooldown observation as degraded', async () => {
    const telemetry = await probeEsiResilienceTelemetry(
      { refreshFailureClass: 'esi-cooldown', status: 'stale' },
      availableDependencies(),
    )

    expect(telemetry.upstream.status).toBe('degraded')
  })

  test('reports a directly degraded observation as degraded', async () => {
    const telemetry = await probeEsiResilienceTelemetry(
      { status: 'degraded' },
      availableDependencies(),
    )

    expect(telemetry.upstream.status).toBe('degraded')
  })

  test('preserves probe impairment while the telemetry store is readable', async () => {
    const telemetry = await probeEsiResilienceTelemetry(
      { status: 'unavailable' },
      availableDependencies(),
    )

    expect(telemetry.upstream).toMatchObject({
      operations: expect.any(Array),
      status: 'unavailable',
    })
    expect(telemetry.upstream.operations).toHaveLength(Object.keys(esiOperationCatalog).length)
  })

  test('reports request-path coordination failures without corrupting probe streaks', async () => {
    recordEsiCoordinationFailure()
    const telemetry = await probeEsiResilienceTelemetry(operationalObservation, {
      cacheConnection: { hgetall: async () => ({}) } as never,
      coordinationConnection: { mget: async () => [], get: async () => null } as never,
      probeCache: async () => true,
      probeCoordination: async () => true,
    })

    expect(telemetry.coordination).toMatchObject({
      operationFailures: 1,
      status: 'operational',
    })
  })

  test('reports sanitized cache connection error counts', async () => {
    recordCacheConnectionError('ECONNREFUSED')
    const telemetry = await probeEsiResilienceTelemetry(operationalObservation, {
      cacheConnection: { hgetall: async () => ({}) } as never,
      coordinationConnection: { mget: async () => [], get: async () => null } as never,
      probeCache: async () => true,
      probeCoordination: async () => true,
    })

    expect(telemetry.cache.connectionErrors).toMatchObject({ ECONNREFUSED: 1 })
  })
})

function availableDependencies() {
  return {
    cacheConnection: { hgetall: async () => ({}) } as never,
    coordinationConnection: { mget: async () => [], get: async () => null } as never,
    probeCache: async () => true,
    probeCoordination: async () => true,
  }
}
