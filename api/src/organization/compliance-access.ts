import { and, eq, gt, or } from 'drizzle-orm'
import { db } from '../db/client.js'
import { organizationAccountCompliance, users } from '../db/schema.js'
import {
  resolveOrganizationEntitlementScope,
  type OrganizationEntitlementScope,
} from './access-policy.js'

type Database = Pick<typeof db, 'select'>

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
      accessValidUntil: organizationAccountCompliance.accessValidUntil,
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
  return resolveOrganizationEntitlementScope(account, now)
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
