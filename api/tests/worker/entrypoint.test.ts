import { afterEach, describe, expect, test, vi } from 'vitest'

afterEach(() => {
  process.exitCode = 0
  vi.doUnmock('../../src/db/client.js')
  vi.doUnmock('../../src/cache-redis.js')
  vi.doUnmock('../../src/coordination-redis.js')
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
  return { close, forceClose: vi.fn(), stopRunLoop, stopped }
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
      assertWorkerDependencies,
      assertWorkerStartupDependencies,
    }))

    const workerEntry = import('../../src/worker.js')

    await vi.waitFor(() => expect(startWorkerPlatform).toHaveBeenCalledOnce(), { timeout: 10_000 })
    expect(assertWorkerStartupDependencies).toHaveBeenCalledOnce()
    // The heartbeat-aware check belongs to the healthcheck command, not to startup.
    expect(assertWorkerDependencies).not.toHaveBeenCalled()
    stopRunLoop()
    await workerEntry
  }, 15_000)

  test('closes and exits nonzero when the processing loop ends outside shutdown', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const recordDiagnostic = vi.fn()
    const end = vi.fn().mockResolvedValue(undefined)
    const { close, forceClose, stopped, stopRunLoop } = pendingPlatform()
    const startWorkerPlatform = vi.fn().mockResolvedValue({ close, forceClose, stopped })
    vi.doMock('../../src/db/client.js', () => ({ sql: { end } }))
    vi.doMock('../../src/logging.js', () => ({
      recordDiagnostic,
    }))
    vi.doMock('../../src/queue/platform.js', () => ({ startWorkerPlatform }))
    vi.doMock('../../src/worker/readiness.js', () => ({
      assertWorkerDependencies: vi.fn().mockResolvedValue(undefined),
      assertWorkerStartupDependencies: vi.fn().mockResolvedValue(undefined),
    }))

    const workerEntry = import('../../src/worker.js')
    await vi.waitFor(() => expect(startWorkerPlatform).toHaveBeenCalledOnce(), { timeout: 10_000 })
    stopRunLoop()
    await workerEntry

    await vi.waitFor(() => expect(process.exitCode).toBe(1))
    expect(close).toHaveBeenCalledOnce()
    expect(end).toHaveBeenCalled()
    expect(recordDiagnostic).toHaveBeenCalledWith('worker.processing-loop.stopped')
  }, 15_000)

  test('records a processing-loop rejection once without exposing arbitrary errors', async () => {
    const sentinels = {
      cause: 'processing-cause-private-sentinel',
      message: 'processing-message-private-sentinel',
      property: 'processing-property-private-sentinel',
      stack: 'processing-stack-private-sentinel',
    }
    const cause = new Error(sentinels.cause)
    cause.stack = `Error: ${sentinels.cause}\n    at cause (file:///${sentinels.cause}.ts:2:1)`
    const processingError = Object.assign(new Error(sentinels.message, { cause }), {
      authorization: sentinels.property,
    })
    processingError.stack = `Error: ${sentinels.message}\n    at worker (file:///${sentinels.stack}.ts:4:2)`
    const end = vi.fn().mockResolvedValue(undefined)
    const close = vi.fn().mockResolvedValue({ drained: true, timedOut: false })
    const startWorkerPlatform = vi.fn().mockImplementation(() =>
      Promise.resolve({
        close,
        forceClose: vi.fn(),
        stopped: Promise.reject(processingError),
      }),
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.doMock('../../src/db/client.js', () => ({ sql: { end } }))
    vi.doMock('../../src/queue/platform.js', () => ({ startWorkerPlatform }))
    vi.doMock('../../src/worker/readiness.js', () => ({
      assertWorkerStartupDependencies: vi.fn().mockResolvedValue(undefined),
    }))
    const { apiLogger } = await import('../../src/logging.js')
    apiLogger.enableLogging()

    try {
      await import('../../src/worker.js')

      expect(consoleError).toHaveBeenCalledOnce()
      const serialized = String(consoleError.mock.calls[0]?.[0])
      for (const sentinel of Object.values(sentinels)) {
        expect(serialized).not.toContain(sentinel)
      }
      expect(JSON.parse(serialized)).toStrictEqual(
        expect.objectContaining({
          event: 'worker.run-loop.failed',
          failureCategory: 'processing-failure',
          thrownType: 'object',
        }),
      )
      expect(close).toHaveBeenCalledOnce()
      expect(process.exitCode).toBe(1)
    } finally {
      apiLogger.disableLogging()
    }
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
      assertWorkerDependencies: vi.fn().mockResolvedValue(undefined),
      assertWorkerStartupDependencies: vi.fn().mockResolvedValue(undefined),
    }))

    const workerEntry = import('../../src/worker.js')
    await vi.waitFor(() => expect(startWorkerPlatform).toHaveBeenCalledOnce(), { timeout: 5000 })
    process.emit('SIGTERM')
    process.emit('SIGINT')
    await workerEntry

    await vi.waitFor(() => expect(end).toHaveBeenCalled())
    expect(close).toHaveBeenCalledOnce()
    expect(process.exitCode).not.toBe(1)
  })

  test('logs safely and closes dependencies when startup fails', async () => {
    const sentinels = {
      cause: 'worker-cause-private-sentinel',
      message: 'worker-message-private-sentinel',
      property: 'worker-property-private-sentinel',
      stack: 'worker-stack-private-sentinel',
    }
    const cause = new Error(sentinels.cause)
    cause.stack = `Error: ${sentinels.cause}\n    at cause (file:///worker/${sentinels.cause}.ts:2:1)`
    const startupError = Object.assign(new Error(sentinels.message, { cause }), {
      credentials: sentinels.property,
      request: { body: sentinels.property, headers: { authorization: sentinels.property } },
    })
    startupError.stack = `Error: ${sentinels.message}\n    at startup (file:///worker/${sentinels.stack}.ts?secret=${sentinels.stack}:4:2)`
    const end = vi.fn().mockResolvedValue(undefined)
    const closeSharedCacheRedisConnection = vi.fn().mockResolvedValue(undefined)
    const closeSharedCoordinationRedisConnection = vi.fn().mockResolvedValue(undefined)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.doMock('../../src/db/client.js', () => ({ sql: { end } }))
    vi.doMock('../../src/cache-redis.js', () => ({
      closeSharedCacheRedisConnection,
      observeCacheRedisConnectionErrors: vi.fn(),
    }))
    vi.doMock('../../src/coordination-redis.js', () => ({
      closeSharedCoordinationRedisConnection,
    }))
    vi.doMock('../../src/queue/platform.js', () => ({ startWorkerPlatform: vi.fn() }))
    vi.doMock('../../src/worker/readiness.js', () => ({
      assertWorkerStartupDependencies: vi.fn().mockRejectedValue(startupError),
    }))

    const { apiLogger } = await import('../../src/logging.js')
    apiLogger.enableLogging()
    try {
      await import('../../src/worker.js')

      expect(consoleError).toHaveBeenCalledOnce()
      const serialized = String(consoleError.mock.calls[0]?.[0])
      for (const sentinel of Object.values(sentinels)) {
        expect(serialized).not.toContain(sentinel)
      }
      expect(JSON.parse(serialized)).toStrictEqual(
        expect.objectContaining({
          correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
          event: 'worker.startup.failed',
          failureCategory: 'startup-failure',
          msg: 'Runtime diagnostic',
          thrownType: 'object',
        }),
      )
      expect(closeSharedCacheRedisConnection).toHaveBeenCalledOnce()
      expect(closeSharedCoordinationRedisConnection).toHaveBeenCalledOnce()
      expect(end).toHaveBeenCalledWith({ timeout: expect.any(Number) })
      expect(process.exitCode).toBe(1)
    } finally {
      apiLogger.disableLogging()
    }
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
    vi.doMock('../../src/cache-redis.js', () => ({
      closeSharedCacheRedisConnection,
      observeCacheRedisConnectionErrors: vi.fn(),
    }))
    vi.doMock('../../src/coordination-redis.js', () => ({
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
