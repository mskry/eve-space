import { expect, test, vi } from 'vitest'
import { EsiReadWaiters } from '../../src/esi-gateway/internal/read-waiters.js'
import { createDeferred } from '../support/deferred.js'

test('one waiter detaches and the final waiter cancels the upstream exactly once', async () => {
  const waiters = new EsiReadWaiters()
  const pending = createDeferred<number>()
  const canceled = vi.fn()
  const load = vi.fn((signal: AbortSignal) => {
    signal.addEventListener('abort', canceled, { once: true })
    return pending.promise
  })
  const first = new AbortController()
  const second = new AbortController()
  const a = waiters.read('source', first.signal, load)
  const b = waiters.read('source', second.signal, load)
  await Promise.resolve()
  first.abort(new Error('First left'))
  await expect(a).rejects.toThrow('First left')
  expect(canceled).not.toHaveBeenCalled()
  second.abort(new Error('Second left'))
  await expect(b).rejects.toThrow('Second left')
  expect(canceled).toHaveBeenCalledOnce()
  expect(load).toHaveBeenCalledOnce()
  pending.reject(new Error('Upstream aborted'))
})

test('a replacement waiter never joins an abandoned source or a different identity', async () => {
  const waiters = new EsiReadWaiters()
  const pending = createDeferred<number>()
  const first = new AbortController()
  const old = waiters.read('owner-a', first.signal, () => pending.promise)
  await Promise.resolve()
  first.abort(new Error('Left'))
  await expect(old).rejects.toThrow('Left')
  await expect(waiters.read('owner-a', undefined, async () => 2)).resolves.toBe(2)
  await expect(waiters.read('owner-b', undefined, async () => 3)).resolves.toBe(3)
  pending.resolve(1)
})

test('source failures propagate to independent callers and are not retained', async () => {
  const waiters = new EsiReadWaiters()
  const failure = new Error('Attempt deadline')
  const load = vi.fn(async () => {
    throw failure
  })
  const outcomes = await Promise.allSettled([
    waiters.read('source', undefined, load),
    waiters.read('source', undefined, load),
  ])
  expect(outcomes).toEqual([
    { status: 'rejected', reason: failure },
    { status: 'rejected', reason: failure },
  ])
  expect(load).toHaveBeenCalledOnce()
  await expect(waiters.read('source', undefined, async () => 1)).resolves.toBe(1)
})
