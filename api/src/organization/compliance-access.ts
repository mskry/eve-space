import { and, eq, gt, or } from 'drizzle-orm'
import { db } from '../db/client.js'
import { organizationAccountCompliance, users } from '../db/schema.js'

type Database = Pick<typeof db, 'select'>
export type OrganizationEntitlementScope = 'all' | 'review' | 'none'

export function isComplianceProjectionDue(
  projection: {
    state: 'pending' | 'compliant' | 'review_required' | 'suspended'
    reviewDeadline: Date | null
    accessValidUntil: Date | null
  },
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

export async function loadCurrentEntitlementScope(
  database: Database,
  organizationVersion: number,
  userId: string,
  now = new Date(),
): Promise<OrganizationEntitlementScope> {
  const [account] = await database
    .select({
      userId: users.id,
      state: organizationAccountCompliance.state,
      reviewDeadline: organizationAccountCompliance.reviewDeadline,
    })
    .from(users)
    .innerJoin(
      organizationAccountCompliance,
      and(
        eq(organizationAccountCompliance.deploymentId, 1),
        eq(organizationAccountCompliance.organizationVersion, organizationVersion),
        eq(organizationAccountCompliance.userId, users.id),
      ),
    )
    .where(
      and(
        eq(users.id, userId),
        or(
          eq(organizationAccountCompliance.state, 'compliant'),
          eq(organizationAccountCompliance.state, 'review_required'),
        ),
        eq(organizationAccountCompliance.authoritative, true),
        gt(organizationAccountCompliance.accessValidUntil, now),
      ),
    )
    .for('update')
  if (account?.state === 'compliant') return 'all'
  if (
    account?.state === 'review_required' &&
    account.reviewDeadline !== null &&
    account.reviewDeadline > now
  )
    return 'review'
  return 'none'
}

export async function hasCurrentComplianceAccess(
  database: Database,
  organizationVersion: number,
  userId: string,
  now = new Date(),
  allowReview = false,
) {
  const scope = await loadCurrentEntitlementScope(database, organizationVersion, userId, now)
  return scope === 'all' || (allowReview && scope === 'review')
}
