import { and, eq, isNull, or } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '../db/client.js'
import {
  deploymentSettings,
  organizationAuthorityEvidence,
  organizationMemberBlocks,
  organizationRoleGrants,
} from '../db/schema.js'
import { hasCurrentComplianceAccess } from './compliance-access.js'

type Database = DatabaseTransaction | typeof db

export type OrganizationManagementAuthority = 'director' | 'organization_owner'

export async function hasCurrentOrganizationManagerAuthority(userId: string) {
  const [organization] = await db
    .select({ organizationVersion: deploymentSettings.organizationVersion })
    .from(deploymentSettings)
    .where(eq(deploymentSettings.id, 1))
  if (!organization) return false
  return Boolean(await loadManagementAuthority(db, organization.organizationVersion, userId))
}

export async function loadManagementAuthority(
  database: Database,
  organizationVersion: number,
  userId: string,
  now = new Date(),
): Promise<OrganizationManagementAuthority | null> {
  if (!(await hasCurrentComplianceAccess(database, organizationVersion, userId, now))) return null
  const [block] = await database
    .select({ blockId: organizationMemberBlocks.blockId })
    .from(organizationMemberBlocks)
    .where(
      and(
        eq(organizationMemberBlocks.deploymentId, 1),
        eq(organizationMemberBlocks.organizationVersion, organizationVersion),
        eq(organizationMemberBlocks.userId, userId),
        isNull(organizationMemberBlocks.unblockedAt),
      ),
    )
    .limit(1)
  if (block) return null

  const grants = await database
    .select({
      role: organizationRoleGrants.role,
      evidenceStatus: organizationAuthorityEvidence.status,
      reviewDeadline: organizationAuthorityEvidence.reviewDeadline,
    })
    .from(organizationRoleGrants)
    .leftJoin(
      organizationAuthorityEvidence,
      eq(organizationAuthorityEvidence.grantId, organizationRoleGrants.grantId),
    )
    .where(
      and(
        eq(organizationRoleGrants.deploymentId, 1),
        eq(organizationRoleGrants.organizationVersion, organizationVersion),
        eq(organizationRoleGrants.userId, userId),
        or(
          eq(organizationRoleGrants.role, 'organization_owner'),
          eq(organizationRoleGrants.role, 'director'),
        ),
        isNull(organizationRoleGrants.revokedAt),
      ),
    )
  if (
    grants.some(
      (grant) =>
        grant.role === 'organization_owner' &&
        (grant.evidenceStatus === 'fresh' ||
          (grant.evidenceStatus === 'review_required' &&
            grant.reviewDeadline !== null &&
            grant.reviewDeadline > now)),
    )
  )
    return 'organization_owner'
  if (grants.some(({ role }) => role === 'director')) return 'director'
  return null
}
