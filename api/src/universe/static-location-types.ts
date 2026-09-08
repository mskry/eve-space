export interface StaticLocationRevision {
  buildNumber: number
  ingestVersion: number
  ingestedAt: string
}

export interface StaticSolarSystem {
  id: number
  name: string
  securityStatus: number
}

export interface StaticLocationSnapshot {
  revision: StaticLocationRevision
  systems: ReadonlyMap<number, StaticSolarSystem>
  stationSystemIds: ReadonlyMap<number, number>
}

export function staticLocationRevisionsEqual(
  left: StaticLocationRevision,
  right: StaticLocationRevision,
) {
  return (
    left.buildNumber === right.buildNumber &&
    left.ingestVersion === right.ingestVersion &&
    left.ingestedAt === right.ingestedAt
  )
}
