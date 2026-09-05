import { afterEach, describe, expect, test, vi } from 'vitest'
import { createStatusClient } from '@evespace/esi-client/domains/status'

import { env } from '../../src/env.js'

const mocks = vi.hoisted(() => ({
  cache: {},
  coordination: {},
  recordRate: vi.fn().mockResolvedValue(undefined),
  recordResponse: vi.fn().mockResolvedValue(undefined),
  recordUpstream: vi.fn().mockResolvedValue(undefined),
  release: vi.fn().mockResolvedValue(undefined),
  renew: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/esi-resilience/cache-redis.js', () => ({
  getSharedCacheRedisConnection: () => mocks.cache,
}))
vi.mock('../../src/queue/redis.js', () => ({
  createProducerRedisConnection: () => mocks.coordination,
}))
vi.mock('../../src/esi-resilience/cooldowns.js', () => ({
  recordEsiResponse: mocks.recordResponse,
}))
vi.mock('../../src/esi-resilience/permits.js', () => ({
  acquireEsiRequestPermit: async () => ({
    coordinationAvailable: false,
    ttlMs: 30_000,
    release: mocks.release,
    renew: mocks.renew,
  }),
}))
vi.mock('../../src/esi-resilience/rate-measurement.js', () => ({
  recordEsiRateMeasurement: mocks.recordRate,
}))
vi.mock('../../src/esi-resilience/telemetry-counters.js', () => ({
  recordEsiUpstreamOutcome: mocks.recordUpstream,
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

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
    const { createEsiTransport } = await import('../../src/esi-resilience/request-transport.js')

    const response = await createEsiTransport('status')('https://esi.evetech.net/status')
    await response.text()

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
    const [{ createEsiTransport }, { EsiTransportError }] = await Promise.all([
      import('../../src/esi-resilience/request-transport.js'),
      import('../../src/esi-resilience/transport.js'),
    ])

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

  test('abandons a request at the configured timeout', async () => {
    const timeoutController = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal)
    const fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal
          if (!signal) throw new Error('Expected the ESI request timeout signal')
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    )
    vi.stubGlobal('fetch', fetch)
    const [{ createEsiTransport }, { EsiTransportError }] = await Promise.all([
      import('../../src/esi-resilience/request-transport.js'),
      import('../../src/esi-resilience/transport.js'),
    ])
    const pending = createEsiTransport('status')('https://esi.evetech.net/status')
    const caught = pending.catch((error: unknown) => error)

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    const timeoutFailure = new DOMException('Request timed out', 'TimeoutError')
    timeoutController.abort(timeoutFailure)

    await expect(caught).resolves.toMatchObject({ cause: timeoutFailure })
    await expect(caught).resolves.toBeInstanceOf(EsiTransportError)
    expect(timeout).toHaveBeenCalledWith(env.ESI_REQUEST_TIMEOUT_MS)
    expect(mocks.release).toHaveBeenCalledOnce()
  })

  test('honors caller cancellation as well as the request timeout', async () => {
    const callerController = new AbortController()
    const timeoutController = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal)
    const fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal
          if (!signal) throw new Error('Expected a composed ESI request signal')
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    )
    vi.stubGlobal('fetch', fetch)
    const [{ createEsiTransport }, { EsiTransportError }] = await Promise.all([
      import('../../src/esi-resilience/request-transport.js'),
      import('../../src/esi-resilience/transport.js'),
    ])
    const cancellation = new DOMException('Caller cancelled', 'AbortError')
    const caught = createEsiTransport('status')('https://esi.evetech.net/status', {
      signal: callerController.signal,
    }).catch((error: unknown) => error)

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    callerController.abort(cancellation)

    await expect(caught).resolves.toMatchObject({ cause: cancellation })
    await expect(caught).resolves.toBeInstanceOf(EsiTransportError)
    expect(timeoutController.signal.aborted).toBe(false)
    expect(mocks.release).toHaveBeenCalledOnce()
  })

  test('holds the concurrency permit until the response body closes', async () => {
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        bodyController = controller
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })))
    const { createEsiTransport } = await import('../../src/esi-resilience/request-transport.js')

    const response = await createEsiTransport('status')('https://esi.evetech.net/status')

    expect(mocks.release).not.toHaveBeenCalled()
    bodyController?.enqueue(new TextEncoder().encode('{}'))
    bodyController?.close()
    await response.text()
    await vi.waitFor(() => expect(mocks.release).toHaveBeenCalledOnce())
  })

  test('releases the concurrency permit when the response body is cancelled', async () => {
    const body = new ReadableStream<Uint8Array>({ pull() {} })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })))
    const { createEsiTransport } = await import('../../src/esi-resilience/request-transport.js')

    const response = await createEsiTransport('status')('https://esi.evetech.net/status')

    expect(mocks.release).not.toHaveBeenCalled()
    await response.body?.cancel()
    await vi.waitFor(() => expect(mocks.release).toHaveBeenCalledOnce())
  })

  test('preserves a successful response body timeout through SDK parsing', async () => {
    const timeoutController = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal)
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal
      if (!signal) throw new Error('Expected the ESI request timeout signal')
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal.addEventListener('abort', () => controller.error(signal.reason), { once: true })
        },
      })
      return Promise.resolve(new Response(body, { status: 200 }))
    })
    vi.stubGlobal('fetch', fetch)
    const [{ createEsiTransport }, { EsiTransportError }] = await Promise.all([
      import('../../src/esi-resilience/request-transport.js'),
      import('../../src/esi-resilience/transport.js'),
    ])
    const pending = createStatusClient({ fetch: createEsiTransport('status') })
      .withMetadata()
      .get()
    const caught = pending.catch((error: unknown) => error)

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    timeoutController.abort(new DOMException('Response timed out', 'TimeoutError'))

    await expect(caught).resolves.toMatchObject({
      code: 'ESI_RESPONSE_PARSE_ERROR',
      cause: expect.any(EsiTransportError),
    })
    await vi.waitFor(() => expect(mocks.release).toHaveBeenCalledOnce())
  })

  test('marks error-response body stream failures as transport errors', async () => {
    const failure = new TypeError('terminated')
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(failure)
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 503 })))
    const [{ createEsiTransport }, { EsiTransportError }] = await Promise.all([
      import('../../src/esi-resilience/request-transport.js'),
      import('../../src/esi-resilience/transport.js'),
    ])

    const response = await createEsiTransport('status')('https://esi.evetech.net/status')
    const caught = response.text().catch((error: unknown) => error)

    await expect(caught).resolves.toMatchObject({
      name: 'EsiTransportError',
      cause: failure,
      status: 503,
    })
    await expect(caught).resolves.toBeInstanceOf(EsiTransportError)
    await vi.waitFor(() => expect(mocks.release).toHaveBeenCalledOnce())
  })
})
