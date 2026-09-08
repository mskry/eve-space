export interface SdeProjectionRevision {
  buildNumber: number
  ingestVersion: number
  ingestedAt: string
}

export function sdeProjectionRevisionsEqual(
  left: SdeProjectionRevision,
  right: SdeProjectionRevision,
) {
  return (
    left.buildNumber === right.buildNumber &&
    left.ingestVersion === right.ingestVersion &&
    left.ingestedAt === right.ingestedAt
  )
}
