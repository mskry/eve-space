import { afterEach, expect, test, vi } from 'vitest'
import { createPlatformInventoryQuery } from '../src/runtime/inventory-query.js'
import { ApiQueryError } from '../src/runtime/query-error.js'

const verdict = (fingerprint = 'a'.repeat(64), ownerId = 'owner-a') => ({
  ownerId,
  fingerprint,
  validForMilliseconds: 60_000,
})
const deferred = <Value>() => {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const setup = () => {
  const admit = vi.fn().mockResolvedValue(verdict())
  const query = createPlatformInventoryQuery<string>({ admit, ownerId: () => 'owner-a' })
  return { query, admit }
}
afterEach(() => vi.useRealTimers())

test('suspends readable data on an unavailable verdict and releases it only after the same live admission', async () => {
  const { query, admit } = setup()
  await query.check()
  await query.run(async () => 'private holdings')
  expect(query.data.value).toBe('private holdings')
  admit.mockRejectedValueOnce(new Error('network unavailable'))
  await query.check()
  expect(query.status.value).toBe('unavailable')
  expect(query.data.value).toBeUndefined()
  await query.check()
  expect(query.data.value).toBe('private holdings')
  query.dispose()
})

test.each([401, 403, 404, 409])(
  'clears known invalidation at status %s so later admission cannot revive holdings',
  async (status) => {
    const { query, admit } = setup()
    await query.check()
    await query.run(async () => 'private holdings')
    admit.mockRejectedValueOnce(new ApiQueryError('Denied', { status }))
    await query.check()
    expect(query.status.value).toBe('denied')
    await query.check()
    expect(query.data.value).toBeUndefined()
    query.dispose()
  },
)

test('changed full authority fingerprints clear results rather than substituting a new admitted set', async () => {
  const { query, admit } = setup()
  await query.check()
  await query.run(async () => 'old subject set')
  admit.mockResolvedValueOnce(verdict('b'.repeat(64)))
  await query.check()
  expect(query.data.value).toBeUndefined()
  await query.run(async () => 'current subject set')
  expect(query.data.value).toBe('current subject set')
  query.dispose()
})

test('rejects a superseded response even when its transport ignores cancellation', async () => {
  const { query } = setup()
  const old = deferred<string>()
  await query.check()
  const pending = query.run(() => old.promise)
  query.invalidate()
  await query.check()
  await query.run(async () => 'new scope')
  old.resolve('old scope secret')
  await pending
  expect(query.data.value).toBe('new scope')
  query.dispose()
})

test('ignores a late admission and refuses a different owner', async () => {
  const { query, admit } = setup()
  const old = deferred<ReturnType<typeof verdict>>()
  admit.mockReturnValueOnce(old.promise)
  const pending = query.check()
  query.invalidate()
  await query.check()
  await query.run(async () => 'fresh scope')
  old.resolve(verdict('c'.repeat(64)))
  expect(await pending).toBe(false)
  expect(query.data.value).toBe('fresh scope')
  admit.mockResolvedValueOnce(verdict('d'.repeat(64), 'owner-b'))
  expect(await query.check()).toBe(false)
  expect(query.data.value).toBeUndefined()
  query.dispose()
})

test('suspends on admission expiry and rejects a load that finishes after its window', async () => {
  vi.useFakeTimers()
  const { query } = setup()
  await query.check()
  await query.run(async () => 'retained')
  const slow = deferred<string>()
  const pending = query.run(() => slow.promise)
  await vi.advanceTimersByTimeAsync(60_000)
  slow.resolve('late secret')
  await pending
  expect(query.status.value).toBe('unavailable')
  expect(query.data.value).toBeUndefined()
  await query.check()
  expect(query.data.value).toBe('retained')
  query.dispose()
})

test('source restart clears the previous rows and an unavailable read retains them behind verification', async () => {
  const { query } = setup()
  await query.check()
  await query.run(async () => 'rows')
  await query.run(async () => {
    throw new Error('network unavailable')
  })
  expect(query.data.value).toBeUndefined()
  await query.check()
  expect(query.data.value).toBe('rows')
  await query.run(async () => {
    throw new ApiQueryError('Restart', { code: 'INVENTORY_SOURCE_CHANGED', status: 409 })
  })
  await query.check()
  expect(query.data.value).toBeUndefined()
  query.dispose()
})
