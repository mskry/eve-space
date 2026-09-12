import { operationRegistry } from '@evespace/esi-client/operations'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  createEsiExecutionRuntime,
  type EsiExecutionRuntime,
} from '../../src/esi-gateway/internal/execution-runtime.js'
import { createEsiExecutionRuntimeOwner } from '../../src/esi-gateway/internal/production-runtime.js'
import { definePublicEsiRepresentation } from '../../src/esi-gateway/internal/representations.js'
import { registerCallableEsiRepresentation } from '../../src/esi-gateway/internal/representation-registry.js'
import { createRuntimeTestPorts, runtimeTestConfig } from './runtime-test-adapters.js'

const mocks = vi.hoisted(() => ({
  getCacheConnection: vi.fn(() => ({})),
  getCoordinationConnection: vi.fn(() => ({})),
}))

const runtimeStatusRepresentation = registerCallableEsiRepresentation(
  definePublicEsiRepresentation({
    operation: 'status',
    name: 'runtime-isolation-status',
    descriptor: operationRegistry.GetStatus.transport,
    encodeRequest: (_input: Record<string, never>) => ({}),
    map: ({ data }) => data.players,
  }),
)

vi.mock('../../src/cache-redis.js', () => ({
  getSharedCacheRedisConnection: mocks.getCacheConnection,
  observeCacheRedisConnectionErrors: vi.fn(),
}))
vi.mock('../../src/esi-gateway/internal/coordination-connection.js', () => ({
  getCoordinationConnection: mocks.getCoordinationConnection,
}))

afterEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

describe('production ESI runtime lifecycle', () => {
  test('closes an unused production runtime idempotently', async () => {
    const { closeProductionEsiExecutionRuntime } =
      await import('../../src/esi-gateway/runtime-lifecycle.js')

    await Promise.all([closeProductionEsiExecutionRuntime(), closeProductionEsiExecutionRuntime()])

    expect(mocks.getCacheConnection).not.toHaveBeenCalled()
    expect(mocks.getCoordinationConnection).not.toHaveBeenCalled()
  })

  test('creates connections lazily, reuses the runtime, and recreates it after close', async () => {
    const [{ getProductionEsiExecutionRuntime }, { closeProductionEsiExecutionRuntime }] =
      await Promise.all([
        import('../../src/esi-gateway/internal/production-runtime.js'),
        import('../../src/esi-gateway/runtime-lifecycle.js'),
      ])
    expect(mocks.getCacheConnection).not.toHaveBeenCalled()
    expect(mocks.getCoordinationConnection).not.toHaveBeenCalled()

    const controller = new AbortController()
    controller.abort()
    await expect(
      (await getProductionEsiExecutionRuntime()).executeRepresentation({} as never, undefined, {
        signal: controller.signal,
      }),
    ).rejects.toBe(controller.signal.reason)
    await expect(
      (await getProductionEsiExecutionRuntime()).executeRepresentation({} as never, undefined, {
        signal: controller.signal,
      }),
    ).rejects.toBe(controller.signal.reason)

    expect(mocks.getCacheConnection).toHaveBeenCalledOnce()
    expect(mocks.getCoordinationConnection).toHaveBeenCalledOnce()

    await closeProductionEsiExecutionRuntime()
    await expect(
      (await getProductionEsiExecutionRuntime()).executeRepresentation({} as never, undefined, {
        signal: controller.signal,
      }),
    ).rejects.toBe(controller.signal.reason)

    expect(mocks.getCacheConnection).toHaveBeenCalledTimes(2)
    expect(mocks.getCoordinationConnection).toHaveBeenCalledTimes(2)
  })
})

