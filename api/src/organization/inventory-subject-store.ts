import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { hasCurrentReviewerOrganizationSnapshot } from './reviewer-organization-snapshot.js'
import { reviewerManagedCharacterCondition } from './reviewer-character-eligibility.js'

export type CorporationInventoryCandidate = {
  readonly characterId: number
  readonly characterName: string
  readonly userId: string
  readonly characterLifecycle: string
  readonly memberLifecycle: string
  readonly corporationId: number
  readonly affiliationPeriodRevision: string
}

export const resolveCorporationInventorySubjects = async (input: {
  readonly organizationVersion: number
  readonly corporationId: number
  readonly selection: readonly number[] | undefined
  readonly maximum: number
  readonly now?: Date
}) =>
  db.transaction(
    async (transaction) => {
      const now = input.now ?? new Date()
      if (
        !(await hasCurrentReviewerOrganizationSnapshot(transaction, input.organizationVersion, now))
      )
        return null
      const corporations = await transaction.execute(sql`
    select managed.corporation_id from organization_managed_corporations managed
    where managed.deployment_id = 1 and managed.organization_version = ${input.organizationVersion}
      and managed.corporation_id = ${input.corporationId} and managed.is_current
  `)
      if (corporations.length !== 1) return null
      const selected =
        input.selection === undefined
          ? sql``
          : sql`and character.character_id in (select value::bigint from jsonb_array_elements_text(${JSON.stringify(input.selection)}::jsonb))`
      const rows = await transaction.execute<CorporationInventoryCandidate>(sql`
    select character.character_id::float8 as "characterId", character.name as "characterName",
      character.user_id as "userId", lifecycle.subject_lifecycle_id as "characterLifecycle",
      member.managed_member_lifecycle_id as "memberLifecycle",
      character.corporation_id::float8 as "corporationId",
      character.affiliation_period_revision as "affiliationPeriodRevision"
    from characters character
    join platform_subject_lifecycles lifecycle on lifecycle.character_id = character.character_id
      and lifecycle.subject_kind = 'character'
    join organization_managed_member_lifecycles member on member.user_id = character.user_id
      and member.deployment_id = 1 and member.organization_version = ${input.organizationVersion}
      and member.ended_at is null
    where character.corporation_id = ${input.corporationId}
      and (${reviewerManagedCharacterCondition(input.organizationVersion, now)}) ${selected}
    order by character.character_id limit ${input.maximum + 1}
  `)
      return [...rows]
    },
    { isolationLevel: 'repeatable read' },
  )

export const loadInventoryOrganizationPolicy = async (organizationVersion: number) => {
  const [row] = await db.execute<{ policyVersion: number }>(sql`
    select registration_policy_version::float8 as "policyVersion" from deployment_settings
    where id = 1 and organization_version = ${organizationVersion}
  `)
  return row?.policyVersion ?? null
}
