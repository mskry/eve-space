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

  test('marks fetch failures as transport errors and releases the permit', async () => {
    const failure = new TypeError('network unavailable')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure))
    const { createEsiTransport, EsiTransportError } =
      await import('../src/esi-resilience/transport.js')

    const caught = createEsiTransport('status')('https://esi.evetech.net/status').catch(
      (error: unknown) => error,
    )

    await expect(caught).resolves.toMatchObject({
      name: 'EsiTransportError',
      cause: failure,
    })
    await expect(caught).resolves.toBeInstanceOf(EsiTransportError)
    expect(mocks.release).toHaveBeenCalledOnce()
  })

  test('marks error-response body stream failures as transport errors', async () => {
    const failure = new TypeError('terminated')
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(failure)
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 503 })))
    const { createEsiTransport, EsiTransportError } =
      await import('../src/esi-resilience/transport.js')

    const response = await createEsiTransport('status')('https://esi.evetech.net/status')
    const caught = response.text().catch((error: unknown) => error)

    await expect(caught).resolves.toMatchObject({
      name: 'EsiTransportError',
      cause: failure,
      status: 503,
    })
    await expect(caught).resolves.toBeInstanceOf(EsiTransportError)
  })
})
