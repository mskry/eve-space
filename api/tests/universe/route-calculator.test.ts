import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { UniverseTopologySnapshot } from '../../src/universe/route-types.js'

const mocks = vi.hoisted(() => ({ getUniverseTopology: vi.fn() }))

vi.mock('../../src/universe/topology.js', () => ({
  getUniverseTopology: mocks.getUniverseTopology,
}))

import { calculateUniverseRoutes } from '../../src/universe/route-calculator.js'

beforeEach(() => {
  mocks.getUniverseTopology.mockReset()
  mocks.getUniverseTopology.mockResolvedValue(
    topology([
      [1, [2]],
      [2, [1, 3, 4]],
      [3, [2]],
      [4, [2, 5]],
      [5, [4]],
      [6, []],
    ]),
  )
})

describe('universe route calculation', () => {
  test('calculates same-system, direct, multi-hop, and disconnected routes in one traversal', async () => {
    await expect(
      calculateUniverseRoutes({
        originSystemId: 1,
        destinationSystemIds: [1, 2, 3, 5, 6, 99],
        policy: { kind: 'shortest' },
      }),
    ).resolves.toEqual({
      originSystemId: 1,
      policy: { kind: 'shortest' },
      sdeBuildNumber: 1234,
      routes: [
        { destinationSystemId: 1, jumps: 0 },
        { destinationSystemId: 2, jumps: 1 },
        { destinationSystemId: 3, jumps: 2 },
        { destinationSystemId: 5, jumps: 3 },
        { destinationSystemId: 6, jumps: null },
        { destinationSystemId: 99, jumps: null },
      ],
    })
    expect(mocks.getUniverseTopology).toHaveBeenCalledTimes(1)
  })

  test('returns every destination as unavailable when the origin is absent', async () => {
    await expect(
      calculateUniverseRoutes({
        originSystemId: 99,
        destinationSystemIds: [1, 2],
        policy: { kind: 'shortest' },
      }),
    ).resolves.toMatchObject({
      routes: [
        { destinationSystemId: 1, jumps: null },
        { destinationSystemId: 2, jumps: null },
      ],
    })
  })

  test('rejects unsupported policies before loading topology', async () => {
    await expect(
      calculateUniverseRoutes({
        originSystemId: 1,
        destinationSystemIds: [2],
        policy: { kind: 'safer' },
      } as never),
    ).rejects.toThrow('Unsupported universe route policy')
    expect(mocks.getUniverseTopology).not.toHaveBeenCalled()
  })
})

function topology(
  edges: readonly (readonly [number, readonly number[]])[],
): UniverseTopologySnapshot {
  return {
    revision: {
      buildNumber: 1234,
      ingestVersion: 4,
      ingestedAt: '2026-08-26 12:00:00.000001+00',
    },
    systems: new Map(
      edges.map(([id, neighbors]) => [id, { id, securityStatus: id / 10, neighbors }]),
    ),
  }
}
