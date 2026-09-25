import { sql } from 'drizzle-orm'
import {
  corporationRoleObservationRequiredScope,
  type CorporationRoleSourceBinding,
} from '../characters/corporation-role-evidence.js'

import { db, type DatabaseTransaction } from '../db/client.js'

type DemandDatabase = DatabaseTransaction | typeof db

export type CorporationRoleConsumer =
  | 'corporation-source'
  | 'derived-director'
  | 'organization-owner'

export interface CorporationRoleDemand extends CorporationRoleSourceBinding {
  readonly expectedRoleRevision: string | null
  readonly nextRefreshAt: Date | null
  readonly consumers: readonly CorporationRoleConsumer[]
}

interface DemandRow extends Record<string, unknown> {
  readonly organizationVersion: string
  readonly userId: string
  readonly characterId: string
  readonly subjectLifecycleId: string
  readonly affiliationPeriodRevision: string
  readonly authorityCorporationId: string
  readonly authorizationGeneration: number
  readonly expectedRoleRevision: string | null
  readonly nextRefreshAt: Date | string | null
  readonly consumers: CorporationRoleConsumer[]
}

const demandQuery = (filter: ReturnType<typeof sql>) => sql`
  with settings as (
    select
      organization_version,
      organization_id,
      organization_type,
      derived_director_authority_enabled
    from deployment_settings
    where id = 1
  ),
  consumers as (
    select evidence.character_id, 'organization-owner'::text as consumer
    from organization_authority_evidence evidence
    join organization_role_grants grants
      on grants.grant_id = evidence.grant_id and grants.revoked_at is null
    join settings on settings.organization_version = evidence.organization_version
    where evidence.deployment_id = 1 and evidence.invalidated_at is null
    union all
    select source.evidence_character_id, 'corporation-source'::text
    from organization_corporation_sources source
    join settings on settings.organization_version = source.organization_version
    where source.deployment_id = 1
      and source.revoked_at is null
      and source.invalidated_at is null
    union all
    select character.character_id, 'derived-director'::text
    from characters character
    join settings on settings.derived_director_authority_enabled
    where (
        (settings.organization_type = 'corporation'
          and character.corporation_id = settings.organization_id)
        or (settings.organization_type = 'alliance'
          and character.alliance_id = settings.organization_id)
      )
      and not exists (
        select 1
        from organization_member_blocks block
        where block.deployment_id = 1
          and block.organization_version = settings.organization_version
          and block.user_id = character.user_id
          and block.unblocked_at is null
      )
  )
  select
    settings.organization_version::text as "organizationVersion",
    character.user_id as "userId",
    character.character_id::text as "characterId",
    lifecycle.subject_lifecycle_id as "subjectLifecycleId",
    character.affiliation_period_revision as "affiliationPeriodRevision",
    character.corporation_id::text as "authorityCorporationId",
    token.token_version as "authorizationGeneration",
    observation.role_revision as "expectedRoleRevision",
    case when observation.invalidation_outcome = 'expired'
      then observation.last_checked_at + interval '5 minutes'
      else observation.next_refresh_at
    end as "nextRefreshAt",
    array_agg(distinct consumers.consumer order by consumers.consumer) as "consumers"
  from consumers
  cross join settings
  join characters character on character.character_id = consumers.character_id
  join platform_subject_lifecycles lifecycle
    on lifecycle.character_id = character.character_id
    and is_character_subject_kind(lifecycle.subject_kind)
  join eve_tokens token
    on token.character_id = character.character_id
    and token.scopes @> ${JSON.stringify([corporationRoleObservationRequiredScope])}::jsonb
  left join character_corporation_role_observations observation
    on observation.deployment_id = 1
    and observation.organization_version = settings.organization_version
    and observation.source_subject_lifecycle_id = lifecycle.subject_lifecycle_id
    and observation.affiliation_period_revision = character.affiliation_period_revision
    and observation.authority_corporation_id = character.corporation_id
    and observation.authorization_generation = token.token_version
  where character.affiliation_resolution_state = 'resolved'
    and (observation.observation_id is null or observation.status <> 'invalid'
      or observation.invalidation_outcome = 'expired')
    and ${filter}
  group by
    settings.organization_version,
    character.user_id,
    character.character_id,
    lifecycle.subject_lifecycle_id,
    character.affiliation_period_revision,
    character.corporation_id,
    token.token_version,
    observation.role_revision,
    observation.next_refresh_at,
    observation.invalidation_outcome,
    observation.last_checked_at
`

const toDemand = (row: DemandRow): CorporationRoleDemand => ({
  affiliationPeriodRevision: row.affiliationPeriodRevision,
  authorityCorporationId: Number(row.authorityCorporationId),
  authorizationGeneration: row.authorizationGeneration,
  characterId: Number(row.characterId),
  consumers: row.consumers,
  expectedRoleRevision: row.expectedRoleRevision,
  nextRefreshAt: row.nextRefreshAt === null ? null : new Date(row.nextRefreshAt),
  organizationVersion: Number(row.organizationVersion),
  subjectLifecycleId: row.subjectLifecycleId,
  userId: row.userId,
})

export const selectDueCorporationRoleDemand = async (input: {
  readonly dueBefore: Date
  readonly limit: number
  readonly database?: DemandDatabase
}) => {
  const database = input.database ?? db
  const rows = await database.execute<DemandRow>(sql`
    select * from (${demandQuery(sql`true`)}) demand
    where demand."nextRefreshAt" is null
      or demand."nextRefreshAt" <= ${input.dueBefore.toISOString()}::timestamptz
    order by demand."nextRefreshAt" asc nulls first, demand."characterId"::bigint asc
    limit ${Math.max(1, input.limit)}
  `)
  return rows.map(toDemand)
}

export const loadCorporationRoleDemand = async (
  database: DemandDatabase,
  characterId: number,
): Promise<CorporationRoleDemand | null> => {
  const [row] = await database.execute<DemandRow>(
    demandQuery(sql`character.character_id = ${characterId}`),
  )
  return row ? toDemand(row) : null
}

export const isCorporationRoleBindingDemanded = async (
  transaction: DatabaseTransaction,
  binding: CorporationRoleSourceBinding,
) => {
  const demand = await loadCorporationRoleDemand(transaction, binding.characterId)
  return (
    demand !== null &&
    demand.organizationVersion === binding.organizationVersion &&
    demand.userId === binding.userId &&
    demand.subjectLifecycleId === binding.subjectLifecycleId &&
    demand.affiliationPeriodRevision === binding.affiliationPeriodRevision &&
    demand.authorityCorporationId === binding.authorityCorporationId &&
    demand.authorizationGeneration === binding.authorizationGeneration
  )
}
