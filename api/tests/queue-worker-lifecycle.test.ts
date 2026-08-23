import { afterEach, describe, expect, test, vi } from 'vitest'
import { createActiveJobTracker, startWorkerHeartbeat } from '../src/queue/worker-lifecycle.js'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('worker lifecycle', () => {
  test('clears the shutdown timer when active work drains', async () => {
    vi.useFakeTimers()
    const tracker = createActiveJobTracker()
    let release: (() => void) | undefined
    const operation = tracker.run(() => new Promise<void>((resolve) => (release = resolve)))
    const idle = tracker.waitForIdle(30_000)

    release?.()

    await expect(operation).resolves.toBeUndefined()
    await expect(idle).resolves.toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  test('times out without resolving a later idle waiter twice', async () => {
    vi.useFakeTimers()
    const tracker = createActiveJobTracker()
    let release: (() => void) | undefined
    const operation = tracker.run(() => new Promise<void>((resolve) => (release = resolve)))
    const idle = tracker.waitForIdle(30_000)

    await vi.advanceTimersByTimeAsync(30_000)
    await expect(idle).resolves.toBe(false)
    release?.()
    await expect(operation).resolves.toBeUndefined()
  })

  test('refreshes heartbeat state and handles a later Redis rejection', async () => {
    vi.useFakeTimers()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const connection = heartbeatConnection()
    const stop = await startWorkerHeartbeat(connection as never, 'worker-a')
    connection.set.mockRejectedValueOnce(new Error('OOM'))

    await vi.advanceTimersByTimeAsync(15_000)

    expect(error).toHaveBeenCalledWith('Worker heartbeat update failed')
    expect(connection.set).toHaveBeenCalledWith(
      'eve-space:v1:scheduler:outcome',
      'registered',
      'EX',
      60,
    )
    stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  test('publishes a beat under this replica and registers it after the key exists', async () => {
    const connection = heartbeatConnection()
    const stop = await startWorkerHeartbeat(connection as never, 'worker-a')
    stop()

    expect(connection.set).toHaveBeenCalledWith(
      'eve-space:v1:worker:heartbeat:worker-a',
      expect.any(String),
      'EX',
      60,
    )
    expect(connection.sadd).toHaveBeenCalledWith('eve-space:v1:worker:registry', 'worker-a')
    // Writing the key first keeps a pruning replica from seeing a registered id with no beat.
    expect(connection.set.mock.invocationCallOrder[0]).toBeLessThan(
      connection.sadd.mock.invocationCallOrder[0]!,
    )
  })

  test('drops replicas from the registry once their beat has expired', async () => {
    const connection = heartbeatConnection()
    connection.smembers.mockResolvedValue(['worker-a', 'departed', 'worker-b'])
    connection.mget.mockResolvedValue([new Date().toISOString(), null, new Date().toISOString()])

    const stop = await startWorkerHeartbeat(connection as never, 'worker-a')
    stop()

    expect(connection.mget).toHaveBeenCalledWith([
      'eve-space:v1:worker:heartbeat:worker-a',
      'eve-space:v1:worker:heartbeat:departed',
      'eve-space:v1:worker:heartbeat:worker-b',
    ])
    expect(connection.srem).toHaveBeenCalledWith('eve-space:v1:worker:registry', ['departed'])
  })

  test('leaves the registry alone while every replica is beating', async () => {
    const connection = heartbeatConnection()
    connection.smembers.mockResolvedValue(['worker-a'])
    connection.mget.mockResolvedValue([new Date().toISOString()])

    const stop = await startWorkerHeartbeat(connection as never, 'worker-a')
    stop()

    expect(connection.srem).not.toHaveBeenCalled()
  })
})

function heartbeatConnection() {
  return {
    set: vi.fn().mockResolvedValue('OK'),
    sadd: vi.fn().mockResolvedValue(1),
    srem: vi.fn().mockResolvedValue(1),
    smembers: vi.fn().mockResolvedValue([]),
    mget: vi.fn().mockResolvedValue([]),
  }
}