describe('isolated ESI execution runtime', () => {
  test('keeps runtime-local caches isolated', async () => {
    const firstFetch = vi.fn()
    const secondFetch = vi.fn()
    const firstPorts = createRuntimeTestPorts({ response: statusResponse(1), fetch: firstFetch })
    const secondPorts = createRuntimeTestPorts({ response: statusResponse(2), fetch: secondFetch })
    const first = createEsiExecutionRuntime(firstPorts, runtimeTestConfig)
    const second = createEsiExecutionRuntime(secondPorts, runtimeTestConfig)
    const representation = statusRepresentation()
    await expect(first.executeRepresentation(representation, {})).resolves.toMatchObject({
      data: 1,
      source: 'esi',
    })
    await expect(first.executeRepresentation(representation, {})).resolves.toMatchObject({
      data: 1,
      source: 'cache',
    })
    await expect(second.executeRepresentation(representation, {})).resolves.toMatchObject({
      data: 2,
      source: 'esi',
    })

    expect(firstFetch).toHaveBeenCalledOnce()
    expect(secondFetch).toHaveBeenCalledOnce()
  })

  test('closes idempotently, clears local state, and rejects later work', async () => {
    const ports = createRuntimeTestPorts({ response: statusResponse(1), fetch: vi.fn() })
    const runtime = createEsiExecutionRuntime(ports, runtimeTestConfig)

    const firstClose = runtime.close()
    expect(runtime.close()).toBe(firstClose)
    await firstClose

    await expect(runtime.executeRepresentation(statusRepresentation(), {})).rejects.toThrow(
      'runtime is closed',
    )
  })

  test('stops admission and drains active work before clearing state', async () => {
    let finishRequest!: (response: Response) => void
    const fetchStarted = vi.fn()
    const ports = createRuntimeTestPorts({ response: statusResponse(1), fetch: vi.fn() })
    ports.transport.create =
      ({ onResponseBodySettled }) =>
      async () => {
        fetchStarted()
        const response = await new Promise<Response>((resolve) => {
          finishRequest = resolve
        })
        onResponseBodySettled()
        return response
      }
    const runtime = createEsiExecutionRuntime(ports, runtimeTestConfig)
    const execution = runtime.executeRepresentation(statusRepresentation(), {})
    await vi.waitFor(() => expect(fetchStarted).toHaveBeenCalledOnce())

    const close = runtime.close()
    let closed = false
    void close.then(() => {
      closed = true
    })
    await expect(runtime.executeRepresentation(statusRepresentation(), {})).rejects.toThrow(
      'runtime is closed',
    )
    expect(closed).toBe(false)

    finishRequest(
      new Response(JSON.stringify(statusResponse(1)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    await execution
    await close

    expect(closed).toBe(true)
  })

  test('waits for blocked permit acquisition before completing close', async () => {
    let grantPermit!: (permit: Awaited<ReturnType<typeof requestPermit>>) => void
    const acquireRequestPermit = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<typeof requestPermit>>>((resolve) => {
          grantPermit = resolve
        }),
    )
    const release = vi.fn()
    const fetch = vi.fn()
    const runtime = createEsiExecutionRuntime(
      createRuntimeTestPorts({
        response: statusResponse(1),
        fetch,
        overrides: { coordination: { acquireRequestPermit } },
      }),
      runtimeTestConfig,
    )
    const execution = runtime.executeRepresentation(statusRepresentation(), {})
    await vi.waitFor(() => expect(acquireRequestPermit).toHaveBeenCalledOnce())

    const close = runtime.close()
    let closed = false
    void close.then(() => {
      closed = true
    })
    await Promise.resolve()
    expect(closed).toBe(false)

    grantPermit(requestPermit(release))
    await execution
    await close

    expect(fetch).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledOnce()
  })

  test('waits for body settlement and an in-flight renewal before completing close', async () => {
    vi.useFakeTimers()
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined
    let settleBody!: () => void
    let finishRenewal!: (renewed: boolean) => void
    const renew = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishRenewal = resolve
        }),
    )
    const release = vi.fn()
    const ports = createRuntimeTestPorts({ response: statusResponse(1), fetch: vi.fn() })
    ports.coordination.acquireRequestPermit = async () => requestPermit(release, renew)
    ports.transport.create =
      ({ onResponseBodySettled }) =>
      async () => {
        settleBody = onResponseBodySettled
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              bodyController = controller
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
    const runtime = createEsiExecutionRuntime(ports, runtimeTestConfig)
    const execution = runtime.executeRepresentation(statusRepresentation(), {})
    await vi.waitFor(() => expect(bodyController).toBeDefined())
    await vi.advanceTimersByTimeAsync(20_000)
    await vi.waitFor(() => expect(renew).toHaveBeenCalledOnce())

    const close = runtime.close()
    bodyController?.enqueue(new TextEncoder().encode(JSON.stringify(statusResponse(1))))
    bodyController?.close()
    settleBody()
    await Promise.resolve()
    expect(release).not.toHaveBeenCalled()

    finishRenewal(true)
    await execution
    await close

    expect(release).toHaveBeenCalledOnce()
  })
})

