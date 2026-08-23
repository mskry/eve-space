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
  test('bounds producer reconnects and configures worker blocking connections', async () => {
    const {
      createProducerRedisConnection,
      createProbeRedisConnection,
      createWorkerRedisConnection,
    } = await import('../src/queue/redis.js')
    createProducerRedisConnection('redis://producer')
    createProbeRedisConnection('redis://probe')
    createWorkerRedisConnection('redis://worker')

    const producer = mocks.instances[0]!
    const probe = mocks.instances[1]!
    const worker = mocks.instances[2]!
    const producerOptions = producer.options as {
      retryStrategy: (attempt: number) => number | null
      maxRetriesPerRequest: number
    }
    const workerOptions = worker.options as { maxRetriesPerRequest: null }
    expect(producerOptions.retryStrategy(4)).toBeNull()
    expect(producerOptions.maxRetriesPerRequest).toBe(1)
    expect(producerOptions).not.toHaveProperty('commandTimeout', 1_000)
    expect(probe.options).toMatchObject({ commandTimeout: 1_000 })
    expect(workerOptions.maxRetriesPerRequest).toBeNull()
  })

  test('quits healthy connections and force-disconnects unavailable ones', async () => {
    const { closeQueueRedisConnection } = await import('../src/queue/redis.js')
    const quit = vi.fn().mockRejectedValue(new Error('timeout'))
    const disconnect = vi.fn()

    await closeQueueRedisConnection({ status: 'ready', quit, disconnect } as never)

    expect(quit).toHaveBeenCalledOnce()
    expect(disconnect).toHaveBeenCalledOnce()
  })
})
