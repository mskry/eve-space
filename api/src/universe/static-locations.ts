import { performance } from 'node:perf_hooks'
import {
  staticLocationCacheState,
  type StaticLocationCacheState,
} from './static-location-cache-state.js'
import {
  loadStaticLocationSnapshot,
  readStaticLocationRevision,
  StaticLocationProjectionUnavailableError,
} from './static-location-store.js'
import type { StaticLocationSnapshot } from './static-location-types.js'
import { staticLocationRevisionsEqual } from './static-location-types.js'

export const staticLocationRevisionCheckIntervalMilliseconds = 60_000

export interface StaticLocationRequest {
  id: number
  type: 'station' | 'solar_system'
}

export async function getStaticLocations(locations: readonly StaticLocationRequest[]) {
  if (locations.length === 0) return []
  const snapshot = await getStaticLocationSnapshot(staticLocationCacheState)
  return locations.map((location) => locationResult(snapshot, location))
}

export function resetStaticLocationCacheForTests() {
  staticLocationCacheState.reset()
}

async function getStaticLocationSnapshot(state: StaticLocationCacheState) {
  while (true) {
    const current = state.read()
    const now = performance.now()
    if (now < current.nextCheckAt) {
      if (current.snapshot) return current.snapshot
      throw current.failure ?? new StaticLocationProjectionUnavailableError()
    }
    if (current.inFlight) return current.inFlight

    const inFlight = state.begin(current.generation, () =>
      refreshStaticLocationSnapshot(state, current.snapshot, current.generation),
    )
    if (inFlight) return inFlight
  }
}

async function refreshStaticLocationSnapshot(
  state: StaticLocationCacheState,
  current: StaticLocationSnapshot | undefined,
  generation: number,
) {
  try {
    if (current) {
      const revision = await readStaticLocationRevision()
      if (staticLocationRevisionsEqual(current.revision, revision)) {
        if (
          !state.publish(
            current,
            generation,
            performance.now() + staticLocationRevisionCheckIntervalMilliseconds,
          )
        )
          throw new StaticLocationCacheSupersededError()
        return current
      }
    }

    const candidate = await loadStaticLocationSnapshot()
    if (
      !state.publish(
        candidate,
        generation,
        performance.now() + staticLocationRevisionCheckIntervalMilliseconds,
      )
    )
      throw new StaticLocationCacheSupersededError()
    return candidate
  } catch (error) {
    if (error instanceof StaticLocationCacheSupersededError) throw error
    if (
      !state.retain(
        generation,
        error,
        performance.now() + staticLocationRevisionCheckIntervalMilliseconds,
      )
    )
      throw new StaticLocationCacheSupersededError()
    if (current) return current
    throw error
  }
}

function locationResult(snapshot: StaticLocationSnapshot, location: StaticLocationRequest) {
  const systemId =
    location.type === 'solar_system' ? location.id : snapshot.stationSystemIds.get(location.id)
  const system = systemId === undefined ? undefined : snapshot.systems.get(systemId)
  return {
    id: location.id,
    type: location.type,
    name: location.type === 'solar_system' ? (system?.name ?? null) : null,
    solarSystemId: system?.id ?? null,
    solarSystemSecurityStatus: system?.securityStatus ?? null,
  }
}

class StaticLocationCacheSupersededError extends Error {
  constructor() {
    super('Static location cache load was superseded')
    this.name = 'StaticLocationCacheSupersededError'
  }
}
