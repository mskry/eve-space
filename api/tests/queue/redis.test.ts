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

afterEach(() => vi.resetModules())

describe('queue Redis connections', () => {
  test('configures worker blocking connections', async () => {
    const { createWorkerRedisConnection } = await import('../../src/queue/redis.js')
    createWorkerRedisConnection('redis://worker')

    const worker = mocks.instances[0]!
    const workerOptions = worker.options as {
      connectTimeout: number
      lazyConnect: boolean
      maxRetriesPerRequest: null
      retryStrategy: (attempt: number) => number
    }
    expect(workerOptions).toMatchObject({
      connectTimeout: 1_000,
      lazyConnect: true,
      maxRetriesPerRequest: null,
    })
    expect(workerOptions.retryStrategy(25)).toBe(2_000)
    expect(workerOptions.maxRetriesPerRequest).toBeNull()
    expect(worker.on).toHaveBeenCalledWith('error', expect.any(Function))
  })
})
