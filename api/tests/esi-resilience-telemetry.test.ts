import { describe, expect, test } from 'vitest'
import { esiOperationPolicies } from '../src/esi-resilience/policy.js'
import { probeEsiResilienceTelemetry } from '../src/esi-resilience/telemetry.js'

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
    const operations = Object.keys(esiOperationPolicies)
    const connection = {
      mget: async () => Array<string | null>(operations.length + 1).fill(null),
      get: async () => null,
      hgetall: async (key: string) =>
        key.endsWith(':status') ? { success: '3', checkedAt: '2026-08-20T12:00:00.000Z' } : {},
    }

    const telemetry = await probeEsiResilienceTelemetry({
      probeCache: async () => true,
      probeCoordination: async () => true,
      connection: connection as never,
    })

    expect(telemetry.upstream.operations).toContainEqual({
      operation: 'status',
      policy: expect.objectContaining({ valueCache: 'shared', revalidate: true }),
      outcomes: { success: 3, notModified: 0, rateLimited: 0, clientError: 0, serverError: 0 },
      checkedAt: '2026-08-20T12:00:00.000Z',
    })
  })
})