describe('ESI execution runtime owner', () => {
  test('collapses concurrent creation', async () => {
    const runtime = runtimeStub()
    const create = vi.fn().mockResolvedValue(runtime)
    const lifecycle = createEsiExecutionRuntimeOwner(create)

    const first = lifecycle.get()
    const second = lifecycle.get()

    expect(second).toBe(first)
    await expect(Promise.all([first, second])).resolves.toEqual([runtime, runtime])
    expect(create).toHaveBeenCalledOnce()
  })

  test('clears a failed initialization so creation can be retried', async () => {
    const runtime = runtimeStub()
    const create = vi
      .fn<() => Promise<EsiExecutionRuntime>>()
      .mockRejectedValueOnce(new Error('initialization failed'))
      .mockResolvedValueOnce(runtime)
    const lifecycle = createEsiExecutionRuntimeOwner(create)

    await expect(lifecycle.get()).rejects.toThrow('initialization failed')
    await expect(lifecycle.get()).resolves.toBe(runtime)
    expect(create).toHaveBeenCalledTimes(2)
  })

  test('does not initialize when closed before first use', async () => {
    const create = vi.fn(() => runtimeStub())
    const lifecycle = createEsiExecutionRuntimeOwner(create)

    await lifecycle.close()

    expect(create).not.toHaveBeenCalled()
  })

  test('rejects gets while closing pending initialization and permits fresh recreation', async () => {
    let finishCreation!: (runtime: EsiExecutionRuntime) => void
    const firstRuntime = runtimeStub()
    const secondRuntime = runtimeStub()
    const create = vi
      .fn<() => Promise<EsiExecutionRuntime>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishCreation = resolve
          }),
      )
      .mockResolvedValueOnce(secondRuntime)
    const lifecycle = createEsiExecutionRuntimeOwner(create)

    const pendingRuntime = lifecycle.get()
    await Promise.resolve()
    const closing = lifecycle.close()
    expect(lifecycle.close()).toBe(closing)
    await expect(lifecycle.get()).rejects.toThrow('runtime is closing')
    finishCreation(firstRuntime)

    await expect(pendingRuntime).resolves.toBe(firstRuntime)
    await closing
    expect(firstRuntime.close).toHaveBeenCalledOnce()
    await expect(lifecycle.get()).resolves.toBe(secondRuntime)
  })

  test('recreates a runtime after ordinary close', async () => {
    const firstRuntime = runtimeStub()
    const secondRuntime = runtimeStub()
    const create = vi.fn().mockResolvedValueOnce(firstRuntime).mockResolvedValueOnce(secondRuntime)
    const lifecycle = createEsiExecutionRuntimeOwner(create)

    await expect(lifecycle.get()).resolves.toBe(firstRuntime)
    await lifecycle.close()
    await expect(lifecycle.get()).resolves.toBe(secondRuntime)

    expect(firstRuntime.close).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledTimes(2)
  })
})

function statusRepresentation() {
  return runtimeStatusRepresentation
}

function statusResponse(players: number) {
  return {
    players,
    server_version: 'test',
    start_time: '2026-09-11T00:00:00Z',
    vip: false,
  }
}

function runtimeStub(): EsiExecutionRuntime {
  return {
    executeRepresentation: vi.fn(),
    executeMutationRepresentation: vi.fn(),
    executePlatformOperation: vi.fn(),
    getQuotaStatuses: vi.fn(),
    isOperationQuotaLimited: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  } as EsiExecutionRuntime
}

function requestPermit(release = vi.fn(), renew = vi.fn(async () => true)) {
  return {
    coordinationAvailable: false,
    ttlMs: 30_000,
    renew,
    release,
  }
}
