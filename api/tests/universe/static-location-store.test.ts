import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  readStaticLocationRevision,
  staticLocationDatabaseOperationTimeoutMilliseconds,
} from '../../src/universe/static-location-store.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('static location database operation deadline', () => {
  test('bounds waiting for a pooled connection', async () => {
    vi.useFakeTimers()
    const database = {
      begin: vi.fn(() => new Promise(() => {})),
    }
    const reading = readStaticLocationRevision(database as never)
    const outcome = reading.catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(staticLocationDatabaseOperationTimeoutMilliseconds)

    await expect(outcome).resolves.toMatchObject({
      message: 'Static location database operation timed out',
    })
    expect(database.begin).toHaveBeenCalledTimes(1)
  })

  test('abandons a late acquisition before it can execute SQL', async () => {
    vi.useFakeTimers()
    const acquired = deferred<void>()
    const query = vi.fn()
    const database = {
      begin: vi.fn((_options: string, load: (transaction: typeof query) => Promise<unknown>) =>
        acquired.promise.then(() => load(query)),
      ),
    }
    const reading = readStaticLocationRevision(database as never)
    const outcome = reading.catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(staticLocationDatabaseOperationTimeoutMilliseconds)
    await expect(outcome).resolves.toMatchObject({
      message: 'Static location database operation timed out',
    })

    acquired.resolve()
    await vi.runAllTimersAsync()
    await Promise.resolve()
    expect(query).not.toHaveBeenCalled()
  })
})

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
