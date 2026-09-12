import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { operationRegistry } from '@evespace/esi-client/operations'

const mocks = vi.hoisted(() => ({
  acquirePermit: vi.fn(),
  cache: { get: vi.fn(), set: vi.fn() },
  coordination: {},
  recordRate: vi.fn().mockResolvedValue(undefined),
  recordResponse: vi.fn().mockResolvedValue(undefined),
  recordUpstream: vi.fn().mockResolvedValue(undefined),
  release: vi.fn().mockResolvedValue(undefined),
  renew: vi.fn().mockResolvedValue(true),
}))

vi.mock('../../src/cache-redis.js', () => ({
  getSharedCacheRedisConnection: () => mocks.cache,
  observeCacheRedisConnectionErrors: vi.fn(),
}))
vi.mock('../../src/esi-gateway/internal/coordination-connection.js', () => ({
  getCoordinationConnection: () => mocks.coordination,
}))
vi.mock('../../src/esi-gateway/internal/coordination.js', () => ({
  acquireEsiRequestLease: vi.fn().mockResolvedValue(undefined),
  commitEsiFence: vi.fn(),
  getCommittedEsiFence: vi.fn(),
  getEsiRequestLeaseTtl: vi.fn(),
  getEsiResourceRevision: vi.fn().mockResolvedValue(0),
  incrementEsiResourceRevision: vi.fn(),
  initializeCacheNamespace: vi.fn().mockRejectedValue(new Error('coordination unavailable')),
  releaseEsiRequestLease: vi.fn(),
  renewEsiRequestLease: vi.fn(),
}))
vi.mock('../../src/esi-gateway/internal/cooldowns.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/esi-gateway/internal/cooldowns.js')>()),
  recordEsiResponse: mocks.recordResponse,
}))
vi.mock('../../src/esi-gateway/internal/permits.js', () => ({
  acquireEsiRequestPermit: mocks.acquirePermit,
}))
vi.mock('../../src/esi-gateway/internal/rate-measurement.js', () => ({
  recordEsiRateMeasurement: mocks.recordRate,
}))
vi.mock('../../src/esi-gateway/internal/telemetry-counters.js', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../src/esi-gateway/internal/telemetry-counters.js')
  >()),
  recordEsiUpstreamOutcome: mocks.recordUpstream,
}))

let representationSequence = 0

