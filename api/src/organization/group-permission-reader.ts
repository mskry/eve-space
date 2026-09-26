import { and, asc, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { corporationRoleObservationRequiredScope } from '../characters/corporation-role-evidence.js'
import { db, type DatabaseTransaction } from '../db/client.js'
import {
  deploymentSettings,
  deploymentModules,
  organizationAccountCompliance,
  organizationGroupAssignments,
  organizationGroupPermissionBundles,
  organizationMemberBlocks,
  organizationPermissionBundleEntries,
} from '../db/schema.js'
import { currentCatalogPermission } from './permission-catalog-store.js'
import type { EffectivePermissionIdentity } from './permission-catalog-policy.js'

type Database = DatabaseTransaction | typeof db

const currentRuleAssignment = (now: Date) => {
  const nowValue = now.toISOString()
  return sql`(
  ${organizationGroupAssignments.assignmentSource} <> 'rule'
  or exists (
    select 1 from organization_group_rules rule
    join organization_group_rule_revisions revision
      on revision.group_id = rule.group_id
      and revision.deployment_id = rule.deployment_id
      and revision.organization_version = rule.organization_version
      and revision.revision = rule.revision
    join organization_group_rule_attestations contributor
      on contributor.assignment_id = ${organizationGroupAssignments.assignmentId}
    where rule.group_id = ${organizationGroupAssignments.groupId}
      and rule.organization_version = ${organizationGroupAssignments.organizationVersion}
      and rule.deployment_id = 1
      and rule.enabled and revision.enabled
      and rule.revision = ${organizationGroupAssignments.ruleRevision}
      and ${organizationGroupPermissionBundles.bundleId} = any(revision.bundle_ids)
      and contributor.valid_until > ${nowValue}
      and (
        (
          rule.condition_kind = 'registration-compliant'
          and contributor.source_kind = 'registration'
          and contributor.source_id = ${organizationGroupAssignments.userId}
          and ${organizationAccountCompliance.state} = 'compliant'
          and ${organizationAccountCompliance.evidenceFreshness} = 'fresh'
        )
        or (
          rule.condition_kind = 'director-audience'
          and contributor.source_kind = 'explicit-director'
          and exists (
            select 1 from organization_role_grants grant_record
            where grant_record.grant_id = contributor.source_id
              and grant_record.deployment_id = 1
              and grant_record.organization_version = rule.organization_version
              and grant_record.user_id = ${organizationGroupAssignments.userId}
              and grant_record.role = 'director'
              and grant_record.revoked_at is null
          )
        )
        or (
          (
            (rule.condition_kind = 'corporation-role'
              and contributor.source_kind = 'corporation-role'
              and contributor.source_id = contributor.subject_lifecycle_id)
            or (rule.condition_kind = 'director-audience'
              and contributor.source_kind = 'derived-director'
              and ${organizationAccountCompliance.state} = 'compliant'
              and ${deploymentSettings.derivedDirectorAuthorityEnabled} = true
              and exists (
                select 1 from organization_derived_authority_sources derived
                where derived.source_id = contributor.source_id
                  and derived.organization_version = rule.organization_version
                  and derived.user_id = ${organizationGroupAssignments.userId}
                  and derived.role_evidence_revision = contributor.role_revision::text
                  and derived.authorization_generation = contributor.authorization_generation
                  and derived.source_subject_lifecycle_id = contributor.subject_lifecycle_id
                  and derived.status = 'fresh' and derived.invalidated_at is null
                  and derived.fresh_until > ${nowValue}
              ))
          )
          and ${organizationAccountCompliance.evidenceFreshness} = 'fresh'
          and exists (
            select 1 from character_corporation_role_observations observation
            join characters character on character.character_id = observation.character_id
            join platform_subject_lifecycles lifecycle
              on lifecycle.character_id = character.character_id
            join eve_tokens token on token.character_id = character.character_id
            where observation.deployment_id = 1
              and observation.organization_version = rule.organization_version
              and observation.user_id = ${organizationGroupAssignments.userId}
              and observation.source_subject_lifecycle_id = contributor.subject_lifecycle_id
              and observation.affiliation_period_revision = contributor.affiliation_period_revision
              and observation.authorization_generation = contributor.authorization_generation
              and observation.authority_corporation_id = contributor.authority_corporation_id
              and observation.role_revision = contributor.role_revision
              and observation.status = 'fresh' and observation.fresh_until > ${nowValue}
              and observation.required_scope = ${corporationRoleObservationRequiredScope}
              and character.user_id = observation.user_id
              and character.corporation_id = observation.authority_corporation_id
              and character.affiliation_period_revision = contributor.affiliation_period_revision
              and character.affiliation_resolution_state = 'resolved'
              and character.next_affiliation_check > ${nowValue}
              and lifecycle.subject_lifecycle_id = contributor.subject_lifecycle_id
              and token.token_version = contributor.authorization_generation
              and token.scopes @> ${JSON.stringify([corporationRoleObservationRequiredScope])}::jsonb
              and (
                ${deploymentSettings.organizationType} = 'corporation'
                and character.corporation_id = ${deploymentSettings.organizationId}
                or ${deploymentSettings.organizationType} = 'alliance'
                and character.alliance_id = ${deploymentSettings.organizationId}
                and exists (
                  select 1 from organization_alliance_executor_observations executor
                  where executor.deployment_id = 1
                    and executor.organization_version = rule.organization_version
                    and executor.status = 'fresh'
                    and executor.executor_corporation_id = observation.authority_corporation_id
                    and executor.executor_revision = contributor.executor_revision
                    and executor.fresh_until > ${nowValue}
                    and contributor.executor_fresh_until > ${nowValue}
                )
              )
          )
        )
      )
  )
)`
}

export async function getOrganizationGroupPermissionsFromDatabase(
  database: Database,
  userId: string,
  now = new Date(),
  organizationVersion?: number,
) {
  const permissions = await database
    .select({
      complianceState: organizationAccountCompliance.state,
      key: organizationPermissionBundleEntries.permissionKey,
      moduleEnabled: deploymentModules.enabled,
      moduleId: organizationPermissionBundleEntries.moduleId,
      publisherPackage: organizationPermissionBundleEntries.publisherPackage,
      reviewAllowed: organizationPermissionBundleEntries.reviewAllowed,
      type: organizationPermissionBundleEntries.permissionType,
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
        currentRuleAssignment(now),
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
  const effective = permissions.filter((permission) => {
    if (permission.type === 'service') {
      return permission.complianceState === 'compliant' || permission.reviewAllowed
    }
    if (!permission.moduleEnabled || !permission.moduleId || !permission.publisherPackage) {
      return false
    }
    const declaration = currentCatalogPermission({
      key: permission.key,
      moduleId: permission.moduleId,
      publisherPackage: permission.publisherPackage,
    })
    return Boolean(
      declaration &&
      (permission.complianceState === 'compliant' ||
        (permission.reviewAllowed && declaration.reviewAllowed)),
    )
  })
  const identities = new Map<string, EffectivePermissionIdentity>()
  for (const permission of effective) {
    const identity: EffectivePermissionIdentity = {
      type: permission.type,
      key: permission.key,
      publisherPackage: permission.type === 'module' ? permission.publisherPackage : null,
      moduleId: permission.type === 'module' ? permission.moduleId : null,
    }
    identities.set(
      [identity.type, identity.publisherPackage, identity.moduleId, identity.key].join('\0'),
      identity,
    )
  }
  return {
    identities: [...identities.values()],
    modules: [
      ...new Set(
        effective.filter((permission) => permission.type === 'module').map(({ key }) => key),
      ),
    ],
    services: [
      ...new Set(
        effective.filter((permission) => permission.type === 'service').map(({ key }) => key),
      ),
    ],
  }
}
