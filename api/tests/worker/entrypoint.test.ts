import { afterEach, describe, expect, test, vi } from 'vitest'

afterEach(() => {
  process.exitCode = 0
  vi.doUnmock('../../src/db/client.js')
  vi.doUnmock('../../src/esi-resilience/cache-redis.js')
  vi.doUnmock('../../src/esi-resilience/coordination-connection.js')
  vi.doUnmock('../../src/logging.js')
  vi.doUnmock('../../src/queue/platform.js')
  vi.doUnmock('../../src/worker/readiness.js')
  vi.resetModules()
  vi.restoreAllMocks()
})

function pendingPlatform(overrides: { close?: () => Promise<unknown> } = {}) {
  let stopRunLoop!: () => void
  const stopped = new Promise<void>((resolve) => {
    stopRunLoop = resolve
  })
  const close = vi.fn(
    overrides.close ?? (() => Promise.resolve({ drained: true, timedOut: false })),
  )
  return { close, forceClose: vi.fn(), stopped, stopRunLoop }
}

describe('worker entrypoint', () => {
  test('gates startup on schema and queue reachability, not on worker liveness', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const assertWorkerStartupDependencies = vi.fn().mockResolvedValue(undefined)
    const assertWorkerDependencies = vi.fn().mockResolvedValue(undefined)
    const { close, forceClose, stopped, stopRunLoop } = pendingPlatform()
    const startWorkerPlatform = vi.fn().mockResolvedValue({ close, forceClose, stopped })
    vi.doMock('../../src/db/client.js', () => ({
      sql: { end: vi.fn().mockResolvedValue(undefined) },
    }))
    vi.doMock('../../src/queue/platform.js', () => ({ startWorkerPlatform }))
    vi.doMock('../../src/worker/readiness.js', () => ({
      assertWorkerStartupDependencies,
      assertWorkerDependencies,
    }))

    const workerEntry = import('../../src/worker.js')

    await vi.waitFor(() => expect(startWorkerPlatform).toHaveBeenCalledOnce(), { timeout: 5_000 })
    expect(assertWorkerStartupDependencies).toHaveBeenCalledOnce()
    // The heartbeat-aware check belongs to the healthcheck command, not to startup.
    expect(assertWorkerDependencies).not.toHaveBeenCalled()
    stopRunLoop()
    await workerEntry
  })

  test('closes and exits nonzero when the processing loop ends outside shutdown', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.fn()
    const end = vi.fn().mockResolvedValue(undefined)
    const { close, forceClose, stopped, stopRunLoop } = pendingPlatform()
    const startWorkerPlatform = vi.fn().mockResolvedValue({ close, forceClose, stopped })
    vi.doMock('../../src/db/client.js', () => ({ sql: { end } }))
    vi.doMock('../../src/logging.js', () => ({
      apiLogger: { error, info: vi.fn() },
      logSafeError: vi.fn(),
    }))
    vi.doMock('../../src/queue/platform.js', () => ({ startWorkerPlatform }))
    vi.doMock('../../src/worker/readiness.js', () => ({
      assertWorkerStartupDependencies: vi.fn().mockResolvedValue(undefined),
      assertWorkerDependencies: vi.fn().mockResolvedValue(undefined),
    }))

    const workerEntry = import('../../src/worker.js')
    await vi.waitFor(() => expect(startWorkerPlatform).toHaveBeenCalledOnce(), { timeout: 5_000 })
    stopRunLoop()
    await workerEntry

    await vi.waitFor(() => expect(process.exitCode).toBe(1))
    expect(close).toHaveBeenCalledOnce()
    expect(end).toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('processing loop ended'))
  })

  test('exits zero when a signal stops the processing loop', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const end = vi.fn().mockResolvedValue(undefined)
    const { close, forceClose, stopped, stopRunLoop } = pendingPlatform({
      close: () => {
        stopRunLoop()
        return Promise.resolve({ drained: true, timedOut: false })
      },
    })
    const startWorkerPlatform = vi.fn().mockResolvedValue({ close, forceClose, stopped })
    vi.doMock('../../src/db/client.js', () => ({ sql: { end } }))
    vi.doMock('../../src/queue/platform.js', () => ({ startWorkerPlatform }))
    vi.doMock('../../src/worker/readiness.js', () => ({
      assertWorkerStartupDependencies: vi.fn().mockResolvedValue(undefined),
      assertWorkerDependencies: vi.fn().mockResolvedValue(undefined),
    }))

    const workerEntry = import('../../src/worker.js')
    await vi.waitFor(() => expect(startWorkerPlatform).toHaveBeenCalledOnce(), { timeout: 5_000 })
    process.emit('SIGTERM')
    process.emit('SIGINT')
    await workerEntry

    await vi.waitFor(() => expect(end).toHaveBeenCalled())
    expect(close).toHaveBeenCalledOnce()
    expect(process.exitCode).not.toBe(1)
  })

  test('logs safely and closes dependencies when startup fails', async () => {
    const startupError = new Error('password=private-value')
    const end = vi.fn().mockResolvedValue(undefined)
    const closeSharedCacheRedisConnection = vi.fn().mockResolvedValue(undefined)
    const closeSharedCoordinationRedisConnection = vi.fn().mockResolvedValue(undefined)
    const logSafeError = vi.fn()
    vi.doMock('../../src/db/client.js', () => ({ sql: { end } }))
    vi.doMock('../../src/esi-resilience/cache-redis.js', () => ({
      closeSharedCacheRedisConnection,
    }))
    vi.doMock('../../src/esi-resilience/coordination-connection.js', () => ({
      closeSharedCoordinationRedisConnection,
    }))
    vi.doMock('../../src/logging.js', () => ({
      apiLogger: { error: vi.fn(), info: vi.fn() },
      logSafeError,
    }))
    vi.doMock('../../src/queue/platform.js', () => ({ startWorkerPlatform: vi.fn() }))
    vi.doMock('../../src/worker/readiness.js', () => ({
      assertWorkerStartupDependencies: vi.fn().mockRejectedValue(startupError),
    }))

    await import('../../src/worker.js')

    expect(logSafeError).toHaveBeenCalledWith('Worker startup failed', startupError)
    expect(closeSharedCacheRedisConnection).toHaveBeenCalledOnce()
    expect(closeSharedCoordinationRedisConnection).toHaveBeenCalledOnce()
    expect(end).toHaveBeenCalledWith({ timeout: expect.any(Number) })
    expect(process.exitCode).toBe(1)
  })

  test('cancels readiness on an early signal without starting or claiming worker jobs', async () => {
    let finishReadiness!: () => void
    const readiness = new Promise<void>((resolve) => {
      finishReadiness = resolve
    })
    const end = vi.fn().mockResolvedValue(undefined)
    const closeSharedCacheRedisConnection = vi.fn().mockResolvedValue(undefined)
    const closeSharedCoordinationRedisConnection = vi.fn().mockResolvedValue(undefined)
    const startWorkerPlatform = vi.fn()
    vi.doMock('../../src/db/client.js', () => ({ sql: { end } }))
    vi.doMock('../../src/esi-resilience/cache-redis.js', () => ({
      closeSharedCacheRedisConnection,
    }))
    vi.doMock('../../src/esi-resilience/coordination-connection.js', () => ({
      closeSharedCoordinationRedisConnection,
    }))
    vi.doMock('../../src/queue/platform.js', () => ({ startWorkerPlatform }))
    vi.doMock('../../src/worker/readiness.js', () => ({
      assertWorkerStartupDependencies: vi.fn(() => readiness),
    }))

    const workerEntry = import('../../src/worker.js')
    await vi.waitFor(() => expect(process.listenerCount('SIGTERM')).toBeGreaterThan(0))
    process.emit('SIGTERM')
    process.emit('SIGINT')
    await Promise.resolve()

    expect(startWorkerPlatform).not.toHaveBeenCalled()
    finishReadiness()
    await workerEntry

    expect(startWorkerPlatform).not.toHaveBeenCalled()
    expect(closeSharedCacheRedisConnection).toHaveBeenCalledOnce()
    expect(closeSharedCoordinationRedisConnection).toHaveBeenCalledOnce()
    expect(end).toHaveBeenCalledOnce()
    expect(process.exitCode).not.toBe(1)
  })
})
