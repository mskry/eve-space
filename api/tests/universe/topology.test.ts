import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { UniverseTopologySnapshot } from '../../src/universe/route-types.js'

const mocks = vi.hoisted(() => ({
  loadUniverseTopologySnapshot: vi.fn(),
  readActiveUniverseTopologyBuild: vi.fn(),
}))

vi.mock('../../src/universe/topology-store.js', () => ({
  loadUniverseTopologySnapshot: mocks.loadUniverseTopologySnapshot,
  readActiveUniverseTopologyBuild: mocks.readActiveUniverseTopologyBuild,
}))

import { getUniverseTopology, resetUniverseTopologyForTests } from '../../src/universe/topology.js'

beforeEach(() => {
  vi.clearAllMocks()
  resetUniverseTopologyForTests()
})

describe('universe topology cache', () => {
  test('collapses concurrent cold loads and reuses a matching build', async () => {
    const loading = deferred<UniverseTopologySnapshot>()
    mocks.readActiveUniverseTopologyBuild.mockResolvedValue(1234)
    mocks.loadUniverseTopologySnapshot.mockReturnValue(loading.promise)

    const first = getUniverseTopology()
    const second = getUniverseTopology()
    await vi.waitFor(() => expect(mocks.loadUniverseTopologySnapshot).toHaveBeenCalledTimes(1))
    loading.resolve(topology(1234))

    await expect(Promise.all([first, second])).resolves.toEqual([topology(1234), topology(1234)])
    await expect(getUniverseTopology()).resolves.toEqual(topology(1234))
    expect(mocks.loadUniverseTopologySnapshot).toHaveBeenCalledTimes(1)
  })

  test('reloads topology after the active completed build changes', async () => {
    mocks.readActiveUniverseTopologyBuild.mockResolvedValueOnce(1234).mockResolvedValueOnce(1235)
    mocks.loadUniverseTopologySnapshot
      .mockResolvedValueOnce(topology(1234))
      .mockResolvedValueOnce(topology(1235))

    await expect(getUniverseTopology()).resolves.toEqual(topology(1234))
    await expect(getUniverseTopology()).resolves.toEqual(topology(1235))
    expect(mocks.loadUniverseTopologySnapshot).toHaveBeenCalledTimes(2)
  })

  test('does not publish a load superseded by reset', async () => {
    const oldLoad = deferred<UniverseTopologySnapshot>()
    mocks.readActiveUniverseTopologyBuild.mockResolvedValueOnce(1234).mockResolvedValueOnce(1235)
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
