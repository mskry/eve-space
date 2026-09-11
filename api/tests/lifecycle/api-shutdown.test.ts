import { createServer as createNodeServer, get } from 'node:http'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  createApiShutdownCoordinator,
  type ApiHttpServer,
  type ApiShutdownDependencies,
} from '../../src/api-shutdown.js'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('API shutdown coordinator', () => {
  test('stops admission and drains an active Node HTTP request before closing resources', async () => {
    let releaseRequest!: () => void
    let markRequestActive!: () => void
    const requestActive = new Promise<void>((resolve) => {
      markRequestActive = resolve
    })
    const requestHeld = new Promise<void>((resolve) => {
      releaseRequest = resolve
    })
    const server = createNodeServer(async (_request, response) => {
      markRequestActive()
      await requestHeld
      response.end('settled')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected a TCP server address')
    const response = new Promise<void>((resolve, reject) => {
      get(`http://127.0.0.1:${address.port}`, (incoming) => {
        incoming.resume()
        incoming.on('end', resolve)
      }).on('error', reject)
    })
    await requestActive
    const closeCacheRedis = vi.fn().mockResolvedValue(undefined)
    const dependencies = createDependencies({
      getServer: () => server,
      closeCacheRedis,
    })

    const closing = createApiShutdownCoordinator(dependencies)()
    await Promise.resolve()
    expect(server.listening).toBe(false)
    expect(closeCacheRedis).not.toHaveBeenCalled()

    releaseRequest()
    await response
    await closing

    expect(closeCacheRedis).toHaveBeenCalledOnce()
  })

  test('memoizes shutdown and closes resources after active HTTP work drains', async () => {
    const order: string[] = []
    let finishHttp!: () => void
    const server = createServer({
      close: vi.fn((callback: () => void) => {
        order.push('http')
        finishHttp = callback
      }),
    })
    const dependencies = createDependencies({
      getServer: () => server,
      closeCacheRedis: vi.fn(async () => {
        order.push('cache')
      }),
      closeCoordinationRedis: vi.fn(async () => {
        order.push('coordination')
      }),
      closePostgres: vi.fn(async () => {
        order.push('postgres')
      }),
    })
    const shutdown = createApiShutdownCoordinator(dependencies)

    const first = shutdown()
    const second = shutdown()

    expect(second).toBe(first)
    expect(order).toEqual(['http'])
    finishHttp()
    await first

    expect(order).toEqual(['http', 'cache', 'coordination', 'postgres'])
    expect(server.close).toHaveBeenCalledOnce()
    expect(server.closeAllConnections).not.toHaveBeenCalled()
  })

  test('forces HTTP cleanup and starts remaining resource cleanup at the deadline', async () => {
    vi.useFakeTimers()
    const server = createServer()
    const dependencies = createDependencies({ getServer: () => server, timeoutMs: 1_000 })
    const shutdown = createApiShutdownCoordinator(dependencies)

    const closing = shutdown()
    await vi.advanceTimersByTimeAsync(1_000)
    await closing

    expect(server.close).toHaveBeenCalledOnce()
    expect(server.closeAllConnections).toHaveBeenCalledOnce()
    expect(dependencies.closeCacheRedis).toHaveBeenCalledWith(0)
    expect(dependencies.closeCoordinationRedis).toHaveBeenCalledWith(0)
    expect(dependencies.closePostgres).toHaveBeenCalledWith(0)
    expect(dependencies.recordTimeout).toHaveBeenCalledOnce()
    expect(dependencies.markFailed).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  test('continues startup cleanup when resources are absent or unavailable', async () => {
    const dependencies = createDependencies({
      getServer: () => undefined,
      closeCacheRedis: vi.fn().mockRejectedValue(new Error('cache unavailable')),
      closeCoordinationRedis: vi.fn().mockResolvedValue(undefined),
      closePostgres: vi.fn().mockRejectedValue(new Error('postgres unavailable')),
    })

    await createApiShutdownCoordinator(dependencies)()

    expect(dependencies.closeCacheRedis).toHaveBeenCalledOnce()
    expect(dependencies.closeCoordinationRedis).toHaveBeenCalledOnce()
    expect(dependencies.closePostgres).toHaveBeenCalledOnce()
    expect(dependencies.recordFailure).toHaveBeenCalledTimes(2)
    expect(dependencies.markFailed).toHaveBeenCalledTimes(2)
    expect(dependencies.recordTimeout).not.toHaveBeenCalled()
  })
})

function createDependencies(
  overrides: Partial<ApiShutdownDependencies> = {},
): ApiShutdownDependencies {
  return {
    timeoutMs: 30_000,
    getServer: () => undefined,
    closeCacheRedis: vi.fn().mockResolvedValue(undefined),
    closeCoordinationRedis: vi.fn().mockResolvedValue(undefined),
    closePostgres: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn(),
    recordTimeout: vi.fn(),
    markFailed: vi.fn(),
    ...overrides,
  }
}

function createServer(overrides: Partial<ApiHttpServer> = {}): ApiHttpServer {
  return {
    close: vi.fn(),
    closeAllConnections: vi.fn(),
    ...overrides,
  }
}
