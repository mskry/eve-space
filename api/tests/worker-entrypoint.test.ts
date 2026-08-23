import { afterEach, describe, expect, test, vi } from 'vitest'

afterEach(() => {
  vi.doUnmock('../src/db/client.js')
  vi.doUnmock('../src/queue/platform.js')
  vi.doUnmock('../src/worker-readiness.js')
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('worker entrypoint', () => {
  test('gates startup on schema and queue reachability, not on worker liveness', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const assertWorkerStartupDependencies = vi.fn().mockResolvedValue(undefined)
    const assertWorkerDependencies = vi.fn().mockResolvedValue(undefined)
    const startWorkerPlatform = vi.fn().mockResolvedValue({ close: vi.fn() })
    vi.doMock('../src/db/client.js', () => ({ sql: { end: vi.fn().mockResolvedValue(undefined) } }))
    vi.doMock('../src/queue/platform.js', () => ({ startWorkerPlatform }))
    vi.doMock('../src/worker-readiness.js', () => ({
      assertWorkerStartupDependencies,
      assertWorkerDependencies,
    }))

    await import('../src/worker.js')

    await vi.waitFor(() => expect(startWorkerPlatform).toHaveBeenCalledOnce())
    expect(assertWorkerStartupDependencies).toHaveBeenCalledOnce()
    // The heartbeat-aware check belongs to the healthcheck command, not to startup.
    expect(assertWorkerDependencies).not.toHaveBeenCalled()
  })
})
