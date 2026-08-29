import { describe, expect, test } from 'vitest'
import { esiOperationCatalog } from '../../src/esi-resilience/catalog.js'
import {
  probeEsiResilienceTelemetry,
  recordEsiCacheSource,
  recordEsiCoordinationFailure,
  recordEsiUpstreamOutcome,
} from '../../src/esi-resilience/telemetry.js'

describe('ESI resilience telemetry', () => {
  test('marks dependency failures degraded before three consecutive failed probes mark them unavailable', async () => {
    const dependencies = {
      probeCache: async () => false,
      probeCoordination: async () => false,
    }

    await expect(probeEsiResilienceTelemetry(dependencies)).resolves.toMatchObject({
      cache: { status: 'degraded' },
      coordination: { status: 'degraded' },
      cooldown: { status: 'unavailable' },
      upstream: { status: 'unavailable' },
    })
    await probeEsiResilienceTelemetry(dependencies)
    const telemetry = await probeEsiResilienceTelemetry(dependencies)

    expect(telemetry).toMatchObject({
      cache: { status: 'unavailable' },
      coordination: { status: 'unavailable' },
    })
    expect(JSON.stringify(telemetry)).not.toContain('redis://')
  })

  test('reports safe aggregate outcomes beside each operation cache policy', async () => {
    const operations = Object.keys(esiOperationCatalog)
    const coordinationConnection = {
      mget: async () => Array<string | null>(operations.length + 1).fill(null),
      get: async () => null,
    }
    const cacheConnection = {
      hgetall: async (key: string) =>
        key.endsWith(':status') ? { success: '3', checkedAt: '2026-08-20T12:00:00.000Z' } : {},
    }

    const telemetry = await probeEsiResilienceTelemetry({
      probeCache: async () => true,
      probeCoordination: async () => true,
      cacheConnection: cacheConnection as never,
      coordinationConnection: coordinationConnection as never,
    })

    expect(telemetry.upstream.operations).toContainEqual({
      operation: 'status',
      policy: {
        authorization: 'public',
        cache: 'shared',
        freshness: 'relative',
        rateGroup: 'declared',
        declaredRateGroup: 'status',
      },
      outcomes: { success: 3, notModified: 0, rateLimited: 0, clientError: 0, serverError: 0 },
      observedRateGroup: null,
      rateGroupMismatches: 0,
      cacheSources: { esi: 0, cache: 0, 'not-modified': 0, stale: 0 },
      checkedAt: '2026-08-20T12:00:00.000Z',
    })
  })

  test('records an observed route-group mismatch without changing policy', async () => {
    const calls: unknown[][] = []
    const transaction = {
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
      async exec() {
        return []
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
    const coordinationConnection = { mget: async () => [], get: async () => null }
    const cacheConnection = { hgetall: async () => ({}) }

    const telemetry = await probeEsiResilienceTelemetry({
      probeCache: async () => true,
      probeCoordination: async () => true,
      cacheConnection: cacheConnection as never,
      coordinationConnection: coordinationConnection as never,
    })

    expect(
      telemetry.upstream.operations.find(({ operation }) => operation === 'wallet-balance'),
    ).toMatchObject({
      cacheSources: { esi: 0, cache: 1, 'not-modified': 0, stale: 1 },
    })
    expect(JSON.stringify(telemetry)).not.toContain('character-')
  })

  test('reports cache telemetry independently when coordination is unavailable', async () => {
    const telemetry = await probeEsiResilienceTelemetry({
      probeCache: async () => true,
      probeCoordination: async () => false,
      cacheConnection: { hgetall: async () => ({}) } as never,
    })

    expect(telemetry.cooldown.status).toBe('unavailable')
    expect(telemetry.upstream.status).toBe('operational')
  })

  test('reports request-path coordination failures without corrupting probe streaks', async () => {
    recordEsiCoordinationFailure()
    const telemetry = await probeEsiResilienceTelemetry({
      probeCache: async () => true,
      probeCoordination: async () => true,
      cacheConnection: { hgetall: async () => ({}) } as never,
      coordinationConnection: { mget: async () => [], get: async () => null } as never,
    })

    expect(telemetry.coordination).toMatchObject({
      status: 'operational',
      operationFailures: 1,
    })
  })
})
