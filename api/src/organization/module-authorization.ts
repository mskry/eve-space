import type {
  PlatformAuthorizedOrganizationContext,
  PlatformOrganizationContributionAuthorization,
} from '@eve-space/platform-module-contract/server'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  deploymentSettings,
  organizationAuthorityEvidence,
  organizationRoleGrants,
} from '../db/schema.js'
import {
  resolveOrganizationEntitlementScope,
  type OrganizationSessionContext,
} from './access-policy.js'
import { getOrganizationGroupPermissions } from './group-permissions.js'

export type OrganizationContributionAuthorizationResult =
  | { readonly authorized: true; readonly context: PlatformAuthorizedOrganizationContext }
  | {
      readonly authorized: false
      readonly reason: 'blocked' | 'compliance' | 'audience' | 'permission'
    }

export async function authorizeOrganizationContribution(
  userId: string,
  organization: OrganizationSessionContext,
  declaration: PlatformOrganizationContributionAuthorization,
  now = new Date(),
): Promise<OrganizationContributionAuthorizationResult> {
  if (organization.blocked) return { authorized: false, reason: 'blocked' }
  const entitlementScope = resolveOrganizationEntitlementScope(organization, now)
  if (entitlementScope === 'none') return { authorized: false, reason: 'compliance' }
  if (
    declaration.audience !== 'member' &&
    !(await hasOrganizationAudienceAuthority(
      userId,
      organization.organizationVersion,
      declaration.audience,
      now,
    ))
  )
    return { authorized: false, reason: 'audience' }

  const permissions = await getOrganizationGroupPermissions(
    userId,
    now,
    organization.organizationVersion,
  )
  if (!hasRequiredPermissions(permissions.modules, declaration))
    return { authorized: false, reason: 'permission' }

  return {
    authorized: true,
    context: {
      organizationVersion: organization.organizationVersion,
      audience: declaration.audience,
      requiredPermission: declaration.requiredPermission,
      ...(declaration.additionalRequiredPermissions
        ? { additionalRequiredPermissions: declaration.additionalRequiredPermissions }
        : {}),
      entitlementScope,
    },
  }
}

export async function authorizeOrganizationReviewerContribution(
  userId: string,
  organization: OrganizationSessionContext,
  declaration: PlatformOrganizationContributionAuthorization,
  now = new Date(),
): Promise<OrganizationContributionAuthorizationResult> {
  if (organization.blocked) return { authorized: false, reason: 'blocked' }
  if (resolveOrganizationEntitlementScope(organization, now) !== 'all')
    return { authorized: false, reason: 'compliance' }
  if (
    declaration.audience === 'member' ||
    !(await hasOrganizationReviewerAuthority(
      userId,
      organization.organizationVersion,
      declaration.audience,
    ))
  )
    return { authorized: false, reason: 'audience' }

  const permissions = await getOrganizationGroupPermissions(
    userId,
    now,
    organization.organizationVersion,
  )
  if (!hasRequiredPermissions(permissions.modules, declaration))
    return { authorized: false, reason: 'permission' }

  return {
    authorized: true,
    context: {
      organizationVersion: organization.organizationVersion,
      audience: declaration.audience,
      requiredPermission: declaration.requiredPermission,
      ...(declaration.additionalRequiredPermissions
        ? { additionalRequiredPermissions: declaration.additionalRequiredPermissions }
        : {}),
      entitlementScope: 'all',
    },
  }
}

function hasRequiredPermissions(
  permissions: readonly string[],
  declaration: PlatformOrganizationContributionAuthorization,
) {
  return [
    declaration.requiredPermission,
    ...(declaration.additionalRequiredPermissions ?? []),
  ].every((permission) => permissions.includes(permission))
}

async function hasOrganizationAudienceAuthority(
  userId: string,
  organizationVersion: number,
  audience: 'hr' | 'director',
  now: Date,
) {
  const grants = await db
    .select({
      role: organizationRoleGrants.role,
      evidenceStatus: organizationAuthorityEvidence.status,
      reviewDeadline: organizationAuthorityEvidence.reviewDeadline,
    })
    .from(deploymentSettings)
    .innerJoin(
      organizationRoleGrants,
      and(
        eq(organizationRoleGrants.deploymentId, deploymentSettings.id),
        eq(organizationRoleGrants.organizationVersion, deploymentSettings.organizationVersion),
      ),
    )
    .leftJoin(
      organizationAuthorityEvidence,
      eq(organizationAuthorityEvidence.grantId, organizationRoleGrants.grantId),
    )
    .where(
      and(
        eq(deploymentSettings.id, 1),
        eq(deploymentSettings.organizationVersion, organizationVersion),
        eq(organizationRoleGrants.userId, userId),
        isNull(organizationRoleGrants.revokedAt),
        audience === 'hr'
          ? eq(organizationRoleGrants.role, 'hr_auditor')
          : or(
              eq(organizationRoleGrants.role, 'director'),
              eq(organizationRoleGrants.role, 'organization_owner'),
            ),
      ),
    )
  if (audience === 'hr') return grants.some(({ role }) => role === 'hr_auditor')
  return grants.some(
    (grant) =>
      grant.role === 'director' ||
      (grant.role === 'organization_owner' &&
        (grant.evidenceStatus === 'fresh' ||
          (grant.evidenceStatus === 'review_required' &&
            grant.reviewDeadline !== null &&
            grant.reviewDeadline > now))),
  )
}

async function hasOrganizationReviewerAuthority(
  userId: string,
  organizationVersion: number,
  audience: 'hr' | 'director',
) {
  const grants = await db
    .select({ role: organizationRoleGrants.role })
    .from(deploymentSettings)
    .innerJoin(
      organizationRoleGrants,
      and(
        eq(organizationRoleGrants.deploymentId, deploymentSettings.id),
        eq(organizationRoleGrants.organizationVersion, deploymentSettings.organizationVersion),
      ),
    )
    .where(
      and(
        eq(deploymentSettings.id, 1),
        eq(deploymentSettings.organizationVersion, organizationVersion),
        eq(organizationRoleGrants.userId, userId),
        audience === 'hr'
          ? inArray(organizationRoleGrants.role, ['hr_auditor', 'director'])
          : eq(organizationRoleGrants.role, 'director'),
        isNull(organizationRoleGrants.revokedAt),
      ),
    )
  return grants.some(({ role }) =>
    audience === 'hr' ? role === 'hr_auditor' || role === 'director' : role === 'director',
  )
}
