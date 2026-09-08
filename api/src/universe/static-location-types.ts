import type { SdeProjectionRevision } from './sde-revision.js'

export interface StaticSolarSystem {
  id: number
  name: string
  securityStatus: number
}

export interface StaticLocationSnapshot {
  revision: SdeProjectionRevision
  systems: ReadonlyMap<number, StaticSolarSystem>
  stationSystemIds: ReadonlyMap<number, number>
}
