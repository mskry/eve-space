import { describe, expect, test, vi } from 'vitest'
import { installShutdownSignalHandlers } from '../../src/shutdown-signals.js'

describe('shutdown signal handlers', () => {
  test('forwards repeated signals and disposes both listeners', () => {
    const requestShutdown = vi.fn()
    const beforeInterrupt = process.listeners('SIGINT')
    const beforeTerminate = process.listeners('SIGTERM')
    const dispose = installShutdownSignalHandlers(requestShutdown)
    const interrupt = addedListener('SIGINT', beforeInterrupt)
    const terminate = addedListener('SIGTERM', beforeTerminate)

    interrupt('SIGINT')
    terminate('SIGTERM')
    dispose()

    expect(requestShutdown).toHaveBeenCalledTimes(2)
    expect(process.listeners('SIGINT')).toEqual(beforeInterrupt)
    expect(process.listeners('SIGTERM')).toEqual(beforeTerminate)
  })
})

function addedListener(signal: 'SIGINT' | 'SIGTERM', existing: NodeJS.SignalsListener[]) {
  return process.listeners(signal).find((listener) => !existing.includes(listener))!
}
