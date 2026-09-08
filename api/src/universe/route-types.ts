import type { SdeProjectionRevision } from './sde-revision.js'

interface UniverseShortestRoutePolicy {
  kind: 'shortest'
}

type UniverseRoutePolicy = UniverseShortestRoutePolicy

export interface UniverseRouteRequest {
  originSystemId: number
  destinationSystemIds: readonly number[]
  policy: UniverseRoutePolicy
}

export interface UniverseRouteEntry {
  destinationSystemId: number
  jumps: number | null
}

export interface UniverseRouteResult {
  originSystemId: number
  policy: UniverseRoutePolicy
  sdeBuildNumber: number
  routes: UniverseRouteEntry[]
}

export interface UniverseTopologySystem {
  id: number
  securityStatus: number | null
  neighbors: readonly number[]
}

export interface UniverseTopologySnapshot {
  revision: SdeProjectionRevision
  systems: ReadonlyMap<number, UniverseTopologySystem>
}
