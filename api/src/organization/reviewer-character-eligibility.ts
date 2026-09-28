import { sql } from 'drizzle-orm'

export const reviewerManagedCharacterCondition = (organizationVersion: number, now: Date) => sql`
  character.affiliation_resolution_state = 'resolved'
  and character.affiliation_checked_at is not null
  and character.next_affiliation_check > ${now.toISOString()}::text::timestamptz
  and exists (
    select 1 from organization_managed_corporations managed
    where managed.deployment_id = 1
      and managed.organization_version = ${organizationVersion}
      and managed.corporation_id = character.corporation_id
      and managed.is_current
  )
`

const reviewerExternalCharacterCondition = (organizationVersion: number, now: Date) => sql`
  exists (
    select 1 from organization_character_exceptions exception
    where exception.deployment_id = 1
      and exception.organization_version = ${organizationVersion}
      and exception.user_id = character.user_id
      and exception.character_id = character.character_id
      and exception.revoked_at is null
      and exception.expired_at is null
      and (exception.expires_at is null or exception.expires_at > ${now.toISOString()}::text::timestamptz)
  )
`

export const reviewerEligibleCharacterCondition = (organizationVersion: number, now: Date) =>
  sql`(${reviewerManagedCharacterCondition(organizationVersion, now)}) or (${reviewerExternalCharacterCondition(organizationVersion, now)})`
