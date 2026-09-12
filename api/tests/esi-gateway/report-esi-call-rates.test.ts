import { afterEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  read: vi.fn().mockResolvedValue({ operations: [], groups: [] }),
}))

vi.mock('../../src/esi-gateway/status-interface.js', () => ({
  readEsiCallRateReport: mocks.read,
}))

afterEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('ESI call-rate report command', () => {
  test('reads safe measurements through the status interface', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await import('../../src/commands/report-esi-call-rates.js')

    expect(mocks.read).toHaveBeenCalledWith(1)
  })
})
