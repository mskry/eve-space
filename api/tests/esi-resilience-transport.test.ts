import { afterEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cache: {},
  coordination: {},
  recordRate: vi.fn().mockResolvedValue(undefined),
  recordResponse: vi.fn().mockResolvedValue(undefined),
  recordUpstream: vi.fn().mockResolvedValue(undefined),
  release: vi.fn().mockResolvedValue(undefined),
  renew: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../src/esi-resilience/cache-redis.js', () => ({
  getSharedCacheRedisConnection: () => mocks.cache,
}))
vi.mock('../src/queue/redis.js', () => ({
  createProducerRedisConnection: () => mocks.coordination,
}))
vi.mock('../src/esi-resilience/cooldowns.js', () => ({
  acquireEsiRequestPermit: async () => ({
    coordinationAvailable: false,
    release: mocks.release,
    renew: mocks.renew,
  }),
  recordEsiResponse: mocks.recordResponse,
}))
vi.mock('../src/esi-resilience/rate-measurement.js', () => ({
  recordEsiRateMeasurement: mocks.recordRate,
}))
vi.mock('../src/esi-resilience/telemetry.js', () => ({
  recordEsiUpstreamOutcome: mocks.recordUpstream,
}))

afterEach(() => vi.unstubAllGlobals())

describe('ESI transport telemetry roles', () => {
  test('keeps cooldowns on coordination Redis and lossy telemetry on Cache Redis', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{}', {
          status: 200,
          headers: { 'x-ratelimit-group': 'status' },
        }),
      ),
    )
    const { createEsiTransport } = await import('../src/esi-resilience/transport.js')

    await createEsiTransport('status')('https://esi.evetech.net/status')

    expect(mocks.recordRate).toHaveBeenCalledWith(
      mocks.cache,
      expect.objectContaining({ operation: 'status', status: 200 }),
    )
    expect(mocks.recordUpstream).toHaveBeenCalledWith(mocks.cache, 'status', 200, 'status')
    expect(mocks.recordResponse).toHaveBeenCalledWith(
      expect.objectContaining({ connection: mocks.coordination, operation: 'status', status: 200 }),
    )
  })
})
