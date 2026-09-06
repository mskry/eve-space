export type OrganizationComplianceState = 'pending' | 'compliant' | 'review_required' | 'suspended'
export type OrganizationEvidenceFreshness = 'fresh' | 'stale' | 'unavailable'
export type OrganizationEntitlementScope = 'all' | 'review' | 'none'

export interface OrganizationSessionContext {
  organizationVersion: number
  state: OrganizationComplianceState
  evidenceFreshness: OrganizationEvidenceFreshness
  reviewDeadline: Date | null
  accessValidUntil: Date | null
  blocked: boolean
}

export function isComplianceProjectionDue(
  projection: Pick<OrganizationSessionContext, 'state' | 'reviewDeadline' | 'accessValidUntil'>,
  now = new Date(),
) {
  if (projection.state === 'compliant')
    return !projection.accessValidUntil || projection.accessValidUntil <= now
  if (projection.state !== 'review_required') return false
  return (
    (projection.accessValidUntil !== null && projection.accessValidUntil <= now) ||
    (projection.reviewDeadline !== null && projection.reviewDeadline <= now)
  )
}

export function resolveOrganizationEntitlementScope(
  projection:
    | Pick<OrganizationSessionContext, 'state' | 'reviewDeadline' | 'accessValidUntil'>
    | null
    | undefined,
  now = new Date(),
): OrganizationEntitlementScope {
  if (!projection?.accessValidUntil || projection.accessValidUntil <= now) return 'none'
  if (projection.state === 'compliant') return 'all'
  if (
    projection.state === 'review_required' &&
    projection.reviewDeadline !== null &&
    projection.reviewDeadline > now
  )
    return 'review'
  return 'none'
}
