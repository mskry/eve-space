import type { PlatformResourceSubject } from '@eve-space/platform-module-contract'
import { sql } from '../db/client.js'

export async function loadResourceCollectionContext(subject: PlatformResourceSubject) {
  const [context] = await sql<{ organizationVersion: number; corporationId: number | null }[]>`
    select settings.organization_version::integer as "organizationVersion",
      case when lifecycle.subject_kind = 'character' then character.corporation_id
           when lifecycle.subject_kind = 'corporation' then source.corporation_id
           else null end as "corporationId"
    from deployment_settings settings
    join platform_subject_lifecycles lifecycle
      on lifecycle.subject_lifecycle_id = ${subject.lifecycleId}
    left join characters character on character.character_id = lifecycle.character_id
    left join organization_corporation_sources source
      on source.source_id = lifecycle.corporation_source_id
    where settings.id = 1
      and (lifecycle.organization_version is null
           or lifecycle.organization_version = settings.organization_version)
      and (source.source_id is null or source.organization_version = settings.organization_version)
  `
  if (!context) throw new Error('Resource collection context is obsolete')
  return context
}
