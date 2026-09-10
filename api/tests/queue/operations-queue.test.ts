import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  closeConnection: vi.fn(),
  connection: {
    disconnect: vi.fn(),
  },
  createConnection: vi.fn(),
  queue: {
    close: vi.fn(),
    disconnect: vi.fn(),
  },
  queueConstructor: vi.fn(),
}))

vi.mock('bullmq', () => ({
  Queue: function Queue(...args: unknown[]) {
    mocks.queueConstructor(...args)
    return mocks.queue
  },
}))

vi.mock('../../src/coordination-redis.js', () => ({
  closeCoordinationRedisConnection: mocks.closeConnection,
  createCoordinationRedisConnection: mocks.createConnection,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.closeConnection.mockResolvedValue(undefined)
  mocks.createConnection.mockReturnValue(mocks.connection)
  mocks.queue.close.mockResolvedValue(undefined)
  mocks.queue.disconnect.mockResolvedValue(undefined)
})

describe('operations queue ownership', () => {
  test('constructs the queue with its owned connection and repeat strategy', async () => {
    const repeatStrategy = vi.fn()
    const { createOperationsQueueHandle } = await import('../../src/queue/operations-queue.js')

    const handle = createOperationsQueueHandle({ repeatStrategy })

    expect(handle.connection).toBe(mocks.connection)
    expect(mocks.queueConstructor).toHaveBeenCalledWith('operations', {
      connection: mocks.connection,
      prefix: 'eve-space:v1',
      settings: { repeatStrategy },
      skipWaitingForReady: true,
    })
  })

  test('takes ownership of an injected connection and closes both resources once', async () => {
    const connection = { disconnect: vi.fn() }
    const { createOperationsQueueHandle } = await import('../../src/queue/operations-queue.js')
    const handle = createOperationsQueueHandle({ connection: connection as never })

    await Promise.all([handle.close(), handle.close()])
    await handle.close()

    expect(mocks.createConnection).not.toHaveBeenCalled()
    expect(mocks.queue.close).toHaveBeenCalledOnce()
    expect(mocks.closeConnection).toHaveBeenCalledOnce()
    expect(mocks.closeConnection).toHaveBeenCalledWith(connection)
  })

  test('force-disconnects both owned resources', async () => {
    const { createOperationsQueueHandle } = await import('../../src/queue/operations-queue.js')
    const handle = createOperationsQueueHandle()

    handle.disconnect()

    expect(mocks.connection.disconnect).toHaveBeenCalledOnce()
    expect(mocks.queue.disconnect).toHaveBeenCalledOnce()
  })

  test('handles BullMQ rejection while force-disconnecting', async () => {
    mocks.queue.disconnect.mockRejectedValueOnce(new Error('disconnect failed'))
    const { createOperationsQueueHandle } = await import('../../src/queue/operations-queue.js')
    const handle = createOperationsQueueHandle()

    handle.disconnect()
    await new Promise((resolve) => setImmediate(resolve))

    expect(mocks.queue.disconnect).toHaveBeenCalledOnce()
  })
})
