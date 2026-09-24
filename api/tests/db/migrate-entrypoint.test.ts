import { afterEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  end: vi.fn(),
  runStartupMigrations: vi.fn(),
}))

vi.mock('../../src/db/client.js', () => ({ sql: { end: mocks.end } }))
vi.mock('../../src/db/startup-migrations.js', () => ({
  runStartupMigrations: mocks.runStartupMigrations,
}))

afterEach(() => {
  process.exitCode = 0
  vi.clearAllMocks()
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('migration entrypoint diagnostics', () => {
  test('captures migration and cleanup failures without exposing arbitrary errors', async () => {
    mocks.runStartupMigrations.mockResolvedValueOnce(undefined)
    mocks.end
      .mockRejectedValueOnce(privateError('migration'))
      .mockRejectedValueOnce(privateError('cleanup'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { apiLogger } = await import('../../src/logging.js')
    apiLogger.enableLogging()

    try {
      await import('../../src/db/migrate.js')

      expect(consoleError).toHaveBeenCalledTimes(2)
      expect(process.exitCode).toBe(1)
      for (const call of consoleError.mock.calls) {
        const serialized = String(call[0])
        expect(JSON.parse(serialized)).toStrictEqual(
          expect.objectContaining({
            event: 'database.migration.failed',
            thrownType: 'object',
          }),
        )
        expect(serialized).not.toContain('private-sentinel')
      }
    } finally {
      apiLogger.disableLogging()
    }
  })
})

function privateError(prefix: string) {
  const cause = new Error(`${prefix}-cause-private-sentinel`)
  const error = Object.assign(new Error(`${prefix}-message-private-sentinel`, { cause }), {
    sql: `${prefix}-property-private-sentinel`,
  })
  error.stack = `Error: message\n    at migrate (file:///${prefix}-stack-private-sentinel.ts:4:2)`
  return error
}
