import { afterEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ instances: [] as Array<Record<string, unknown>> }))

vi.mock('ioredis', () => ({
  Redis: class {
    status = 'ready'
    constructor(url: string, options: Record<string, unknown>) {
      mocks.instances.push({
        url,
        options,
        on: vi.fn(),
        quit: vi.fn(),
        disconnect: vi.fn(),
        status: this.status,
      })
      Object.assign(this, mocks.instances.at(-1))
    }
  },
}))

afterEach(() => {
  mocks.instances.length = 0
  vi.resetModules()
})

describe('coordination Redis connections', () => {
  test('preserves bounded and probe profiles with safe error handling', async () => {
    const { createCoordinationRedisConnection, createCoordinationRedisProbe } =
      await import('../src/coordination-redis.js')
    createCoordinationRedisConnection('redis://bounded')
    createCoordinationRedisProbe('redis://probe')

    const bounded = mocks.instances[0]!
    const probe = mocks.instances[1]!
    const options = bounded.options as {
      connectTimeout: number
      lazyConnect: boolean
      maxRetriesPerRequest: number
      retryStrategy: (attempt: number) => number | null
    }
    expect(options).toMatchObject({
      connectTimeout: 1_000,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    })
    expect(options.retryStrategy(1)).toBe(100)
    expect(options.retryStrategy(4)).toBeNull()
    expect(options).not.toHaveProperty('commandTimeout')
    expect(probe.options).toMatchObject({ commandTimeout: 1_000 })
    expect(bounded.on).toHaveBeenCalledWith('error', expect.any(Function))
    expect(probe.on).toHaveBeenCalledWith('error', expect.any(Function))

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const listener = (bounded.on as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as
      | ((error: Error) => void)
      | undefined
    expect(() => listener?.(new Error('redis://user:password@private-host'))).not.toThrow()
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  test('quits healthy connections, disconnects failed closes, and ignores ended clients', async () => {
    const { closeCoordinationRedisConnection } = await import('../src/coordination-redis.js')
    const quit = vi.fn().mockRejectedValue(new Error('timeout'))
    const disconnect = vi.fn()

    await closeCoordinationRedisConnection({ status: 'ready', quit, disconnect } as never)
    await closeCoordinationRedisConnection({ status: 'end', quit, disconnect } as never)

    expect(quit).toHaveBeenCalledOnce()
    expect(disconnect).toHaveBeenCalledOnce()
  })
})
