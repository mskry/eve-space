import { performance } from 'node:perf_hooks'
import type { UniverseTopologySnapshot } from './route-types.js'
import { sdeProjectionRevisionsEqual } from './sde-revision.js'
import {
  loadUniverseTopologySnapshot,
  readActiveUniverseTopologyRevision,
  UniverseTopologyUnavailableError,
} from './topology-store.js'
import { universeTopologyState, type UniverseTopologyState } from './topology-state.js'

export const universeTopologyRevisionCheckIntervalMilliseconds = 60_000

export async function getUniverseTopology(): Promise<UniverseTopologySnapshot> {
  while (true) {
    const current = universeTopologyState.read()
    if (performance.now() < current.nextCheckAt) {
      if (current.snapshot) return current.snapshot
      throw current.failure ?? new UniverseTopologyUnavailableError()
    }
    if (current.inFlight) return current.inFlight

    const inFlight = universeTopologyState.begin(current.generation, () =>
      refreshUniverseTopology(universeTopologyState, current.snapshot, current.generation),
    )
    if (inFlight) return inFlight
  }
}

export function resetUniverseTopologyForTests() {
  universeTopologyState.reset()
}

async function refreshUniverseTopology(
  state: UniverseTopologyState,
  current: UniverseTopologySnapshot | undefined,
  generation: number,
) {
  const nextCheckAt = () => performance.now() + universeTopologyRevisionCheckIntervalMilliseconds
  if (current) {
    const reusable = await reuseCurrentTopology(state, current, generation, nextCheckAt)
    if (reusable) return reusable
  }

  try {
    const snapshot = await loadUniverseTopologySnapshot()
    assertTopologyStateTransition(state.publish(snapshot, generation, nextCheckAt()))
    return snapshot
  } catch (error) {
    if (error instanceof UniverseTopologyLoadSupersededError) throw error
    assertTopologyStateTransition(state.fail(generation, error, nextCheckAt()))
    throw error
  }
}

async function reuseCurrentTopology(
  state: UniverseTopologyState,
  current: UniverseTopologySnapshot,
  generation: number,
  nextCheckAt: () => number,
): Promise<UniverseTopologySnapshot | undefined> {
  let activeRevision: UniverseTopologySnapshot['revision']
  try {
    activeRevision = await readActiveUniverseTopologyRevision()
  } catch (error) {
    assertTopologyStateTransition(state.retain(generation, error, nextCheckAt()))
    return current
  }
  if (!sdeProjectionRevisionsEqual(current.revision, activeRevision)) return undefined
  assertTopologyStateTransition(state.publish(current, generation, nextCheckAt()))
  return current
}

function assertTopologyStateTransition(accepted: boolean) {
  if (!accepted) throw new UniverseTopologyLoadSupersededError()
}

class UniverseTopologyLoadSupersededError extends Error {
  constructor() {
    super('Universe topology load was superseded')
    this.name = 'UniverseTopologyLoadSupersededError'
  }
}
