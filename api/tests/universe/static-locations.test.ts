import { performance } from 'node:perf_hooks'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type {
  StaticLocationRevision,
  StaticLocationSnapshot,
} from '../../src/universe/static-location-types.js'

const mocks = vi.hoisted(() => ({
  loadStaticLocationSnapshot: vi.fn(),
  readStaticLocationRevision: vi.fn(),
}))

vi.mock('../../src/universe/static-location-store.js', () => ({
  loadStaticLocationSnapshot: mocks.loadStaticLocationSnapshot,
  readStaticLocationRevision: mocks.readStaticLocationRevision,
  StaticLocationProjectionUnavailableError: class extends Error {},
}))

import {
  getStaticLocations,
  resetStaticLocationCacheForTests,
  staticLocationRevisionCheckIntervalMilliseconds,
} from '../../src/universe/static-locations.js'

let monotonicNow = 0

beforeEach(() => {
  vi.clearAllMocks()
  resetStaticLocationCacheForTests()
  monotonicNow = 0
  vi.spyOn(performance, 'now').mockImplementation(() => monotonicNow)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('static location cache', () => {
  test('serves repeated warm lookups for 600 locations without database work or truncation', async () => {
    const systems = Array.from({ length: 300 }, (_, index) => ({
      id: 30_000_001 + index,
      name: `System ${index + 1}`,
      securityStatus: index === 0 ? -0.06 : index === 1 ? 0 : 0.945913,
    }))
    const snapshot = staticSnapshot(
      revision(2, '2026-08-26 12:00:00.000001+00'),
      systems,
      systems.map((solarSystem, index) => [60_000_001 + index, solarSystem.id]),
    )
    const locations = [
      ...systems.map((solarSystem) => ({ id: solarSystem.id, type: 'solar_system' as const })),
      ...systems.map((_, index) => ({ id: 60_000_001 + index, type: 'station' as const })),
    ]
    mocks.loadStaticLocationSnapshot.mockResolvedValue(snapshot)

    const first = await getStaticLocations(locations)
    const second = await getStaticLocations(locations)

    expect(first).toHaveLength(600)
    expect(second).toHaveLength(600)
    expect(first.every((location) => location.solarSystemSecurityStatus !== null)).toBe(true)
    expect(mocks.loadStaticLocationSnapshot).toHaveBeenCalledTimes(1)
    expect(mocks.readStaticLocationRevision).not.toHaveBeenCalled()
  })

  test('collapses concurrent cold initialization', async () => {
    const loading = deferred<StaticLocationSnapshot>()
    const snapshot = staticSnapshot(
      revision(),
      [system(30_000_001, -0.06)],
      [[60_000_001, 30_000_001]],
    )
    mocks.loadStaticLocationSnapshot.mockReturnValue(loading.promise)

    const first = getStaticLocations([{ id: 60_000_001, type: 'station' }])
    const second = getStaticLocations([{ id: 30_000_001, type: 'solar_system' }])
    await vi.waitFor(() => expect(mocks.loadStaticLocationSnapshot).toHaveBeenCalledTimes(1))
    loading.resolve(snapshot)

    await expect(first).resolves.toEqual([
      {
        id: 60_000_001,
        type: 'station',
        name: null,
        solarSystemId: 30_000_001,
        solarSystemSecurityStatus: -0.06,
      },
    ])
    await expect(second).resolves.toEqual([
      {
        id: 30_000_001,
        type: 'solar_system',
        name: 'System 30000001',
        solarSystemId: 30_000_001,
        solarSystemSecurityStatus: -0.06,
      },
    ])
  })

  test('collapses a due check and reuses an unchanged revision', async () => {
    const currentRevision = revision()
    const snapshot = staticSnapshot(currentRevision, [system(30_000_001, 0)], [])
    mocks.loadStaticLocationSnapshot.mockResolvedValue(snapshot)
    await getStaticLocations([{ id: 30_000_001, type: 'solar_system' }])

    monotonicNow = staticLocationRevisionCheckIntervalMilliseconds
    const checking = deferred<StaticLocationRevision>()
    mocks.readStaticLocationRevision.mockReturnValue(checking.promise)
    const first = getStaticLocations([{ id: 30_000_001, type: 'solar_system' }])
    const second = getStaticLocations([{ id: 30_000_001, type: 'solar_system' }])
    await vi.waitFor(() => expect(mocks.readStaticLocationRevision).toHaveBeenCalledTimes(1))
    checking.resolve(currentRevision)

    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(mocks.loadStaticLocationSnapshot).toHaveBeenCalledTimes(1)
  })

  test('replaces a same-build revision atomically and removes absent locations', async () => {
    const oldSnapshot = staticSnapshot(
      revision(2, '2026-08-26 12:00:00.000001+00'),
      [system(30_000_001, -0.06)],
      [[60_000_001, 30_000_001]],
    )
    const newRevision = revision(3, '2026-08-26 12:01:00.000001+00')
    const newSnapshot = staticSnapshot(
      newRevision,
      [system(30_000_002, 0.945913)],
      [[60_000_002, 30_000_002]],
    )
    mocks.loadStaticLocationSnapshot.mockResolvedValueOnce(oldSnapshot)
    await getStaticLocations([{ id: 60_000_001, type: 'station' }])

    monotonicNow = staticLocationRevisionCheckIntervalMilliseconds
    mocks.readStaticLocationRevision.mockResolvedValue(newRevision)
    mocks.loadStaticLocationSnapshot.mockResolvedValueOnce(newSnapshot)

    await expect(
      getStaticLocations([
        { id: 60_000_001, type: 'station' },
        { id: 30_000_002, type: 'solar_system' },
      ]),
    ).resolves.toEqual([
      {
        id: 60_000_001,
        type: 'station',
        name: null,
        solarSystemId: null,
        solarSystemSecurityStatus: null,
      },
      {
        id: 30_000_002,
        type: 'solar_system',
        name: 'System 30000002',
        solarSystemId: 30_000_002,
        solarSystemSecurityStatus: 0.945913,
      },
    ])
  })

  test('rejects a load superseded by a cache reset', async () => {
    const oldLoad = deferred<StaticLocationSnapshot>()
    const oldSnapshot = staticSnapshot(revision(), [system(30_000_001, -0.06)], [])
    const newSnapshot = staticSnapshot(
      revision(3, '2026-08-26 12:01:00.000001+00'),
      [system(30_000_002, 0.945913)],
      [],
    )
    mocks.loadStaticLocationSnapshot
      .mockReturnValueOnce(oldLoad.promise)
      .mockResolvedValueOnce(newSnapshot)

    const superseded = getStaticLocations([{ id: 30_000_001, type: 'solar_system' }])
    await vi.waitFor(() => expect(mocks.loadStaticLocationSnapshot).toHaveBeenCalledTimes(1))
    resetStaticLocationCacheForTests()
    await expect(
      getStaticLocations([{ id: 30_000_002, type: 'solar_system' }]),
    ).resolves.toMatchObject([{ solarSystemSecurityStatus: 0.945913 }])

    oldLoad.resolve(oldSnapshot)
    await expect(superseded).rejects.toThrow('superseded')
  })

  test('retains a warm snapshot through failure, throttles retries, and recovers', async () => {
    const oldSnapshot = staticSnapshot(revision(), [system(30_000_001, -0.06)], [])
    const newRevision = revision(3, '2026-08-26 12:01:00.000001+00')
    const newSnapshot = staticSnapshot(newRevision, [system(30_000_001, 0.945913)], [])
    mocks.loadStaticLocationSnapshot.mockResolvedValueOnce(oldSnapshot)
    await getStaticLocations([{ id: 30_000_001, type: 'solar_system' }])

    monotonicNow = staticLocationRevisionCheckIntervalMilliseconds
    mocks.readStaticLocationRevision.mockRejectedValueOnce(new Error('Database unavailable'))
    await expect(
      getStaticLocations([{ id: 30_000_001, type: 'solar_system' }]),
    ).resolves.toMatchObject([{ solarSystemSecurityStatus: -0.06 }])
    await getStaticLocations([{ id: 30_000_001, type: 'solar_system' }])
    expect(mocks.readStaticLocationRevision).toHaveBeenCalledTimes(1)

    monotonicNow += staticLocationRevisionCheckIntervalMilliseconds
    mocks.readStaticLocationRevision.mockResolvedValueOnce(newRevision)
    mocks.loadStaticLocationSnapshot.mockResolvedValueOnce(newSnapshot)
    await expect(
      getStaticLocations([{ id: 30_000_001, type: 'solar_system' }]),
    ).resolves.toMatchObject([{ solarSystemSecurityStatus: 0.945913 }])
  })

  test('throttles cold failures and initializes after the retry interval', async () => {
    const failure = new Error('Database unavailable')
    mocks.loadStaticLocationSnapshot.mockRejectedValueOnce(failure)

    await expect(getStaticLocations([{ id: 30_000_001, type: 'solar_system' }])).rejects.toBe(
      failure,
    )
    await expect(getStaticLocations([{ id: 30_000_001, type: 'solar_system' }])).rejects.toBe(
      failure,
    )
    expect(mocks.loadStaticLocationSnapshot).toHaveBeenCalledTimes(1)

    monotonicNow = staticLocationRevisionCheckIntervalMilliseconds
    mocks.loadStaticLocationSnapshot.mockResolvedValueOnce(
      staticSnapshot(revision(), [system(30_000_001, 0)], []),
    )
    await expect(
      getStaticLocations([{ id: 30_000_001, type: 'solar_system' }]),
    ).resolves.toMatchObject([{ solarSystemSecurityStatus: 0 }])
    expect(mocks.loadStaticLocationSnapshot).toHaveBeenCalledTimes(2)
  })

  test('keeps missing categories unresolved and isolates returned object mutation', async () => {
    mocks.loadStaticLocationSnapshot.mockResolvedValue(
      staticSnapshot(revision(), [system(30_000_001, 0.945913)], [[60_000_001, 30_000_001]]),
    )
    const locations = [
      { id: 30_000_001, type: 'station' as const },
      { id: 60_000_001, type: 'solar_system' as const },
      { id: 30_000_001, type: 'solar_system' as const },
    ]
    const first = await getStaticLocations(locations)
    first[2]!.name = 'Mutated'
    first[2]!.solarSystemSecurityStatus = -1

    expect(await getStaticLocations(locations)).toEqual([
      {
        id: 30_000_001,
        type: 'station',
        name: null,
        solarSystemId: null,
        solarSystemSecurityStatus: null,
      },
      {
        id: 60_000_001,
        type: 'solar_system',
        name: null,
        solarSystemId: null,
        solarSystemSecurityStatus: null,
      },
      {
        id: 30_000_001,
        type: 'solar_system',
        name: 'System 30000001',
        solarSystemId: 30_000_001,
        solarSystemSecurityStatus: 0.945913,
      },
    ])
  })
})

function revision(
  ingestVersion = 2,
  ingestedAt = '2026-08-26 12:00:00.000001+00',
): StaticLocationRevision {
  return { buildNumber: 1234, ingestVersion, ingestedAt }
}

function system(id: number, securityStatus: number) {
  return { id, name: `System ${id}`, securityStatus }
}

function staticSnapshot(
  snapshotRevision: StaticLocationRevision,
  systems: readonly ReturnType<typeof system>[],
  stations: readonly (readonly [number, number])[],
): StaticLocationSnapshot {
  return {
    revision: snapshotRevision,
    systems: new Map(systems.map((value) => [value.id, value])),
    stationSystemIds: new Map(stations),
  }
}

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
