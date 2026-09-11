import { describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  acquireLocalPermit: vi.fn(),
}))

vi.mock('../../src/esi-resilience/local-quota.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/esi-resilience/local-quota.js')>()),
  acquireLocalEsiRequestPermit: mocks.acquireLocalPermit,
}))

import { acquireEsiRequestPermit } from '../../src/esi-resilience/permits.js'

describe('ESI request permit cancellation', () => {
  test('does not enter local fallback when distributed permit waiting is aborted', async () => {
    const controller = new AbortController()
    const connection = {
      get: vi.fn().mockResolvedValue(null),
      eval: vi.fn().mockResolvedValue(0),
    }
    const pending = acquireEsiRequestPermit({
      connection: connection as never,
      operation: 'status',
      concurrency: 1,
      signal: controller.signal,
    })

    await vi.waitFor(() => expect(connection.eval).toHaveBeenCalledOnce())
    controller.abort()

    await expect(pending).rejects.toBe(controller.signal.reason)
    expect(controller.signal.reason).toMatchObject({ name: 'AbortError' })
    expect(mocks.acquireLocalPermit).not.toHaveBeenCalled()
  })
})
