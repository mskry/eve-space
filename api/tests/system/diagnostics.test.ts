import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { apiLogger, attachDiagnosticErrorListener, recordDiagnostic } from '../../src/logging.js'

afterEach(() => {
  apiLogger.clearContext()
  apiLogger.disableLogging()
  vi.restoreAllMocks()
})

describe('runtime diagnostics', () => {
  test('emits only explicit allowlisted context without inherited logger context', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const correlationId = '98a782d2-e042-47d7-9659-03b218121a1a'
    const error = privateError('recorder')
    apiLogger.withContext({ authorization: 'inherited-private-sentinel' })
    apiLogger.enableLogging()

    recordDiagnostic('worker.job.failed', {
      correlationId,
      context: {
        jobName: 'resource-refresh',
        secretContext: 'context-private-sentinel',
      } as never,
      error,
      failureCategory: 'unsupported-private-category' as never,
    })

    const serialized = String(consoleError.mock.calls[0]?.[0])
    expect(JSON.parse(serialized)).toEqual(
      expect.objectContaining({
        correlationId,
        event: 'worker.job.failed',
        jobName: 'resource-refresh',
        thrownType: 'object',
      }),
    )
    expect(JSON.parse(serialized)).not.toHaveProperty('failureCategory')
    expect(serialized).not.toContain('private-sentinel')
  })

  test.each(['queue.runtime.failed', 'worker.runtime.failed'] as const)(
    'captures %s Error contents without raw fallback output',
    (event) => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const source = new EventEmitter()
      const error = privateError(event)
      apiLogger.enableLogging()
      attachDiagnosticErrorListener(source, event)

      source.emit('error', error)

      expect(consoleError).toHaveBeenCalledOnce()
      const serialized = String(consoleError.mock.calls[0]?.[0])
      expect(JSON.parse(serialized)).toEqual(
        expect.objectContaining({ event, thrownType: 'object' }),
      )
      expect(serialized).not.toContain('private-sentinel')
    },
  )
})

function privateError(prefix: string) {
  const cause = new Error(`${prefix}-cause-private-sentinel`)
  cause.stack = `Error: cause\n    at cause (file:///${prefix}-cause-private-sentinel.ts:2:1)`
  const error = Object.assign(new Error(`${prefix}-message-private-sentinel`, { cause }), {
    authorization: `${prefix}-property-private-sentinel`,
    response: { body: `${prefix}-body-private-sentinel` },
  })
  error.stack = `Error: message\n    at runtime (file:///${prefix}-stack-private-sentinel.ts:4:2)`
  return error
}
