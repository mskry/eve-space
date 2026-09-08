import type { UniverseTopologySnapshot } from './route-types.js'
import { loadUniverseTopologySnapshot, readActiveUniverseTopologyBuild } from './topology-store.js'
import { universeTopologyState, type UniverseTopologyState } from './topology-state.js'

export async function getUniverseTopology(): Promise<UniverseTopologySnapshot> {
  const activeBuildNumber = await readActiveUniverseTopologyBuild()
  const current = universeTopologyState.read()
  if (current.snapshot?.buildNumber === activeBuildNumber) return current.snapshot
  if (current.inFlight) {
    await current.inFlight
    return getUniverseTopology()
  }

  const inFlight = universeTopologyState.begin(current.generation, () =>
    refreshUniverseTopology(universeTopologyState, current.generation),
  )
  return inFlight ?? getUniverseTopology()
}

export function resetUniverseTopologyForTests() {
  universeTopologyState.reset()
}

async function refreshUniverseTopology(state: UniverseTopologyState, generation: number) {
  const snapshot = await loadUniverseTopologySnapshot()
  if (!state.publish(snapshot, generation)) throw new UniverseTopologyLoadSupersededError()
  return snapshot
}

class UniverseTopologyLoadSupersededError extends Error {
  constructor() {
    super('Universe topology load was superseded')
    this.name = 'UniverseTopologyLoadSupersededError'
  }
}
