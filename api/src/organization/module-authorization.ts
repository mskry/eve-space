import type { PlatformAuthorizedOrganizationContext } from '@eve-space/platform-module-contract/server'
import type { PlatformInstalledOrganizationContributionAuthorization } from '@eve-space/platform-module-contract/installed'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { organizationRoleGrants } from '../db/schema.js'
import {
  resolveOrganizationEntitlementScope,
  type OrganizationSessionContext,
} from './access-policy.js'
import { getOrganizationGroupPermissions } from './group-permissions.js'
import { loadEffectiveOrganizationAuthority } from './effective-authority.js'
import { currentCatalogPermission } from './permission-catalog-store.js'

export type OrganizationContributionAuthorizationResult =
  | { readonly authorized: true; readonly context: PlatformAuthorizedOrganizationContext }
  | {
      readonly authorized: false
      readonly reason: 'blocked' | 'compliance' | 'audience' | 'permission'
    }

export async function authorizeOrganizationContribution(
  userId: string,
  organization: OrganizationSessionContext,
  declaration: PlatformInstalledOrganizationContributionAuthorization,
  now = new Date(),
): Promise<OrganizationContributionAuthorizationResult> {
  if (organization.blocked) {
    return { authorized: false, reason: 'blocked' }
  }
  if (!currentCatalogPermission({ ...declaration, key: declaration.requiredPermission })) {
    return { authorized: false, reason: 'permission' }
  }
  const entitlementScope = resolveOrganizationEntitlementScope(organization, now)
  if (entitlementScope === 'none') {
    return { authorized: false, reason: 'compliance' }
  }
  if (
    declaration.audience !== 'member' &&
    !(await hasOrganizationAudienceAuthority(
      userId,
      organization.organizationVersion,
      declaration.audience,
      now,
    ))
  ) {
    return { authorized: false, reason: 'audience' }
  }

  const permissions = await getOrganizationGroupPermissions(
    userId,
    now,
    organization.organizationVersion,
  )
  if (!hasRequiredPermissions(permissions.modules, declaration)) {
    return { authorized: false, reason: 'permission' }
  }

  return {
    authorized: true,
    context: {
      organizationVersion: organization.organizationVersion,
      audience: declaration.audience,
      requiredPermission: declaration.requiredPermission,
      ...(declaration.additionalRequiredPermissions && {
        additionalRequiredPermissions: declaration.additionalRequiredPermissions,
      }),
      entitlementScope,
    },
  }
}

export async function authorizeOrganizationReviewerContribution(
  userId: string,
  organization: OrganizationSessionContext,
  declaration: PlatformInstalledOrganizationContributionAuthorization,
  now = new Date(),
): Promise<OrganizationContributionAuthorizationResult> {
  if (organization.blocked) {
    return { authorized: false, reason: 'blocked' }
  }
  if (!currentCatalogPermission({ ...declaration, key: declaration.requiredPermission })) {
    return { authorized: false, reason: 'permission' }
  }
  if (resolveOrganizationEntitlementScope(organization, now) !== 'all') {
    return { authorized: false, reason: 'compliance' }
  }
  if (
    declaration.audience === 'member' ||
    !(await hasOrganizationReviewerAuthority(
      userId,
      organization.organizationVersion,
      declaration.audience,
      now,
    ))
  ) {
    return { authorized: false, reason: 'audience' }
  }

  const permissions = await getOrganizationGroupPermissions(
    userId,
    now,
    organization.organizationVersion,
  )
  if (!hasRequiredPermissions(permissions.modules, declaration)) {
    return { authorized: false, reason: 'permission' }
  }

  return {
    authorized: true,
    context: {
      organizationVersion: organization.organizationVersion,
      audience: declaration.audience,
      requiredPermission: declaration.requiredPermission,
      ...(declaration.additionalRequiredPermissions && {
        additionalRequiredPermissions: declaration.additionalRequiredPermissions,
      }),
      entitlementScope: 'all',
    },
  }
}

function hasRequiredPermissions(
  permissions: readonly string[],
  declaration: PlatformInstalledOrganizationContributionAuthorization,
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
  if (audience === 'hr') {
    return hasExplicitHrAuthority(userId, organizationVersion)
  }
  const authority = await loadEffectiveOrganizationAuthority(
    db,
    organizationVersion,
    userId,
    'read-continuity',
    now,
  )
  return authority.organizationOwner || authority.director
}

async function hasOrganizationReviewerAuthority(
  userId: string,
  organizationVersion: number,
  audience: 'hr' | 'director',
  now: Date,
) {
  const authority = await loadEffectiveOrganizationAuthority(
    db,
    organizationVersion,
    userId,
    'read-continuity',
    now,
  )
  if (audience === 'director') {
    return authority.director
  }
  return authority.director || (await hasExplicitHrAuthority(userId, organizationVersion))
}

async function hasExplicitHrAuthority(userId: string, organizationVersion: number) {
  const [grant] = await db
    .select({ grantId: organizationRoleGrants.grantId })
    .from(organizationRoleGrants)
    .where(
      and(
        eq(organizationRoleGrants.deploymentId, 1),
        eq(organizationRoleGrants.organizationVersion, organizationVersion),
        eq(organizationRoleGrants.userId, userId),
        eq(organizationRoleGrants.role, 'hr_auditor'),
        isNull(organizationRoleGrants.revokedAt),
      ),
    )
    .limit(1)
  return Boolean(grant)
}