beforeEach(() => {
  vi.clearAllMocks()
  mocks.cache.get.mockResolvedValue(null)
  mocks.cache.set.mockResolvedValue('OK')
  mocks.acquirePermit.mockImplementation(async () => ({
    coordinationAvailable: false,
    ttlMs: 30_000,
    release: mocks.release,
    renew: mocks.renew,
  }))
  mocks.renew.mockResolvedValue(true)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ESI request transport through registered execution', () => {
  test('uses transport headers supplied by the composition root', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    const { createRawEsiTransport } = await import('../../src/esi-gateway/internal/transport.js')
    const transport = createRawEsiTransport({
      userAgent: 'EveSpace/Test',
      compatibilityDate: '2026-09-01',
    })

    await transport('https://esi.evetech.net/latest/status')

    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers)
    expect(headers.get('User-Agent')).toBe('EveSpace/Test')
    expect(headers.get('X-Compatibility-Date')).toBe('2026-09-01')
  })

  test('settles an absent response body through the real transport', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
    const onResponseBodySettled = vi.fn()
    const { createRawEsiTransport } = await import('../../src/esi-gateway/internal/transport.js')
    const transport = createRawEsiTransport(
      { userAgent: 'EveSpace/Test', compatibilityDate: '2026-09-01' },
      { onResponseBodySettled },
    )

    await transport('https://esi.evetech.net/latest/status')

    expect(onResponseBodySettled).toHaveBeenCalledOnce()
  })

  test('settles real transport cancellation after forwarding its reason', async () => {
    const reason = new Error('consumer stopped')
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
    const onResponseBodySettled = vi.fn()
    const { createRawEsiTransport } = await import('../../src/esi-gateway/internal/transport.js')
    const transport = createRawEsiTransport(
      { userAgent: 'EveSpace/Test', compatibilityDate: '2026-09-01' },
      { onResponseBodySettled },
    )

    const response = await transport('https://esi.evetech.net/latest/status')
    await response.body?.cancel(reason)

    expect(cancel).toHaveBeenCalledWith(reason)
    await vi.waitFor(() => expect(onResponseBodySettled).toHaveBeenCalledOnce())
  })

  test('keeps cooldowns on coordination Redis and lossy telemetry on Cache Redis', async () => {
    let finishCooldownRecording!: () => void
    let signalCooldownRecordingStarted!: () => void
    const cooldownRecordingStarted = new Promise<void>((resolve) => {
      signalCooldownRecordingStarted = resolve
    })
    mocks.recordResponse.mockImplementationOnce(() => {
      signalCooldownRecordingStarted()
      return new Promise<void>((resolve) => {
        finishCooldownRecording = resolve
      })
    })
    const fetch = vi.fn().mockResolvedValue(
      statusResponse(undefined, {
        'x-esi-error-limit-remain': '0',
        'x-esi-error-limit-reset': '60',
      }),
    )
    vi.stubGlobal('fetch', fetch)

    const execution = executeStatus()
    await cooldownRecordingStarted
    expect(mocks.recordResponse).toHaveBeenCalledOnce()
    expect(mocks.release).not.toHaveBeenCalled()

    finishCooldownRecording()
    await execution

    expect(fetch).toHaveBeenCalledOnce()
    expect(mocks.release).toHaveBeenCalledOnce()
    expect(mocks.recordRate).toHaveBeenCalledWith(
      mocks.cache,
      expect.objectContaining({ operation: 'status', status: 200 }),
    )
    expect(mocks.recordUpstream).toHaveBeenCalledWith(mocks.cache, 'status', 200, 'status')
    expect(mocks.recordResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        connection: mocks.coordination,
        operation: 'status',
        metadata: expect.objectContaining({ status: 200 }),
      }),
    )
  })

  test('records typed SDK metadata and durable cooldown before releasing the permit', async () => {
    let finishCooldownRecording!: () => void
    let signalCooldownRecordingStarted!: () => void
    const cooldownRecordingStarted = new Promise<void>((resolve) => {
      signalCooldownRecordingStarted = resolve
    })
    mocks.recordResponse.mockImplementationOnce(() => {
      signalCooldownRecordingStarted()
      return new Promise<void>((resolve) => {
        finishCooldownRecording = resolve
      })
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'rate limited' }), {
          status: 429,
          headers: {
            'content-type': 'application/json',
            'retry-after': '12',
            'x-esi-error-limit-remain': '98',
            'x-esi-error-limit-reset': '44',
            'x-ratelimit-group': 'status',
            'x-ratelimit-limit': '100',
            'x-ratelimit-remaining': '97',
            'x-ratelimit-used': '3',
          },
        }),
      ),
    )

    const execution = executeStatus()
    await cooldownRecordingStarted
    expect(mocks.recordResponse).toHaveBeenCalledOnce()
    expect(mocks.release).not.toHaveBeenCalled()

    finishCooldownRecording()
    await expect(execution).rejects.toMatchObject({
      name: 'EsiQuotaError',
      retryAfterSeconds: 12,
    })

    expect(mocks.recordResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        connection: mocks.coordination,
        operation: 'status',
        principal: undefined,
        metadata: expect.objectContaining({
          status: 429,
          retryAfterSeconds: 12,
          errorLimit: { remaining: 98, reset: 44 },
          routeRateLimit: { group: 'status', limit: 100, remaining: 97, used: 3 },
        }),
      }),
    )
    expect(mocks.recordUpstream).toHaveBeenCalledWith(mocks.cache, 'status', 429, 'status')
    expect(mocks.release).toHaveBeenCalledOnce()
  })

  test('marks fetch failures as transport errors and releases the permit', async () => {
    const failure = new TypeError('network unavailable')
    const fetch = vi.fn().mockRejectedValue(failure)
    vi.stubGlobal('fetch', fetch)

    const caught = executeStatus().catch((error: unknown) => error)

    await expect(caught).resolves.toMatchObject({
      code: 'ESI_TRANSPORT_ERROR',
      cause: failure,
    })
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(mocks.acquirePermit).toHaveBeenCalledTimes(3)
    expect(mocks.release).toHaveBeenCalledTimes(3)
  })

  test('releases each acquisition when response-body consumption fails', async () => {
    const failure = new Error('body stream failed')
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          statusResponse(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.error(failure)
              },
            }),
          ),
        ),
      ),
    )
    const caught = executeStatus().catch((error: unknown) => error)

    await expect(caught).resolves.toMatchObject({
      code: 'ESI_TRANSPORT_ERROR',
      cause: failure,
      phase: 'response',
      status: 200,
    })
    expect(mocks.acquirePermit).toHaveBeenCalledTimes(3)
    expect(mocks.release).toHaveBeenCalledTimes(3)
  })

  test('releases once when a successful status has no response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )

    await expect(executeStatus()).rejects.toMatchObject({
      name: 'EsiResponseParseError',
      status: 200,
    })
    expect(mocks.acquirePermit).toHaveBeenCalledOnce()
    expect(mocks.release).toHaveBeenCalledOnce()
  })

  test('abandons a request at the configured timeout', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal
          if (!signal) throw new Error('Expected the ESI request timeout signal')
          if (signal.aborted) return reject(signal.reason)
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    )
    vi.stubGlobal('fetch', fetch)
    const caught = executeStatus().catch((error: unknown) => error)

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    await vi.runAllTimersAsync()

    await expect(caught).resolves.toMatchObject({
      code: 'ESI_TRANSPORT_ERROR',
      operationId: 'GetStatus',
      reason: 'timeout',
      phase: 'request',
    })
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(mocks.release).toHaveBeenCalledTimes(3)
  })

  test('holds and renews the permit until the response body closes', async () => {
    vi.useFakeTimers()
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        bodyController = controller
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(statusResponse(body)))

    const pending = executeStatus()
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledOnce())
    await vi.advanceTimersByTimeAsync(20_000)
    expect(mocks.renew).toHaveBeenCalledOnce()
    expect(mocks.release).not.toHaveBeenCalled()

    bodyController?.enqueue(new TextEncoder().encode(JSON.stringify(statusData())))
    bodyController?.close()
    await pending
    await vi.waitFor(() => expect(mocks.release).toHaveBeenCalledOnce())
  })

  test('aborts open response consumption when the execution caller is cancelled', async () => {
    vi.useFakeTimers()
    let transportSignal: AbortSignal | undefined
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      transportSignal = init?.signal ?? undefined
      if (transportSignal?.aborted) return Promise.reject(transportSignal.reason)
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          transportSignal?.addEventListener(
            'abort',
            () => controller.error(transportSignal?.reason),
            { once: true },
          )
        },
      })
      return Promise.resolve(statusResponse(body))
    })
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    const caught = executeStatus(controller.signal).catch((error: unknown) => error)

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    controller.abort()
    await vi.runAllTimersAsync()

    await expect(caught).resolves.toBe(controller.signal.reason)
    expect(controller.signal.reason).toMatchObject({ name: 'AbortError' })
    expect(transportSignal?.aborted).toBe(true)
    await vi.waitFor(() => expect(mocks.release).toHaveBeenCalledOnce())
  })

  test('serializes permit renewal and waits for it before release', async () => {
    vi.useFakeTimers()
    let resolveRenewal: ((renewed: boolean) => void) | undefined
    mocks.renew.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveRenewal = resolve
        }),
    )
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        bodyController = controller
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(statusResponse(body)))

    const pending = executeStatus()
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledOnce())
    await vi.advanceTimersByTimeAsync(20_000)
    expect(mocks.renew).toHaveBeenCalledOnce()
    bodyController?.enqueue(new TextEncoder().encode(JSON.stringify(statusData())))
    bodyController?.close()
    await vi.waitFor(() => expect(mocks.release).not.toHaveBeenCalled())

    resolveRenewal?.(true)
    await pending
    await vi.waitFor(() => expect(mocks.release).toHaveBeenCalledOnce())
  })

  test('aborts an active request when permit ownership is lost', async () => {
    vi.useFakeTimers()
    mocks.renew.mockResolvedValue(false)
    let transportSignal: AbortSignal | undefined
    const fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          transportSignal = init?.signal ?? undefined
          if (transportSignal?.aborted) return reject(transportSignal.reason)
          transportSignal?.addEventListener('abort', () => reject(transportSignal?.reason), {
            once: true,
          })
        }),
    )
    vi.stubGlobal('fetch', fetch)
    const { classifyEsiRefreshFailure } = await import('../../src/esi-gateway/failures.js')
    const caught = executeStatus().catch((error: unknown) => error)

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    await vi.runAllTimersAsync()

    const error = await caught
    expect(error).toMatchObject({ code: 'ESI_TRANSPORT_ERROR' })
    expect(classifyEsiRefreshFailure(error)).toBe('esi-unavailable')
    expect(transportSignal?.aborted).toBe(true)
    expect(mocks.release).toHaveBeenCalledTimes(3)
  })

  test('preserves a response-body timeout through executor retry classification', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal
      if (!signal) throw new Error('Expected the ESI request timeout signal')
      if (signal.aborted) return Promise.reject(signal.reason)
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal.addEventListener('abort', () => controller.error(signal.reason), { once: true })
        },
      })
      return Promise.resolve(statusResponse(body))
    })
    vi.stubGlobal('fetch', fetch)
    const { classifyEsiRefreshFailure } = await import('../../src/esi-gateway/failures.js')
    const caught = executeStatus().catch((error: unknown) => error)

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    await vi.runAllTimersAsync()

    await expect(caught).resolves.toMatchObject({
      code: 'ESI_TRANSPORT_ERROR',
      operationId: 'GetStatus',
      reason: 'timeout',
      phase: 'response',
      status: 200,
    })
    expect(classifyEsiRefreshFailure(await caught)).toBe('esi-unavailable')
    await vi.waitFor(() => expect(mocks.release).toHaveBeenCalledTimes(3))
  })
})

async function executeStatus(signal?: AbortSignal) {
  const { createPublicEsiRead } = await import('../../src/esi-gateway/feature-execution.js')
  return createPublicEsiRead({
    operation: 'status',
    name: `status-transport-fixture-${representationSequence++}`,
    descriptor: operationRegistry.GetStatus.transport,
    encodeRequest: () => ({}),
    map: ({ data }) => data,
  }).execute(signal ? { signal } : undefined)
}

function statusResponse(body?: ReadableStream<Uint8Array>, headers: HeadersInit = {}) {
  return new Response(body ?? JSON.stringify(statusData()), {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-ratelimit-group': 'status', ...headers },
  })
}

function statusData() {
  return {
    players: 1,
    server_version: '1',
    start_time: '2026-09-10T12:00:00Z',
    vip: false,
  }
}
