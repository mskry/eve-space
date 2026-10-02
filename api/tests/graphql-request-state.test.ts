import { describe, expect, it, vi } from 'vitest'
import { GraphQLRequestState } from '../src/graphql/request-state.js'
import { createSchema } from 'graphql-yoga'
import { graphql } from 'graphql'
import { applicationScalars } from '../src/graphql/scalars.js'

const admit = async () => {}

const deferred = <Result>() => {
  let resolve!: (result: Result) => void
  const promise = new Promise<Result>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

it('preserves bigint and undefined resolver values through memoization and scalar completion', async () => {
  const state = new GraphQLRequestState(new AbortController().signal)
  const number = 9007199254740993n
  const load = vi.fn(async () => ({ number, absent: undefined }))
  const schema = createSchema({
    typeDefs:
      'scalar BigInteger type Query { number: BigInteger dto: MemoValue absent: String } type MemoValue { number: BigInteger absent: String }',
    resolvers: {
      BigInteger: applicationScalars.BigInteger,
      Query: {
        number: () => state.read('number', admit, async () => number),
        dto: () => state.read('dto', admit, load),
        absent: () => state.read('absent', admit, async () => undefined),
      },
    },
  })
  const result = await graphql({
    schema,
    source: '{ number a: dto { number absent } b: dto { number absent } absent }',
  })
  expect(result.errors).toBeUndefined()
  expect(result.data).toEqual({
    number: '9007199254740993',
    a: { number: '9007199254740993', absent: null },
    b: { number: '9007199254740993', absent: null },
    absent: null,
  })
  expect(load).toHaveBeenCalledOnce()
  expect(await state.read('dto', admit, load)).toEqual({ number, absent: undefined })
})

it('enforces the retained-byte limit for bigint-containing results', async () => {
  const state = new GraphQLRequestState(new AbortController().signal)
  await expect(
    state.read('large', admit, async () => ({ number: 1n, text: 'x'.repeat(2_097_152) })),
  ).rejects.toMatchObject({ extensions: { code: 'OPERATION_LIMIT' } })
})

describe('GraphQL request reads', () => {
  it('memoizes concurrent reads and rechecks admission for cached results', async () => {
    const state = new GraphQLRequestState(new AbortController().signal)
    let allowed = true
    const admitted = async () => {
      if (!allowed) throw new Error('Access revoked')
    }
    const load = vi.fn(async (signal: AbortSignal) => {
      expect(signal).toBe(state.signal)
      return { value: 'ready' }
    })
    const results = await Promise.all([
      state.read('same', admitted, load),
      state.read('same', admitted, load),
    ])
    expect(results).toEqual([{ value: 'ready' }, { value: 'ready' }])
    expect(load).toHaveBeenCalledOnce()
    allowed = false
    await expect(state.read('same', admitted, load)).rejects.toThrow('Access revoked')
    allowed = true
    await expect(state.read('same', admitted, load)).resolves.toEqual({ value: 'ready' })
    expect(load).toHaveBeenCalledOnce()
    await state.read('other', admitted, load)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('limits distinct reads to four concurrent loads', async () => {
    const state = new GraphQLRequestState(new AbortController().signal)
    const gate = deferred<void>()
    let active = 0
    let peak = 0
    const load = vi.fn(async () => {
      active += 1
      peak = Math.max(peak, active)
      await gate.promise
      active -= 1
      return 'ready'
    })
    const reads = Array.from({ length: 10 }, (_, index) => state.read(String(index), admit, load))
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(4))
    gate.resolve()
    expect(await Promise.all(reads)).toHaveLength(10)
    expect(load).toHaveBeenCalledTimes(10)
    expect(peak).toBe(4)
  })

  it('retains the concurrency limit when a new read competes with a queued read', async () => {
    const state = new GraphQLRequestState(new AbortController().signal)
    const releases: (() => void)[] = []
    let active = 0
    let peak = 0
    const load = () => {
      active += 1
      peak = Math.max(peak, active)
      return new Promise<string>((resolve) =>
        releases.push(() => {
          active -= 1
          resolve('ready')
        }),
      )
    }
    const reads = Array.from({ length: 5 }, (_, index) => state.read(String(index), admit, load))
    await vi.waitFor(() => expect(releases).toHaveLength(4))
    releases.shift()!()
    queueMicrotask(() => reads.push(state.read('competitor', admit, load)))
    await vi.waitFor(() => expect(releases).toHaveLength(4))
    expect(peak).toBe(4)
    for (const release of releases.splice(0)) release()
    await vi.waitFor(() => expect(releases).toHaveLength(1))
    releases.shift()!()
    expect(await Promise.all(reads)).toHaveLength(6)
    expect(peak).toBe(4)
  })

  it('rechecks admission after queueing and before loading', async () => {
    const state = new GraphQLRequestState(new AbortController().signal)
    const gate = deferred<string>()
    const load = vi.fn(() => gate.promise)
    const active = Array.from({ length: 4 }, (_, index) => state.read(String(index), admit, load))
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(4))
    let allowed = true
    const admitted = vi.fn(async () => {
      if (!allowed) throw new Error('Access revoked')
    })
    const queuedLoad = vi.fn(async () => 'private')
    const queued = state.read('queued', admitted, queuedLoad)
    const rejection = queued.catch((error: Error) => error)
    await vi.waitFor(() => expect(admitted).toHaveBeenCalledOnce())
    allowed = false
    gate.resolve('ready')
    await Promise.all(active)
    expect(await rejection).toMatchObject({ message: 'Access revoked' })
    expect(queuedLoad).not.toHaveBeenCalled()
  })

  it('withholds a result if admission is revoked during loading', async () => {
    const state = new GraphQLRequestState(new AbortController().signal)
    const gate = deferred<string>()
    let allowed = true
    const admitted = async () => {
      if (!allowed) throw new Error('Access revoked')
    }
    const load = vi.fn(() => gate.promise)
    const read = state.read('private', admitted, load)
    const rejection = read.catch((error: Error) => error)
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce())
    allowed = false
    gate.resolve('private')
    expect(await rejection).toMatchObject({ message: 'Access revoked' })
  })

  it('cancels active and queued reads without starting queued loads', async () => {
    const controller = new AbortController()
    const state = new GraphQLRequestState(controller.signal)
    const gate = deferred<string>()
    const load = vi.fn(() => gate.promise)
    const reads = Array.from({ length: 5 }, (_, index) => state.read(String(index), admit, load))
    const results = Promise.allSettled(reads)
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(4))
    controller.abort(new Error('Request cancelled'))
    expect(await results).toEqual(
      Array.from({ length: 5 }, () => ({
        status: 'rejected',
        reason: controller.signal.reason,
      })),
    )
    gate.resolve('ready')
    expect(load).toHaveBeenCalledTimes(4)
    await expect(state.read('after-cancellation', admit, load)).rejects.toThrow('Request cancelled')
  })

  it('applies the deadline to an unresponsive load', async () => {
    const state = new GraphQLRequestState(new AbortController().signal, 20)
    const gate = deferred<string>()
    await expect(state.read('slow', admit, () => gate.promise)).rejects.toMatchObject({
      name: 'TimeoutError',
    })
    gate.resolve('ready')
  })

  it('applies cancellation while waiting for admission', async () => {
    const controller = new AbortController()
    const state = new GraphQLRequestState(controller.signal)
    const gate = deferred<void>()
    const load = vi.fn(async () => 'private')
    const read = state.read('private', () => gate.promise, load)
    const rejection = read.catch((error: Error) => error)
    controller.abort(new Error('Request cancelled'))
    expect(await rejection).toMatchObject({ message: 'Request cancelled' })
    gate.resolve()
    expect(load).not.toHaveBeenCalled()
  })

  it('limits unique reads and memoized result bytes', async () => {
    const state = new GraphQLRequestState(new AbortController().signal)
    const load = vi.fn(async () => 'ready')
    for (let index = 0; index < 32; index += 1) await state.read(String(index), admit, load)
    await expect(state.read('overflow', admit, load)).rejects.toMatchObject({
      extensions: { code: 'OPERATION_LIMIT' },
    })
    expect(load).toHaveBeenCalledTimes(32)
    const byteLimited = new GraphQLRequestState(new AbortController().signal)
    await expect(
      byteLimited.read('large', admit, async () => 'x'.repeat(2_097_152)),
    ).rejects.toMatchObject({ extensions: { code: 'OPERATION_LIMIT' } })
    await expect(byteLimited.read('x'.repeat(4097), admit, load)).rejects.toMatchObject({
      extensions: { code: 'OPERATION_LIMIT' },
    })
  })
})
