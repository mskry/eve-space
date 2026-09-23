import type {
  PlatformInstalledResourceDescriptor,
  PlatformResourceInvalidAuthority,
  PlatformResourceImplementation,
} from '@eve-space/platform-module-contract/resources'
import type postgres from 'postgres'
import { sql } from '../db/client.js'
import { installedModuleResources } from '../generated/platform/installed-module-worker.js'
import { createPlatformModuleLogger } from './module-logging.js'
import { createPlatformResourceMaintenancePersistence } from './module-persistence-capabilities.js'

interface ResourceMaintenanceOptions {
  readonly connection?: postgres.Sql
  readonly now?: Date
  readonly resources?: readonly PlatformInstalledResourceDescriptor[]
  readonly signal?: AbortSignal
}

interface ResourcePurgeWorkBase {
  readonly purgeWorkId: string
  readonly moduleId: string
  readonly resourceId: string
  readonly targetUserId: string
}

type ResourcePurgeWork =
  | (ResourcePurgeWorkBase & { readonly mode: 'account' })
  | (ResourcePurgeWorkBase & PlatformResourceInvalidAuthority & { readonly mode: 'authority' })

export async function runInstalledResourceMaintenance(options: ResourceMaintenanceOptions = {}) {
  const connection = options.connection ?? sql
  const now = options.now ?? new Date()
  const resources = options.resources ?? installedModuleResources
  const purgeWork = await loadPurgeWork(connection)
  const maintainableResources = resources.filter((resource) =>
    Boolean((resource.implementation as PlatformResourceImplementation).maintain),
  )
  for (const resource of maintainableResources) {
    options.signal?.throwIfAborted()
    // oxlint-disable-next-line no-await-in-loop -- Module purges share evidence tables and must not race.
    await maintainResource(connection, resource, purgeWork, now, options.signal)
  }

  return { maintained: maintainableResources.length }
}

async function maintainResource(
  connection: postgres.Sql,
  resource: PlatformInstalledResourceDescriptor,
  purgeWork: readonly ResourcePurgeWork[],
  now: Date,
  signal?: AbortSignal,
) {
  const implementation = resource.implementation as PlatformResourceImplementation
  const resourcePurgeWork = purgeWork.filter(
    (work) => work.moduleId === resource.moduleId && work.resourceId === resource.resourceId,
  )
  const invalidAuthorities = [
    ...(await loadInvalidAuthorities(connection, resource, now)),
    ...resourcePurgeWork.filter((work) => work.mode === 'authority'),
  ]
  const persistence = createPlatformResourceMaintenancePersistence(
    resource.moduleId,
    resource.resourceId,
    signal,
  )
  await implementation.maintain?.({
    now: now.toISOString(),
    purgeAccountIds: [
      ...new Set(
        resourcePurgeWork
          .filter((work) => work.mode === 'account')
          .map((work) => work.targetUserId),
      ),
    ],
    invalidAuthorities,
    purgeRetention: true,
    ...(signal ? { signal } : {}),
    capabilities: {
      logger: createPlatformModuleLogger(resource.moduleId),
      persistence,
    },
  })
  await Promise.all(
    resourcePurgeWork.map(
      ({ purgeWorkId }) =>
        connection`delete from platform_resource_purge_work where purge_work_id = ${purgeWorkId}::uuid`,
    ),
  )
}

async function loadPurgeWork(connection: postgres.Sql) {
  return connection<ResourcePurgeWork[]>`
    select
      purge_work_id as "purgeWorkId",
      module_id as "moduleId",
      resource_id as "resourceId",
      mode,
      target_user_id as "targetUserId",
      organization_version::integer as "organizationVersion",
      managed_member_lifecycle_id as "managedMemberLifecycleId",
      character_id::integer as "characterId",
      character_lifecycle_id as "characterLifecycleId",
      authorization_generation as "authorizationGeneration",
      disclosure_version as "disclosureVersion",
      section_activation_version as "sectionActivationVersion"
    from platform_resource_purge_work
    order by created_at, purge_work_id
    limit 1000
  `
}

async function loadInvalidAuthorities(
  connection: postgres.Sql,
  resource: PlatformInstalledResourceDescriptor,
  now: Date,
) {
  if (
    resource.subjectKind !== 'character' ||
    resource.eligibility.kind !== 'current-managed-member-character'
  )
    return []
  return connection<PlatformResourceInvalidAuthority[]>`
    select
      state.organization_version::integer as "organizationVersion",
      state.target_user_id as "targetUserId",
      state.managed_member_lifecycle_id as "managedMemberLifecycleId",
      state.subject_id::bigint::integer as "characterId",
      state.subject_lifecycle_id as "characterLifecycleId",
      state.authorization_generation as "authorizationGeneration",
      state.disclosure_version as "disclosureVersion",
      state.section_activation_version as "sectionActivationVersion"
    from platform_collection_state state
    join deployment_modules module_setting
      on module_setting.module_id = state.module_id
    join deployment_module_sections section_setting
      on section_setting.module_id = state.module_id
      and section_setting.section_id = state.section_id
    cross join deployment_settings organization
    left join organization_managed_member_lifecycles member_lifecycle
      on member_lifecycle.managed_member_lifecycle_id = state.managed_member_lifecycle_id
      and member_lifecycle.deployment_id = state.organization_deployment_id
      and member_lifecycle.organization_version = state.organization_version
      and member_lifecycle.user_id = state.target_user_id
      and member_lifecycle.ended_at is null
    left join characters character
      on character.character_id = state.subject_id::bigint
      and character.user_id = state.target_user_id
    left join platform_subject_lifecycles character_lifecycle
      on character_lifecycle.subject_kind = 'character'
      and character_lifecycle.subject_lifecycle_id = state.subject_lifecycle_id
      and character_lifecycle.subject_id = state.subject_id
      and character_lifecycle.character_id = character.character_id
    left join eve_tokens token
      on token.character_id = character.character_id
    where organization.id = 1
      and state.module_id = ${resource.moduleId}
      and state.resource_id = ${resource.resourceId}
      and state.subject_kind = 'character'
      and state.organization_version is not null
      and state.target_user_id is not null
      and state.managed_member_lifecycle_id is not null
      and state.authorization_generation is not null
      and state.disclosure_version is not null
      and state.section_activation_version is not null
      and (
        not module_setting.enabled
        or not section_setting.enabled
        or state.organization_version <> organization.organization_version
        or state.disclosure_version <> section_setting.disclosure_version
        or state.section_activation_version <> section_setting.activation_version
        or member_lifecycle.managed_member_lifecycle_id is null
        or character.character_id is null
        or character_lifecycle.subject_lifecycle_id is null
        or token.character_id is null
        or token.token_version <> state.authorization_generation
      )
      and state.updated_at <= ${now.toISOString()}::timestamptz
    order by state.updated_at, state.subject_lifecycle_id
    limit 1000
  `
}
