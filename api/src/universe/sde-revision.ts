import type { SdeProjectionRevision } from '@eve-space/core-data-contract'

export type { SdeProjectionRevision } from '@eve-space/core-data-contract'

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
