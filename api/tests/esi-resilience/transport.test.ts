import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { operationRegistry } from '@evespace/esi-client/operations'

import { env } from '../../src/env.js'

const mocks = vi.hoisted(() => ({
  cache: { get: vi.fn(), set: vi.fn() },
  coordination: {},
  recordRate: vi.fn().mockResolvedValue(undefined),
  recordResponse: vi.fn().mockResolvedValue(undefined),
  recordUpstream: vi.fn().mockResolvedValue(undefined),
  release: vi.fn().mockResolvedValue(undefined),
  renew: vi.fn().mockResolvedValue(true),
}))

vi.mock('../../src/esi-resilience/cache-redis.js', () => ({
  getSharedCacheRedisConnection: () => mocks.cache,
}))
vi.mock('../../src/coordination-redis.js', () => ({
  createCoordinationRedisConnection: () => mocks.coordination,
}))
vi.mock('../../src/esi-resilience/coordination.js', () => ({
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
vi.mock('../../src/esi-resilience/cooldowns.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/esi-resilience/cooldowns.js')>()),
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
vi.mock('../../src/esi-resilience/telemetry-counters.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/esi-resilience/telemetry-counters.js')>()),
  recordEsiUpstreamOutcome: mocks.recordUpstream,
}))

let representationSequence = 0

beforeEach(() => {
  vi.clearAllMocks()
  mocks.cache.get.mockResolvedValue(null)
  mocks.cache.set.mockResolvedValue('OK')
  mocks.renew.mockResolvedValue(true)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ESI request transport through registered execution', () => {
  test('keeps cooldowns on coordination Redis and lossy telemetry on Cache Redis', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(statusResponse()))

    await executeStatus()

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

    const caught = executeStatus().catch((error: unknown) => error)

    await expect(caught).resolves.toMatchObject({
      code: 'ESI_TRANSPORT_ERROR',
      cause: expect.objectContaining({ cause: failure }),
    })
    expect(mocks.release).toHaveBeenCalledTimes(3)
  })

  test('abandons a request at the configured timeout', async () => {
    vi.useFakeTimers()
    const timeoutController = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal)
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
    const timeoutFailure = new DOMException('Request timed out', 'TimeoutError')
    timeoutController.abort(timeoutFailure)
    await vi.runAllTimersAsync()

    await expect(caught).resolves.toMatchObject({
      code: 'ESI_TRANSPORT_ERROR',
      cause: expect.objectContaining({ cause: timeoutFailure }),
    })
    expect(timeout).toHaveBeenCalledWith(env.ESI_REQUEST_TIMEOUT_MS)
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
    const { classifyStaleRefreshFailure } = await import('../../src/esi-resilience/errors.js')
    const caught = executeStatus().catch((error: unknown) => error)

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    await vi.runAllTimersAsync()

    const error = await caught
    expect(error).toMatchObject({ code: 'ESI_TRANSPORT_ERROR' })
    expect(classifyStaleRefreshFailure(error)).toBe('esi-unavailable')
    expect(transportSignal?.aborted).toBe(true)
    expect(mocks.release).toHaveBeenCalledTimes(3)
  })

  test('preserves a response-body timeout through executor retry classification', async () => {
    vi.useFakeTimers()
    const timeoutController = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal)
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
    const { classifyStaleRefreshFailure } = await import('../../src/esi-resilience/errors.js')
    const caught = executeStatus().catch((error: unknown) => error)

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    timeoutController.abort(new DOMException('Response timed out', 'TimeoutError'))
    await vi.runAllTimersAsync()

    await expect(caught).resolves.toMatchObject({
      code: 'ESI_TRANSPORT_ERROR',
      cause: expect.objectContaining({
        cause: expect.objectContaining({ name: 'TimeoutError' }),
      }),
    })
    expect(classifyStaleRefreshFailure(await caught)).toBe('esi-unavailable')
    await vi.waitFor(() => expect(mocks.release).toHaveBeenCalledTimes(3))
  })
})

async function executeStatus(signal?: AbortSignal) {
  const { definePublicEsiRepresentation } =
    await import('../../src/esi-resilience/representations.js')
  const { registerEsiRepresentation } =
    await import('../../src/esi-resilience/representation-registry.js')
  const { execute } = await import('../../src/esi-resilience/execute.js')
  const representation = registerEsiRepresentation(
    definePublicEsiRepresentation({
      operation: 'status',
      name: `status-transport-fixture-${representationSequence++}`,
      descriptor: operationRegistry.GetStatus.transport,
      encodeRequest: () => ({}),
      map: ({ data }) => data,
    }),
  )
  return execute(representation, undefined, signal)
}

function statusResponse(body?: ReadableStream<Uint8Array>) {
  return new Response(body ?? JSON.stringify(statusData()), {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-ratelimit-group': 'status' },
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
