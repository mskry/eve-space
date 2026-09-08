import { performance } from 'node:perf_hooks'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { UniverseTopologySnapshot } from '../../src/universe/route-types.js'

const mocks = vi.hoisted(() => ({
  loadUniverseTopologySnapshot: vi.fn(),
  readActiveUniverseTopologyBuild: vi.fn(),
}))

vi.mock('../../src/universe/topology-store.js', () => ({
  loadUniverseTopologySnapshot: mocks.loadUniverseTopologySnapshot,
  readActiveUniverseTopologyBuild: mocks.readActiveUniverseTopologyBuild,
}))

import {
  getUniverseTopology,
  resetUniverseTopologyForTests,
  universeTopologyRevisionCheckIntervalMilliseconds,
} from '../../src/universe/topology.js'

let monotonicNow = 0

beforeEach(() => {
  vi.clearAllMocks()
  resetUniverseTopologyForTests()
  monotonicNow = 0
  vi.spyOn(performance, 'now').mockImplementation(() => monotonicNow)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('universe topology cache', () => {
  test('collapses concurrent cold loads and reuses a matching build', async () => {
    const loading = deferred<UniverseTopologySnapshot>()
    mocks.loadUniverseTopologySnapshot.mockReturnValue(loading.promise)

    const first = getUniverseTopology()
    const second = getUniverseTopology()
    await vi.waitFor(() => expect(mocks.loadUniverseTopologySnapshot).toHaveBeenCalledTimes(1))
    loading.resolve(topology(1234))

    await expect(Promise.all([first, second])).resolves.toEqual([topology(1234), topology(1234)])
    await expect(getUniverseTopology()).resolves.toEqual(topology(1234))
    expect(mocks.loadUniverseTopologySnapshot).toHaveBeenCalledTimes(1)
    expect(mocks.readActiveUniverseTopologyBuild).not.toHaveBeenCalled()
  })

  test('collapses a due revision check and reuses an unchanged build', async () => {
    mocks.loadUniverseTopologySnapshot.mockResolvedValue(topology(1234))
    await getUniverseTopology()

    monotonicNow = universeTopologyRevisionCheckIntervalMilliseconds
    const checking = deferred<number>()
    mocks.readActiveUniverseTopologyBuild.mockReturnValue(checking.promise)
    const first = getUniverseTopology()
    const second = getUniverseTopology()
    await vi.waitFor(() => expect(mocks.readActiveUniverseTopologyBuild).toHaveBeenCalledTimes(1))
    checking.resolve(1234)

    await expect(Promise.all([first, second])).resolves.toEqual([topology(1234), topology(1234)])
    expect(mocks.loadUniverseTopologySnapshot).toHaveBeenCalledTimes(1)
  })

  test('reloads topology after the active completed build changes', async () => {
    mocks.loadUniverseTopologySnapshot
      .mockResolvedValueOnce(topology(1234))
      .mockResolvedValueOnce(topology(1235))

    await expect(getUniverseTopology()).resolves.toEqual(topology(1234))
    monotonicNow = universeTopologyRevisionCheckIntervalMilliseconds
    mocks.readActiveUniverseTopologyBuild.mockResolvedValueOnce(1235)
    await expect(getUniverseTopology()).resolves.toEqual(topology(1235))
    expect(mocks.loadUniverseTopologySnapshot).toHaveBeenCalledTimes(2)
  })

  test('does not publish a load superseded by reset', async () => {
    const oldLoad = deferred<UniverseTopologySnapshot>()
    mocks.loadUniverseTopologySnapshot
      .mockReturnValueOnce(oldLoad.promise)
      .mockResolvedValueOnce(topology(1235))

    const superseded = getUniverseTopology()
    await vi.waitFor(() => expect(mocks.loadUniverseTopologySnapshot).toHaveBeenCalledTimes(1))
    resetUniverseTopologyForTests()
    await expect(getUniverseTopology()).resolves.toEqual(topology(1235))

    oldLoad.resolve(topology(1234))
    await expect(superseded).rejects.toThrow('superseded')
  })

  test('retains a warm snapshot through failed checks, throttles retries, and recovers', async () => {
    mocks.loadUniverseTopologySnapshot
      .mockResolvedValueOnce(topology(1234))
      .mockResolvedValueOnce(topology(1235))
    await getUniverseTopology()

    monotonicNow = universeTopologyRevisionCheckIntervalMilliseconds
    mocks.readActiveUniverseTopologyBuild.mockRejectedValueOnce(new Error('Database unavailable'))
    await expect(getUniverseTopology()).resolves.toEqual(topology(1234))
    await expect(getUniverseTopology()).resolves.toEqual(topology(1234))
    expect(mocks.readActiveUniverseTopologyBuild).toHaveBeenCalledTimes(1)

    monotonicNow += universeTopologyRevisionCheckIntervalMilliseconds
    mocks.readActiveUniverseTopologyBuild.mockResolvedValueOnce(1235)
    await expect(getUniverseTopology()).resolves.toEqual(topology(1235))
  })

  test('throttles cold failures and initializes after the retry interval', async () => {
    const failure = new Error('Database unavailable')
    mocks.loadUniverseTopologySnapshot.mockRejectedValueOnce(failure)

    await expect(getUniverseTopology()).rejects.toBe(failure)
    await expect(getUniverseTopology()).rejects.toBe(failure)
    expect(mocks.loadUniverseTopologySnapshot).toHaveBeenCalledTimes(1)

    monotonicNow = universeTopologyRevisionCheckIntervalMilliseconds
    mocks.loadUniverseTopologySnapshot.mockResolvedValueOnce(topology(1234))
    await expect(getUniverseTopology()).resolves.toEqual(topology(1234))
    expect(mocks.loadUniverseTopologySnapshot).toHaveBeenCalledTimes(2)
  })

  test('does not retain a known-stale snapshot when its replacement fails', async () => {
    const failure = new Error('Projection unavailable')
    mocks.loadUniverseTopologySnapshot
      .mockResolvedValueOnce(topology(1234))
      .mockRejectedValueOnce(failure)
    await getUniverseTopology()

    monotonicNow = universeTopologyRevisionCheckIntervalMilliseconds
    mocks.readActiveUniverseTopologyBuild.mockResolvedValueOnce(1235)
    await expect(getUniverseTopology()).rejects.toBe(failure)
    await expect(getUniverseTopology()).rejects.toBe(failure)
    expect(mocks.loadUniverseTopologySnapshot).toHaveBeenCalledTimes(2)
  })
})

function topology(buildNumber: number): UniverseTopologySnapshot {
  return {
    buildNumber,
    systems: new Map([[1, { id: 1, securityStatus: 0.9, neighbors: [] }]]),
  }
}

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
