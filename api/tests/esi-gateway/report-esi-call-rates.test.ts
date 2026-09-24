import { afterEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  read: vi.fn().mockResolvedValue({ groups: [], operations: [] }),
}))

vi.mock('../../src/esi-gateway/status-interface.js', () => ({
  readEsiCallRateReport: mocks.read,
}))

afterEach(() => {
  process.exitCode = 0
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

  test('records failures without exposing arbitrary errors or writing command output', async () => {
    const error = Object.assign(new Error('message-private-sentinel'), {
      authorization: 'property-private-sentinel',
      cause: new Error('cause-private-sentinel'),
    })
    error.stack = 'Error: stack-private-sentinel'
    mocks.read.mockRejectedValueOnce(error)
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { apiLogger } = await import('../../src/logging.js')
    apiLogger.enableLogging()

    try {
      await import('../../src/commands/report-esi-call-rates.js')

      expect(stdout).not.toHaveBeenCalled()
      expect(process.exitCode).toBe(1)
      const serialized = String(consoleError.mock.calls[0]?.[0])
      expect(JSON.parse(serialized)).toStrictEqual(
        expect.objectContaining({
          event: 'command.esi-call-rate-report.failed',
          thrownType: 'object',
        }),
      )
      expect(serialized).not.toContain('private-sentinel')
    } finally {
      apiLogger.disableLogging()
    }
  })
})
