import { sql } from 'drizzle-orm'
import type { PlatformInstalledResourceDeclaration } from '@eve-space/platform-module-contract/resources'
import { installedModuleResourceDeclarations } from '../generated/platform/installed-module-resource-declarations.js'
import { createPlatformResourceClassifierInput } from '../platform/resource-classifier-input.js'

const memberAuditDirectoryResources: readonly PlatformInstalledResourceDeclaration[] =
  installedModuleResourceDeclarations.filter(
    ({ eligibility, moduleId, subjectKind }) =>
      moduleId === 'member-audit' &&
      subjectKind === 'character' &&
      eligibility.kind === 'current-managed-member-character',
  )

export const reviewerResourceClassificationCte = (now: Date) => {
  const classifierInput = JSON.stringify(
    createPlatformResourceClassifierInput(memberAuditDirectoryResources),
  )
  const expiringResources = memberAuditDirectoryResources
    .filter((resource) => resource.freshness === 'representation-expiry')
    .map(
      (resource) =>
        sql`(classified.module_id = ${resource.moduleId} and classified.resource_id = ${resource.resourceId})`,
    )
  const expires = expiringResources.length ? sql.join(expiringResources, sql` or `) : sql`false`
  return sql`
    resource_classification as (
      select classified.*, state.cached_until,
        case when (${expires})
          then platform_current_observation_state(
            classified.validated_at, state.cached_until, ${now.toISOString()}::timestamptz
          )
          else null
        end as observation_state
      from platform_classify_resources(
        ${classifierInput}::text::jsonb, ${now.toISOString()}::text::timestamptz,
        ${'member-audit'}::text, null::text, ${'character'}::text, null::uuid, null::text
      ) classified
      left join platform_collection_state state
        on state.module_id = classified.module_id
        and state.resource_id = classified.resource_id
        and state.subject_kind = classified.subject_kind
        and state.subject_lifecycle_id = classified.subject_lifecycle_id
        and state.subject_id = classified.subject_id
    )
  `
}

export const characterDirectoryAuditSummaryCte = (organizationVersion: number, now: Date) => {
  return sql`
    ${reviewerResourceClassificationCte(now)}, audit_summary as (
      select subject_lifecycle_id,
        count(*)::integer as expected,
        count(*) filter (where validated_at is not null
          and eligibility_status <> 'authorization-required'
          and observation_state is distinct from 'unavailable')::integer as covered,
        case
          when bool_or(eligibility_status = 'authorization-required') then 'authorization-required'
          when bool_or(observation_state = 'unavailable') then 'unavailable'
          when bool_or(validated_at is null and (eligibility_status = 'suppressed' or last_failure_class is not null)) then 'unavailable'
          when bool_or(validated_at is null) then 'never-collected'
          when bool_or(observation_state = 'never-collected') then 'never-collected'
          when bool_or(observation_state is null and (eligibility_status = 'suppressed' or last_failure_class is not null or due_reason is distinct from 'future')) then 'stale'
          else 'current'
        end as state,
        case when count(*) = count(validated_at)
          and not coalesce(bool_or(eligibility_status = 'authorization-required' or observation_state = 'unavailable'), false)
          then min(validated_at) else null end as as_of
      from resource_classification
      where organization_version = ${organizationVersion}
        and target_user_id is not null and managed_member_lifecycle_id is not null
        and eligibility_status <> 'disabled'
      group by subject_lifecycle_id
    )
  `
}
