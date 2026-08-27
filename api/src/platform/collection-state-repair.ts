import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract'
import type postgres from 'postgres'
import { z } from 'zod'
import { sql } from '../db/client.js'
import { getOptionalCharacterEsiScope, type EsiOperation } from '../esi-resilience/catalog.js'
import { installedModuleResources } from '../generated/platform/installed-module-worker.js'

interface CollectionStateRepairOptions {
  readonly connection?: postgres.Sql
  readonly resources?: readonly PlatformInstalledResourceDescriptor[]
  readonly signal?: AbortSignal
  readonly characterId?: number
}

export async function repairPlatformCollectionState(options: CollectionStateRepairOptions = {}) {
  const connection = options.connection ?? sql
  const subjectId =
    options.characterId === undefined
      ? null
      : String(z.number().int().positive().safe().parse(options.characterId))
  const repairs = (options.resources ?? installedModuleResources).flatMap((resource) => {
    if (resource.subjectKind !== 'character') return []
    const requiredScope = getOptionalCharacterEsiScope(resource.operationId as EsiOperation)
    return requiredScope
      ? [
          {
            module_id: resource.moduleId,
            resource_id: resource.resourceId,
            required_scope: requiredScope,
          },
        ]
      : []
  })
  if (repairs.length === 0) return { repairedResources: 0 }
  const repairJson = JSON.stringify(repairs)

  options.signal?.throwIfAborted()
  await connection`
    with installed_resources as (
      select module_id, resource_id, required_scope
      from jsonb_to_recordset(${repairJson}::text::jsonb) as resource (
        module_id text,
        resource_id text,
        required_scope text
      )
    )
    insert into platform_collection_state (
      module_id,
      resource_id,
      subject_kind,
      subject_lifecycle_id,
      subject_id,
      next_eligible_at,
      authorization_generation,
      validated_at,
      last_failure_class
    )
    select
      resource.module_id,
      resource.resource_id,
      'character',
      lifecycle.subject_lifecycle_id,
      lifecycle.subject_id,
      null,
      token.token_version,
      null,
      'authorization-required'
    from installed_resources resource
    join deployment_modules module_setting
      on module_setting.module_id = resource.module_id
      and module_setting.enabled = true
    cross join platform_subject_lifecycles lifecycle
    join characters character on character.character_id = lifecycle.character_id
    join eve_tokens token on token.character_id = character.character_id
    where lifecycle.subject_kind = 'character'
      and (${subjectId}::text is null or lifecycle.subject_id = ${subjectId})
      and not (token.scopes @> jsonb_build_array(resource.required_scope))
    on conflict (
      module_id,
      resource_id,
      subject_kind,
      subject_lifecycle_id,
      subject_id
    ) do update set
      next_eligible_at = null,
      authorization_generation = excluded.authorization_generation,
      last_failure_class = 'authorization-required',
      updated_at = now()
    where platform_collection_state.authorization_generation is distinct from
        excluded.authorization_generation
      or platform_collection_state.last_failure_class is distinct from 'authorization-required'
  `

  options.signal?.throwIfAborted()
  await connection`
    with installed_resources as (
      select module_id, resource_id, required_scope
      from jsonb_to_recordset(${repairJson}::text::jsonb) as resource (
        module_id text,
        resource_id text,
        required_scope text
      )
    )
    update platform_collection_state state
    set
      next_eligible_at = now(),
      authorization_generation = token.token_version,
      last_failure_class = null,
      updated_at = now()
    from installed_resources resource
    join deployment_modules module_setting
      on module_setting.module_id = resource.module_id
      and module_setting.enabled = true
    cross join platform_subject_lifecycles lifecycle
    join characters character on character.character_id = lifecycle.character_id
    join eve_tokens token on token.character_id = character.character_id
    where state.module_id = resource.module_id
      and state.resource_id = resource.resource_id
      and state.subject_kind = 'character'
      and state.subject_lifecycle_id = lifecycle.subject_lifecycle_id
      and state.subject_id = lifecycle.subject_id
      and (${subjectId}::text is null or lifecycle.subject_id = ${subjectId})
      and token.scopes @> jsonb_build_array(resource.required_scope)
      and (
        state.authorization_generation is distinct from token.token_version
        or state.last_failure_class = 'authorization-required'
      )
  `

  return { repairedResources: repairs.length }
}
