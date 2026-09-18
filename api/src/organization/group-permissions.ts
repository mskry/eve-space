import { and, asc, eq, gt, isNull, or } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  deploymentSettings,
  deploymentModules,
  organizationAccountCompliance,
  organizationGroupAssignments,
  organizationGroupPermissionBundles,
  organizationMemberBlocks,
  organizationPermissionBundleEntries,
} from '../db/schema.js'
import { expireCurrentOrganizationGroupAssignments } from './group-assignment-expiry.js'
import { currentCatalogPermission } from './permission-catalog-store.js'

export async function getOrganizationGroupPermissions(
  userId: string,
  now = new Date(),
  organizationVersion?: number,
) {
  await expireCurrentOrganizationGroupAssignments(now)
  const permissions = await db
    .select({
      type: organizationPermissionBundleEntries.permissionType,
      key: organizationPermissionBundleEntries.permissionKey,
      publisherPackage: organizationPermissionBundleEntries.publisherPackage,
      moduleId: organizationPermissionBundleEntries.moduleId,
      reviewAllowed: organizationPermissionBundleEntries.reviewAllowed,
      complianceState: organizationAccountCompliance.state,
      moduleEnabled: deploymentModules.enabled,
    })
    .from(deploymentSettings)
    .leftJoin(
      organizationMemberBlocks,
      and(
        eq(organizationMemberBlocks.deploymentId, deploymentSettings.id),
        eq(organizationMemberBlocks.organizationVersion, deploymentSettings.organizationVersion),
        eq(organizationMemberBlocks.userId, userId),
        isNull(organizationMemberBlocks.unblockedAt),
      ),
    )
    .innerJoin(
      organizationAccountCompliance,
      and(
        eq(organizationAccountCompliance.deploymentId, deploymentSettings.id),
        eq(
          organizationAccountCompliance.organizationVersion,
          deploymentSettings.organizationVersion,
        ),
        eq(organizationAccountCompliance.userId, userId),
        eq(organizationAccountCompliance.authoritative, true),
        or(
          eq(organizationAccountCompliance.state, 'compliant'),
          and(
            eq(organizationAccountCompliance.state, 'review_required'),
            gt(organizationAccountCompliance.reviewDeadline, now),
          ),
        ),
        gt(organizationAccountCompliance.accessValidUntil, now),
      ),
    )
    .innerJoin(
      organizationGroupAssignments,
      and(
        eq(deploymentSettings.id, 1),
        eq(organizationGroupAssignments.deploymentId, deploymentSettings.id),
        eq(
          organizationGroupAssignments.organizationVersion,
          deploymentSettings.organizationVersion,
        ),
      ),
    )
    .innerJoin(
      organizationGroupPermissionBundles,
      and(
        eq(organizationGroupPermissionBundles.groupId, organizationGroupAssignments.groupId),
        eq(
          organizationGroupPermissionBundles.deploymentId,
          organizationGroupAssignments.deploymentId,
        ),
        eq(
          organizationGroupPermissionBundles.organizationVersion,
          organizationGroupAssignments.organizationVersion,
        ),
      ),
    )
    .innerJoin(
      organizationPermissionBundleEntries,
      and(
        eq(
          organizationPermissionBundleEntries.bundleId,
          organizationGroupPermissionBundles.bundleId,
        ),
        eq(
          organizationPermissionBundleEntries.deploymentId,
          organizationGroupPermissionBundles.deploymentId,
        ),
        eq(
          organizationPermissionBundleEntries.organizationVersion,
          organizationGroupPermissionBundles.organizationVersion,
        ),
      ),
    )
    .leftJoin(
      deploymentModules,
      eq(deploymentModules.moduleId, organizationPermissionBundleEntries.moduleId),
    )
    .where(
      and(
        eq(organizationGroupAssignments.userId, userId),
        organizationVersion === undefined
          ? undefined
          : eq(deploymentSettings.organizationVersion, organizationVersion),
        isNull(organizationMemberBlocks.blockId),
        isNull(organizationGroupAssignments.revokedAt),
        or(
          isNull(organizationGroupAssignments.expiresAt),
          gt(organizationGroupAssignments.expiresAt, now),
        ),
        or(
          eq(organizationPermissionBundleEntries.permissionType, 'service'),
          eq(deploymentModules.enabled, true),
        ),
      ),
    )
    .orderBy(
      asc(organizationPermissionBundleEntries.permissionType),
      asc(organizationPermissionBundleEntries.permissionKey),
    )
  return {
    modules: [
      ...new Set(
        permissions
          .filter((permission) => {
            if (
              permission.type !== 'module' ||
              !permission.publisherPackage ||
              !permission.moduleId ||
              !permission.moduleEnabled
            )
              return false
            const declaration = currentCatalogPermission({
              publisherPackage: permission.publisherPackage,
              moduleId: permission.moduleId,
              key: permission.key,
            })
            return Boolean(
              declaration &&
              (permission.complianceState === 'compliant' ||
                (permission.reviewAllowed && declaration.reviewAllowed)),
            )
          })
          .map(({ key }) => key),
      ),
    ],
    services: [
      ...new Set(
        permissions
          .filter(
            ({ type, complianceState, reviewAllowed }) =>
              type === 'service' && (complianceState === 'compliant' || reviewAllowed),
          )
          .map(({ key }) => key),
      ),
    ],
  }
}
