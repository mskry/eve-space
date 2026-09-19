import { sql } from 'drizzle-orm'
import {
  organizationGroupPermissionBundles,
  organizationGroups,
  organizationPermissionBundleEntries,
} from '../db/schema.js'

export function organizationReviewerPermissionExists(
  organizationVersion: number,
  groupId: string | typeof organizationGroups.groupId,
) {
  const groupIdReference =
    typeof groupId === 'string' ? sql`${groupId}` : sql.raw('"organization_groups"."group_id"')
  return sql<boolean>`exists (
    select 1
    from ${organizationGroupPermissionBundles} reviewer_group_bundles
    inner join ${organizationPermissionBundleEntries} reviewer_permissions
      on reviewer_permissions.bundle_id = reviewer_group_bundles.bundle_id
      and reviewer_permissions.deployment_id = reviewer_group_bundles.deployment_id
      and reviewer_permissions.organization_version = reviewer_group_bundles.organization_version
    where reviewer_group_bundles.group_id = ${groupIdReference}
      and reviewer_group_bundles.deployment_id = 1
      and reviewer_group_bundles.organization_version = ${organizationVersion}
      and reviewer_permissions.permission_type = 'module'
      and reviewer_permissions.permission_key like 'member-audit.%'
  )`
}
