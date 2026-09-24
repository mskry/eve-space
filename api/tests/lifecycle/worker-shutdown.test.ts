import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  createWorkerShutdownCoordinator,
  type WorkerShutdownDependencies,
} from '../../src/worker-shutdown.js'
import type { WorkerPlatform, WorkerPlatformCloseResult } from '../../src/worker-platform.js'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('worker shutdown coordinator', () => {
  test('memoizes shutdown and closes resources after active worker work drains', async () => {
    const order: string[] = []
    let finishPlatform!: () => void
    const platform = createPlatform({
      close: vi.fn(
        () =>
          new Promise<WorkerPlatformCloseResult>((resolve) => {
            order.push('platform')
            finishPlatform = () => resolve({ drained: true, timedOut: false })
          }),
      ),
    })
    const dependencies = createDependencies({
      closeCacheRedis: vi.fn(async () => {
        order.push('cache')
      }),
      closeCoordinationRedis: vi.fn(async () => {
        order.push('coordination')
      }),
      closeEsiRuntime: vi.fn(async () => {
        order.push('runtime')
      }),
      closePostgres: vi.fn(async () => {
        order.push('postgres')
      }),
      getPlatform: () => platform,
    })
    const shutdown = createWorkerShutdownCoordinator(dependencies)

    const first = shutdown()
    const second = shutdown()

    expect(second).toBe(first)
    expect(order).toStrictEqual(['platform'])
    finishPlatform()
    await first
    const third = shutdown()
    await third

    expect(third).toBe(first)
    expect(order).toStrictEqual(['platform', 'runtime', 'cache', 'coordination', 'postgres'])
    expect(platform.close).toHaveBeenCalledOnce()
    expect(dependencies.closeEsiRuntime).toHaveBeenCalledOnce()
    expect(dependencies.closeCacheRedis).toHaveBeenCalledOnce()
    expect(dependencies.closeCoordinationRedis).toHaveBeenCalledOnce()
    expect(dependencies.closePostgres).toHaveBeenCalledOnce()
  })

  test('waits for bounded platform cancellation before forced resource cleanup', async () => {
    vi.useFakeTimers()
    const order: string[] = []
    const platform = createPlatform({
      close: vi.fn(
        () =>
          new Promise<WorkerPlatformCloseResult>((resolve) => {
            order.push('platform')
            setTimeout(() => {
              order.push('cancelled')
              resolve({ drained: false, timedOut: true })
            }, 750)
          }),
      ),
    })
    const dependencies = createDependencies({
      closeCacheRedis: vi.fn(async () => {
        order.push('cache')
      }),
      getPlatform: () => platform,
      timeoutMs: 1000,
    })
    const closing = createWorkerShutdownCoordinator(dependencies)()

    await vi.advanceTimersByTimeAsync(750)
    await closing

    expect(platform.close).toHaveBeenCalledWith(1000)
    expect(dependencies.closeCacheRedis).toHaveBeenCalledWith(0)
    expect(dependencies.closeCoordinationRedis).toHaveBeenCalledWith(0)
    expect(dependencies.closePostgres).toHaveBeenCalledWith(0)
    expect(dependencies.recordTimeout).toHaveBeenCalledOnce()
    expect(dependencies.markFailed).toHaveBeenCalledOnce()
    expect(order).toStrictEqual(['platform', 'cancelled', 'cache'])
    expect(vi.getTimerCount()).toBe(0)
  })

  test('force-closes a non-settling platform before dependency cleanup at the deadline', async () => {
    vi.useFakeTimers()
    const order: string[] = []
    const platform = createPlatform({
      close: vi.fn(() => {
        order.push('platform')
        return new Promise<WorkerPlatformCloseResult>(() => {})
      }),
      forceClose: vi.fn(() => {
        order.push('force')
      }),
    })
    const dependencies = createDependencies({
      closeCacheRedis: vi.fn(async () => {
        order.push('cache')
      }),
      closeCoordinationRedis: vi.fn(async () => {
        order.push('coordination')
      }),
      closePostgres: vi.fn(async () => {
        order.push('postgres')
      }),
      getPlatform: () => platform,
      timeoutMs: 1000,
    })
    const closing = createWorkerShutdownCoordinator(dependencies)()

    await vi.advanceTimersByTimeAsync(999)
    expect(order).toStrictEqual(['platform'])
    await vi.advanceTimersByTimeAsync(1)
    await closing

    expect(platform.forceClose).toHaveBeenCalledOnce()
    expect(dependencies.closeCacheRedis).toHaveBeenCalledWith(0)
    expect(dependencies.closeCoordinationRedis).toHaveBeenCalledWith(0)
    expect(dependencies.closePostgres).toHaveBeenCalledWith(0)
    expect(dependencies.recordTimeout).toHaveBeenCalledOnce()
    expect(order).toStrictEqual(['platform', 'force', 'cache', 'coordination', 'postgres'])
    expect(vi.getTimerCount()).toBe(0)
  })

  test('starts the deadline while startup is still settling and never closes a late platform first', async () => {
    vi.useFakeTimers()
    let settleStartup!: () => void
    const startup = new Promise<void>((resolve) => {
      settleStartup = resolve
    })
    const platform = createPlatform()
    const dependencies = createDependencies({
      getPlatform: () => platform,
      getStartupOperation: () => startup,
      timeoutMs: 1000,
    })

    const closing = createWorkerShutdownCoordinator(dependencies)()
    await vi.advanceTimersByTimeAsync(1000)
    await closing
    settleStartup()

    expect(platform.close).toHaveBeenCalledWith(0)
    expect(platform.forceClose).toHaveBeenCalledOnce()
    expect(dependencies.closePostgres).toHaveBeenCalledWith(0)
    expect(dependencies.recordTimeout).toHaveBeenCalledOnce()
  })

  test('propagates a platform drain timeout to the process coordinator', async () => {
    const platform = createPlatform({
      close: vi.fn().mockResolvedValue({ drained: false, timedOut: true }),
    })
    const dependencies = createDependencies({ getPlatform: () => platform })

    await createWorkerShutdownCoordinator(dependencies)()

    expect(dependencies.recordTimeout).toHaveBeenCalledOnce()
    expect(dependencies.markFailed).toHaveBeenCalledOnce()
    expect(dependencies.closeCacheRedis).toHaveBeenCalledWith(0)
  })

  test('continues failure cleanup without a platform and across unavailable resources', async () => {
    const dependencies = createDependencies({
      closeCacheRedis: vi.fn().mockRejectedValue(new Error('cache unavailable')),
      closeCoordinationRedis: vi.fn().mockResolvedValue(undefined),
      closeEsiRuntime: vi.fn().mockRejectedValue(new Error('runtime unavailable')),
      closePostgres: vi.fn().mockRejectedValue(new Error('postgres unavailable')),
      getPlatform: () => undefined,
    })

    await createWorkerShutdownCoordinator(dependencies)()

    expect(dependencies.closeCacheRedis).toHaveBeenCalledOnce()
    expect(dependencies.closeCoordinationRedis).toHaveBeenCalledOnce()
    expect(dependencies.closePostgres).toHaveBeenCalledOnce()
    expect(dependencies.recordFailure).toHaveBeenCalledTimes(3)
    expect(dependencies.recordFailure).toHaveBeenCalledWith('esi-runtime', expect.any(Error))
    expect(dependencies.markFailed).toHaveBeenCalledTimes(3)
  })
})

function createDependencies(
  overrides: Partial<WorkerShutdownDependencies> = {},
): WorkerShutdownDependencies {
  return {
    closeCacheRedis: vi.fn().mockResolvedValue(undefined),
    closeCoordinationRedis: vi.fn().mockResolvedValue(undefined),
    closeEsiRuntime: vi.fn().mockResolvedValue(undefined),
    closePostgres: vi.fn().mockResolvedValue(undefined),
    getPlatform: () => undefined,
    getStartupOperation: () => undefined,
    markFailed: vi.fn(),
    recordFailure: vi.fn(),
    recordTimeout: vi.fn(),
    timeoutMs: 30_000,
    ...overrides,
  }
}

function createPlatform(overrides: Partial<WorkerPlatform> = {}): WorkerPlatform {
  return {
    close: vi.fn().mockResolvedValue({ drained: true, timedOut: false }),
    forceClose: vi.fn(),
    stopped: new Promise(() => {}),
    ...overrides,
  }
}
