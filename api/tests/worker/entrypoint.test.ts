import { afterEach, describe, expect, test, vi } from 'vitest'

afterEach(() => {
  process.exitCode = 0
  vi.doUnmock('../../src/db/client.js')
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
  const close = vi.fn(overrides.close ?? (() => Promise.resolve(true)))
  return { close, stopped, stopRunLoop }
}

describe('worker entrypoint', () => {
  test('gates startup on schema and queue reachability, not on worker liveness', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const assertWorkerStartupDependencies = vi.fn().mockResolvedValue(undefined)
    const assertWorkerDependencies = vi.fn().mockResolvedValue(undefined)
    const { close, stopped, stopRunLoop } = pendingPlatform()
    const startWorkerPlatform = vi.fn().mockResolvedValue({ close, stopped })
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
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const end = vi.fn().mockResolvedValue(undefined)
    const { close, stopped, stopRunLoop } = pendingPlatform()
    const startWorkerPlatform = vi.fn().mockResolvedValue({ close, stopped })
    vi.doMock('../../src/db/client.js', () => ({ sql: { end } }))
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
    const { close, stopped, stopRunLoop } = pendingPlatform({
      close: () => {
        stopRunLoop()
        return Promise.resolve(true)
      },
    })
    const startWorkerPlatform = vi.fn().mockResolvedValue({ close, stopped })
    vi.doMock('../../src/db/client.js', () => ({ sql: { end } }))
    vi.doMock('../../src/queue/platform.js', () => ({ startWorkerPlatform }))
    vi.doMock('../../src/worker/readiness.js', () => ({
      assertWorkerStartupDependencies: vi.fn().mockResolvedValue(undefined),
      assertWorkerDependencies: vi.fn().mockResolvedValue(undefined),
    }))

    const workerEntry = import('../../src/worker.js')
    await vi.waitFor(() => expect(startWorkerPlatform).toHaveBeenCalledOnce(), { timeout: 5_000 })
    process.emit('SIGTERM')
    await workerEntry

    await vi.waitFor(() => expect(end).toHaveBeenCalled())
    expect(close).toHaveBeenCalledOnce()
    expect(process.exitCode).not.toBe(1)
  })
})
