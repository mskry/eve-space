import { afterEach, describe, expect, test, vi } from 'vitest'

interface RedisMock {
  status: string
  readonly url: string
  readonly options: Record<string, unknown>
  readonly connect: ReturnType<typeof vi.fn>
  readonly disconnect: ReturnType<typeof vi.fn>
  readonly listeners: Map<string, (value: unknown) => void>
  readonly on: ReturnType<typeof vi.fn>
  readonly quit: ReturnType<typeof vi.fn>
}

const mocks = vi.hoisted(() => ({ instances: [] as RedisMock[] }))

vi.mock('ioredis', () => ({
  Redis: class {
    status = 'wait'
    readonly connect = vi.fn(() => {
      this.status = 'connecting'
      return Promise.resolve()
    })
    readonly disconnect = vi.fn()
    readonly listeners = new Map<string, (value: unknown) => void>()
    readonly on = vi.fn((event: string, listener: (value: unknown) => void) => {
      this.listeners.set(event, listener)
      return this
    })
    readonly quit = vi.fn(() => Promise.resolve('OK'))

    constructor(
      readonly url: string,
      readonly options: Record<string, unknown>,
    ) {
      mocks.instances.push(this)
    }
  },
}))

afterEach(() => {
  vi.useRealTimers()
  mocks.instances.length = 0
  vi.resetModules()
})

describe('cache Redis connections', () => {
  test('keeps reconnecting with capped delays and rejects commands while unavailable', async () => {
    const { createCacheRedisConnection } = await import('../../src/esi-resilience/cache-redis.js')

    createCacheRedisConnection('redis://cache')

    const connection = mocks.instances[0]!
    const options = connection.options as {
      enableOfflineQueue: boolean
      lazyConnect: boolean
      retryStrategy: (attempt: number) => number
    }
    expect(options).toMatchObject({
      commandTimeout: 1_000,
      connectTimeout: 1_000,
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    })
    expect(options.retryStrategy(1)).toBe(100)
    expect(options.retryStrategy(20)).toBe(2_000)
    expect(options.retryStrategy(100)).toBe(2_000)
    expect(connection.on).toHaveBeenCalledWith('error', expect.any(Function))
    expect(connection.connect).toHaveBeenCalledOnce()
  })

  test('counts connection errors by safe code without retaining messages', async () => {
    const [{ createCacheRedisConnection }, { getCacheConnectionErrorCounts }] = await Promise.all([
      import('../../src/esi-resilience/cache-redis.js'),
      import('../../src/esi-resilience/telemetry-counters.js'),
    ])
    createCacheRedisConnection('redis://cache')
    const errorListener = mocks.instances[0]!.listeners.get('error')!

    errorListener(
      Object.assign(new Error('connect ECONNREFUSED redis://secret'), { code: 'ECONNREFUSED' }),
    )
    errorListener(
      Object.assign(new Error('connect ECONNREFUSED redis://secret'), { code: 'ECONNREFUSED' }),
    )
    errorListener(new Error('authentication failed'))

    expect(getCacheConnectionErrorCounts()).toEqual({ ECONNREFUSED: 2, UNKNOWN: 1 })
    expect(JSON.stringify(getCacheConnectionErrorCounts())).not.toContain('redis://secret')
  })

  test('exposes initial readiness to dedicated probe connections', async () => {
    const { createCacheRedisConnection, waitForCacheRedisConnection } =
      await import('../../src/esi-resilience/cache-redis.js')
    const connection = createCacheRedisConnection('redis://cache')

    await expect(waitForCacheRedisConnection(connection)).resolves.toBeUndefined()

    expect(mocks.instances[0]!.connect).toHaveBeenCalledOnce()
  })

  test('disconnects a never-connected client without sending quit', async () => {
    const { closeCacheRedisConnection } = await import('../../src/esi-resilience/cache-redis.js')
    const connection = {
      status: 'wait',
      disconnect: vi.fn(),
      quit: vi.fn(),
    }

    await closeCacheRedisConnection(connection as never)

    expect(connection.disconnect).toHaveBeenCalledOnce()
    expect(connection.quit).not.toHaveBeenCalled()
  })

  test('disconnects a connected client when bounded closure expires', async () => {
    vi.useFakeTimers()
    const { closeCacheRedisConnection } = await import('../../src/esi-resilience/cache-redis.js')
    const connection = {
      status: 'ready',
      disconnect: vi.fn(),
      quit: vi.fn(() => new Promise(() => {})),
    }

    const closing = closeCacheRedisConnection(connection as never, 1_000)
    await vi.advanceTimersByTimeAsync(1_000)
    await closing

    expect(connection.quit).toHaveBeenCalledOnce()
    expect(connection.disconnect).toHaveBeenCalledOnce()
  })

  test('clears the shared reference before waiting for close', async () => {
    const { closeSharedCacheRedisConnection, getSharedCacheRedisConnection } =
      await import('../../src/esi-resilience/cache-redis.js')
    const first = getSharedCacheRedisConnection()
    const firstMock = mocks.instances[0]!
    firstMock.status = 'ready'
    let finishQuit: (() => void) | undefined
    firstMock.quit.mockReturnValue(
      new Promise<string>((resolve) => {
        finishQuit = () => resolve('OK')
      }),
    )

    const closing = closeSharedCacheRedisConnection()
    const second = getSharedCacheRedisConnection()

    expect(second).not.toBe(first)
    expect(mocks.instances).toHaveLength(2)
    finishQuit!()
    await closing
  })
})
