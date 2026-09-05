import { afterEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  close: vi.fn().mockResolvedValue(undefined),
  connection: {},
  read: vi.fn().mockResolvedValue({ operations: [], groups: [] }),
  waitForReady: vi.fn(),
}))

vi.mock('../../src/esi-resilience/cache-redis.js', () => ({
  closeSharedCacheRedisConnection: mocks.close,
  getSharedCacheRedisConnection: () => mocks.connection,
  waitForCacheRedisConnection: mocks.waitForReady,
}))

vi.mock('../../src/esi-resilience/rate-measurement.js', () => ({
  readEsiRateMeasurement: mocks.read,
}))

afterEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('ESI call-rate report command', () => {
  test('waits for Cache Redis readiness before reading measurements', async () => {
    let resolveReadiness: (() => void) | undefined
    const readiness = new Promise<void>((resolve) => {
      resolveReadiness = resolve
    })
    mocks.waitForReady.mockReturnValue(readiness)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    const command = import('../../src/commands/report-esi-call-rates.js')

    await vi.waitFor(() => expect(mocks.waitForReady).toHaveBeenCalledWith(mocks.connection))
    expect(mocks.read).not.toHaveBeenCalled()

    resolveReadiness?.()
    await command

    expect(mocks.read).toHaveBeenCalledWith(mocks.connection, { windowOffset: 1 })
    expect(mocks.close).toHaveBeenCalledOnce()
  })
})
