import { afterEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  checkWorkerDependencies: vi.fn(),
  end: vi.fn(),
  probeScopedWorkerLiveness: vi.fn(),
}))

vi.mock('../../src/db/client.js', () => ({ sql: { end: mocks.end } }))
vi.mock('../../src/queue/worker-identity.js', () => ({ workerId: 'worker-test' }))
vi.mock('../../src/queue/worker-liveness.js', () => ({
  probeScopedWorkerLiveness: mocks.probeScopedWorkerLiveness,
}))
vi.mock('../../src/worker/readiness.js', () => ({
  checkWorkerDependencies: mocks.checkWorkerDependencies,
}))

afterEach(() => {
  process.exitCode = 0
  vi.clearAllMocks()
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('worker healthcheck entrypoint', () => {
  test('captures healthcheck errors without exposing arbitrary Error contents', async () => {
    expect.hasAssertions()
    const error = privateError('healthcheck')
    mocks.checkWorkerDependencies.mockRejectedValueOnce(error)
    mocks.end.mockResolvedValueOnce(undefined)

    await expectCapturedDiagnostic('worker.healthcheck.failed')
  })

  test('captures cleanup errors without exposing arbitrary Error contents', async () => {
    expect.hasAssertions()
    const error = privateError('cleanup')
    mocks.checkWorkerDependencies.mockResolvedValueOnce({ healthy: true })
    mocks.end.mockRejectedValueOnce(error)

    await expectCapturedDiagnostic('worker.healthcheck.cleanup-failed')
  })

  test('distinguishes database outages from schema drift', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.checkWorkerDependencies.mockResolvedValueOnce({
      healthy: false,
      reason: 'Database unavailable',
    })
    mocks.end.mockResolvedValueOnce(undefined)
    const { apiLogger } = await import('../../src/logging.js')
    apiLogger.enableLogging()
    try {
      await import('../../src/worker/health.js')

      expect(consoleError).toHaveBeenCalledOnce()
      expect(JSON.parse(String(consoleError.mock.calls[0]?.[0]))).toStrictEqual(
        expect.objectContaining({
          event: 'worker.healthcheck.unhealthy',
          healthState: 'database-unavailable',
        }),
      )
      expect(process.exitCode).toBe(1)
    } finally {
      apiLogger.disableLogging()
    }
  })
})

async function expectCapturedDiagnostic(event: string) {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const { apiLogger } = await import('../../src/logging.js')
  apiLogger.enableLogging()
  try {
    await import('../../src/worker/health.js')

    expect(consoleError).toHaveBeenCalledOnce()
    expect(process.exitCode).toBe(1)
    const serialized = String(consoleError.mock.calls[0]?.[0])
    expect(JSON.parse(serialized)).toStrictEqual(
      expect.objectContaining({ event, thrownType: 'object' }),
    )
    expect(serialized).not.toContain('private-sentinel')
  } finally {
    apiLogger.disableLogging()
  }
}

function privateError(prefix: string) {
  const cause = new Error(`${prefix}-cause-private-sentinel`)
  cause.stack = `Error: cause\n    at cause (file:///${prefix}-cause-private-sentinel.ts:2:1)`
  const error = Object.assign(new Error(`${prefix}-message-private-sentinel`, { cause }), {
    credentials: `${prefix}-property-private-sentinel`,
  })
  error.stack = `Error: message\n    at health (file:///${prefix}-stack-private-sentinel.ts:4:2)`
  return error
}
