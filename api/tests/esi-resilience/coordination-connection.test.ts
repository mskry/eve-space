import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('../../src/coordination-redis.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/coordination-redis.js')>()),
  createCoordinationRedisConnection: mocks.create,
}))

beforeEach(() => {
  vi.resetModules()
  mocks.create.mockReset()
})

describe('shared coordination Redis lifecycle', () => {
  test('closing before first use does not create a connection', async () => {
    const { closeSharedCoordinationRedisConnection } =
      await import('../../src/esi-resilience/coordination-connection.js')

    await closeSharedCoordinationRedisConnection()
    await closeSharedCoordinationRedisConnection()

    expect(mocks.create).not.toHaveBeenCalled()
  })

  test('shares pending closure and creates a fresh connection only after it settles', async () => {
    const { getCoordinationConnection, closeSharedCoordinationRedisConnection } =
      await import('../../src/esi-resilience/coordination-connection.js')
    let resolveQuit: (() => void) | undefined
    const quit = new Promise<void>((resolve) => {
      resolveQuit = resolve
    })
    const first = { status: 'ready', quit: vi.fn(() => quit), disconnect: vi.fn() }
    const second = { status: 'ready', quit: vi.fn().mockResolvedValue('OK'), disconnect: vi.fn() }
    mocks.create.mockReturnValueOnce(first).mockReturnValueOnce(second)

    expect(getCoordinationConnection()).toBe(first)
    expect(getCoordinationConnection()).toBe(first)
    expect(mocks.create).toHaveBeenCalledOnce()

    const closing = closeSharedCoordinationRedisConnection()
    let closed = false
    void closing.then(() => {
      closed = true
    })
    expect(closeSharedCoordinationRedisConnection()).toBe(closing)
    expect(getCoordinationConnection).toThrow('Coordination Redis connection is closing')
    await Promise.resolve()
    expect(closed).toBe(false)
    expect(first.quit).toHaveBeenCalledOnce()
    expect(mocks.create).toHaveBeenCalledOnce()

    resolveQuit?.()
    await closing
    await closeSharedCoordinationRedisConnection()
    expect(first.quit).toHaveBeenCalledOnce()
    expect(first.disconnect).not.toHaveBeenCalled()
    expect(mocks.create).toHaveBeenCalledOnce()

    expect(getCoordinationConnection()).toBe(second)
    await closeSharedCoordinationRedisConnection()
    expect(second.quit).toHaveBeenCalledOnce()
  })

  test('disconnects once when quit fails and forgets the failed connection', async () => {
    const { getCoordinationConnection, closeSharedCoordinationRedisConnection } =
      await import('../../src/esi-resilience/coordination-connection.js')
    const connection = {
      status: 'ready',
      quit: vi.fn().mockRejectedValue(new Error('Redis unavailable')),
      disconnect: vi.fn(),
    }
    const replacement = { status: 'end', quit: vi.fn(), disconnect: vi.fn() }
    mocks.create.mockReturnValueOnce(connection).mockReturnValueOnce(replacement)
    getCoordinationConnection()

    const closing = closeSharedCoordinationRedisConnection()
    expect(closeSharedCoordinationRedisConnection()).toBe(closing)
    await closing
    await closeSharedCoordinationRedisConnection()

    expect(connection.quit).toHaveBeenCalledOnce()
    expect(connection.disconnect).toHaveBeenCalledOnce()
    expect(getCoordinationConnection()).toBe(replacement)
    await closeSharedCoordinationRedisConnection()
  })

  test.each(['wait', 'end'])('forgets a %s connection without sending QUIT', async (status) => {
    const { getCoordinationConnection, closeSharedCoordinationRedisConnection } =
      await import('../../src/esi-resilience/coordination-connection.js')
    const connection = { status, quit: vi.fn(), disconnect: vi.fn() }
    const replacement = { status: 'end', quit: vi.fn(), disconnect: vi.fn() }
    mocks.create.mockReturnValueOnce(connection).mockReturnValueOnce(replacement)
    getCoordinationConnection()

    await closeSharedCoordinationRedisConnection()
    await closeSharedCoordinationRedisConnection()

    expect(connection.quit).not.toHaveBeenCalled()
    expect(connection.disconnect).toHaveBeenCalledTimes(status === 'wait' ? 1 : 0)
    expect(getCoordinationConnection()).toBe(replacement)
    await closeSharedCoordinationRedisConnection()
  })
})
