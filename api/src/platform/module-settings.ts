import {
  platformNavigationPlacements,
  type PlatformNavigationDefault,
} from '@eve-space/platform-module-contract/nuxt'
import {
  type PlatformInstalledModuleDefinition,
  type PlatformInstalledModuleSectionDefinition,
} from '@eve-space/platform-module-contract/installed'
import type postgres from 'postgres'
import {
  installedModuleDefinitions,
  installedModuleSectionDefinitions,
  platformNavigationDefaults,
} from '../generated/platform/installed-module-runtime.js'
import {
  isCompleteShellNavigationOrder,
  resolveShellNavigationOrder,
  type NavigationOrderRow,
  type ShellNavigationOrder,
} from './module-navigation.js'
import {
  invalidateModuleRuntimeState,
  loadCachedModuleRuntimeState,
  type ModuleRuntimeState,
} from './module-runtime-cache.js'

export type InstalledModuleSectionSetting = PlatformInstalledModuleSectionDefinition & {
  readonly enabled: boolean
  readonly disclosureVersion: number
  readonly activationVersion: number
  readonly updatedAt: string
}

export type InstalledModuleSetting = PlatformInstalledModuleDefinition & {
  readonly enabled: boolean
  readonly sections: readonly InstalledModuleSectionSetting[]
  readonly updatedAt: string
}

interface DeploymentModuleRow {
  readonly module_id: string
  readonly enabled: boolean
  readonly updated_at: Date
}

interface DeploymentModuleSectionRow {
  readonly module_id: string
  readonly section_id: string
  readonly kind: 'workspace' | 'sensitive-evidence' | 'access-management'
  readonly enabled: boolean
  readonly declaration_revision: number | null
  readonly disclosure_version: number
  readonly activation_version: number
  readonly updated_at: Date
}

export async function reconcileInstalledModules(
  connection: postgres.Sql,
  definitions: readonly PlatformInstalledModuleDefinition[] = installedModuleDefinitions,
) {
  if (definitions.length === 0) return

  const rows = definitions.map(({ moduleId, defaultEnabled }) => ({
    module_id: moduleId,
    enabled: defaultEnabled,
  }))
  await connection`
    insert into deployment_modules ${connection(rows, 'module_id', 'enabled')}
    on conflict (module_id) do nothing
  `
}

export async function reconcileInstalledModuleSections(
  connection: postgres.Sql,
  definitions: readonly PlatformInstalledModuleSectionDefinition[] = installedModuleSectionDefinitions,
) {
  if (definitions.length === 0) return
  const rows = definitions.map((definition) => ({
    module_id: definition.moduleId,
    section_id: definition.id,
    kind: definition.kind,
    enabled: false,
    declaration_revision:
      definition.kind === 'sensitive-evidence' ? definition.disclosureRevision : null,
  }))
  await connection`
    insert into deployment_module_sections ${connection(
      rows,
      'module_id',
      'section_id',
      'kind',
      'enabled',
      'declaration_revision',
    )}
    on conflict (module_id, section_id) do update
    set
      kind = excluded.kind,
      declaration_revision = excluded.declaration_revision,
      disclosure_version = case
        when excluded.kind <> 'sensitive-evidence' then 0
        when deployment_module_sections.kind is distinct from excluded.kind
          or deployment_module_sections.declaration_revision is distinct from excluded.declaration_revision
          then deployment_module_sections.disclosure_version + 1
        else deployment_module_sections.disclosure_version
      end,
      updated_at = case
        when deployment_module_sections.kind is distinct from excluded.kind
          or deployment_module_sections.declaration_revision is distinct from excluded.declaration_revision
          then now()
        else deployment_module_sections.updated_at
      end
  `
}

export async function listInstalledModuleSettings(
  connection?: postgres.Sql,
  definitions: readonly PlatformInstalledModuleDefinition[] = installedModuleDefinitions,
  sectionDefinitions: readonly PlatformInstalledModuleSectionDefinition[] = installedModuleSectionDefinitions,
): Promise<readonly InstalledModuleSetting[]> {
  if (definitions.length === 0) return []
  const database = await connectionOrDefault(connection)
  const [rows, sectionRows] = await Promise.all([
    loadDeploymentModuleRows(database),
    sectionDefinitions.length > 0 ? loadDeploymentModuleSectionRows(database) : [],
  ])
  const rowsById = new Map(rows.map((row) => [row.module_id, row]))
  const sectionRowsById = new Map(
    sectionRows.map((row) => [moduleSectionKey(row.module_id, row.section_id), row]),
  )
  return definitions.map((definition) => {
    const row = rowsById.get(definition.moduleId)
    if (!row) throw new Error(`Installed module setting ${definition.moduleId} is missing`)
    const sections = sectionDefinitions
      .filter(({ moduleId }) => moduleId === definition.moduleId)
      .map((sectionDefinition) => {
        const sectionRow = sectionRowsById.get(
          moduleSectionKey(sectionDefinition.moduleId, sectionDefinition.id),
        )
        if (!sectionRow)
          throw new Error(
            `Installed module section setting ${sectionDefinition.moduleId}/${sectionDefinition.id} is missing`,
          )
        return toModuleSectionSetting(sectionDefinition, sectionRow)
      })
    return toModuleSetting(definition, row, sections)
  })
}

export async function setInstalledModuleEnabled(
  moduleId: string,
  enabled: boolean,
  connection?: postgres.Sql,
  definitions: readonly PlatformInstalledModuleDefinition[] = installedModuleDefinitions,
): Promise<InstalledModuleSetting | null> {
  const definition = definitions.find((candidate) => candidate.moduleId === moduleId)
  if (!definition) return null

  const database = await connectionOrDefault(connection)
  const [row] = await database<DeploymentModuleRow[]>`
    with changed as (
      update deployment_modules
      set enabled = ${enabled}, updated_at = now()
      where module_id = ${moduleId} and enabled is distinct from ${enabled}
      returning module_id, enabled, updated_at
    ), rotated_sections as (
      update deployment_module_sections
      set activation_version = activation_version + 1, updated_at = now()
      where module_id = ${moduleId}
        and enabled
        and ${enabled}
        and exists (select 1 from changed)
    )
    select module_id, enabled, updated_at from changed
    union all
    select module_id, enabled, updated_at
    from deployment_modules
    where module_id = ${moduleId} and not exists (select 1 from changed)
  `
  if (!row) throw new Error(`Installed module setting ${moduleId} is missing`)
  invalidateModuleRuntimeState()
  const sectionDefinitions = (
    installedModuleSectionDefinitions as readonly PlatformInstalledModuleSectionDefinition[]
  ).filter(({ moduleId: candidate }) => candidate === moduleId)
  const sectionRows = sectionDefinitions.length
    ? await loadDeploymentModuleSectionRows(database)
    : []
  const sectionRowsById = new Map(sectionRows.map((section) => [section.section_id, section]))
  const sections = sectionDefinitions.map((sectionDefinition) => {
    const sectionRow = sectionRowsById.get(sectionDefinition.id)
    if (!sectionRow)
      throw new Error(
        `Installed module section setting ${moduleId}/${sectionDefinition.id} is missing`,
      )
    return toModuleSectionSetting(sectionDefinition, sectionRow)
  })
  return toModuleSetting(definition, row, sections)
}

export async function setInstalledModuleSectionEnabled(
  moduleId: string,
  sectionId: string,
  enabled: boolean,
  connection?: postgres.Sql,
  definitions: readonly PlatformInstalledModuleSectionDefinition[] = installedModuleSectionDefinitions,
): Promise<InstalledModuleSectionSetting | null> {
  const definition = definitions.find(
    (candidate) => candidate.moduleId === moduleId && candidate.id === sectionId,
  )
  if (!definition) return null
  const database = await connectionOrDefault(connection)
  const [row] = await database<DeploymentModuleSectionRow[]>`
    update deployment_module_sections
    set
      enabled = ${enabled},
      activation_version = activation_version + case when not enabled and ${enabled} then 1 else 0 end,
      disclosure_version = disclosure_version + case
        when kind = 'sensitive-evidence' and not enabled and ${enabled} and disclosure_version = 0
          then 1
        else 0
      end,
      updated_at = case when enabled is distinct from ${enabled} then now() else updated_at end
    where module_id = ${moduleId} and section_id = ${sectionId}
    returning module_id, section_id, kind, enabled, declaration_revision,
      disclosure_version, activation_version, updated_at
  `
  if (!row) throw new Error(`Installed module section setting ${moduleId}/${sectionId} is missing`)
  invalidateModuleRuntimeState()
  return toModuleSectionSetting(definition, row)
}

export async function loadInstalledShellNavigationOrder(
  connection?: postgres.Sql,
  definitions: readonly PlatformInstalledModuleDefinition[] = installedModuleDefinitions,
  defaults: readonly PlatformNavigationDefault[] = platformNavigationDefaults,
): Promise<ShellNavigationOrder> {
  const rows = await loadNavigationOrderRows(await connectionOrDefault(connection))
  return resolveShellNavigationOrder(
    defaults,
    rows,
    new Set(['core', ...definitions.map(({ moduleId }) => moduleId)]),
  )
}

export async function loadModuleRuntimeState(
  connection?: postgres.Sql,
  definitions: readonly PlatformInstalledModuleDefinition[] = installedModuleDefinitions,
  defaults: readonly PlatformNavigationDefault[] = platformNavigationDefaults,
  sectionDefinitions: readonly PlatformInstalledModuleSectionDefinition[] = installedModuleSectionDefinitions,
): Promise<ModuleRuntimeState> {
  if (
    connection ||
    definitions !== installedModuleDefinitions ||
    defaults !== platformNavigationDefaults ||
    sectionDefinitions !== installedModuleSectionDefinitions
  )
    return loadUncachedModuleRuntimeState(
      await connectionOrDefault(connection),
      definitions,
      defaults,
      sectionDefinitions,
    )

  return loadCachedModuleRuntimeState(
    () =>
      connectionOrDefault().then((database) =>
        loadUncachedModuleRuntimeState(database, definitions, defaults, sectionDefinitions),
      ),
    async () => (await import('../env.js')).env.MODULE_RUNTIME_CACHE_TTL_MS,
  )
}

export async function isInstalledModuleContributionEnabled(moduleId: string, sectionId?: string) {
  const state = await loadModuleRuntimeState()
  if (!state.enabledModuleIds.includes(moduleId)) return false
  if (!sectionId) return true
  return state.enabledSections.some(
    (section) => section.moduleId === moduleId && section.sectionId === sectionId,
  )
}

export async function loadEnabledReviewerUseDisclosures(
  connection?: postgres.Sql,
  definitions: readonly PlatformInstalledModuleSectionDefinition[] = installedModuleSectionDefinitions,
) {
  const evidenceSectionKeys = new Set(
    definitions
      .filter(({ kind }) => kind === 'sensitive-evidence')
      .map(({ moduleId, id }) => moduleSectionKey(moduleId, id)),
  )
  if (evidenceSectionKeys.size === 0) return []

  const database = await connectionOrDefault(connection)
  const rows = await database<
    { module_id: string; section_id: string; disclosure_version: number }[]
  >`
    select section.module_id, section.section_id, section.disclosure_version
    from deployment_module_sections section
    join deployment_modules module on module.module_id = section.module_id
    where module.enabled
      and section.enabled
      and section.kind = 'sensitive-evidence'
      and section.disclosure_version > 0
    order by section.module_id, section.section_id
  `
  return rows
    .filter((row) => evidenceSectionKeys.has(moduleSectionKey(row.module_id, row.section_id)))
    .map((row) => ({
      moduleId: row.module_id,
      sectionId: row.section_id,
      disclosureVersion: row.disclosure_version,
    }))
}

export async function saveInstalledShellNavigationOrder(
  order: ShellNavigationOrder,
  connection?: postgres.Sql,
  definitions: readonly PlatformInstalledModuleDefinition[] = installedModuleDefinitions,
  defaults: readonly PlatformNavigationDefault[] = platformNavigationDefaults,
) {
  const installedOwners = new Set(['core', ...definitions.map(({ moduleId }) => moduleId)])
  const installedDefaults = defaults.filter(({ ownerId }) => installedOwners.has(ownerId))
  if (!isCompleteShellNavigationOrder(order, installedDefaults))
    throw new Error('Invalid shell navigation order')

  const database = await connectionOrDefault(connection)
  const rows = platformNavigationPlacements.flatMap((placement) =>
    order[placement].map(({ ownerId, navigationId }, position) => ({
      owner_id: ownerId,
      navigation_id: navigationId,
      position,
    })),
  )
  if (rows.length > 0)
    await database.begin(async (transaction) => {
      await transaction`
        insert into deployment_shell_navigation_order ${transaction(
          rows,
          'owner_id',
          'navigation_id',
          'position',
        )}
        on conflict (owner_id, navigation_id) do update
        set position = excluded.position, updated_at = now()
      `
    })

  invalidateModuleRuntimeState()
  return loadInstalledShellNavigationOrder(database, definitions, defaults)
}

async function loadUncachedModuleRuntimeState(
  database: postgres.Sql,
  definitions: readonly PlatformInstalledModuleDefinition[],
  defaults: readonly PlatformNavigationDefault[],
  sectionDefinitions: readonly PlatformInstalledModuleSectionDefinition[],
): Promise<ModuleRuntimeState> {
  const [modules, sections, rows] = await Promise.all([
    loadDeploymentModuleRows(database),
    sectionDefinitions.length > 0 ? loadDeploymentModuleSectionRows(database) : [],
    loadNavigationOrderRows(database),
  ])
  const enabledRows = new Set(
    modules.filter(({ enabled }) => enabled).map(({ module_id }) => module_id),
  )
  const enabledModuleIds = definitions
    .map(({ moduleId }) => moduleId)
    .filter((moduleId) => enabledRows.has(moduleId))
  const declaredSections = new Set(
    sectionDefinitions.map(({ moduleId, id }) => moduleSectionKey(moduleId, id)),
  )
  const enabledSections = sections
    .filter(
      (section) =>
        enabledRows.has(section.module_id) &&
        section.enabled &&
        declaredSections.has(moduleSectionKey(section.module_id, section.section_id)),
    )
    .map((section) => ({
      moduleId: section.module_id,
      sectionId: section.section_id,
      kind: section.kind,
      disclosureVersion: section.disclosure_version,
      activationVersion: section.activation_version,
    }))
  const enabledSectionKeys = new Set(
    enabledSections.map(({ moduleId, sectionId }) => moduleSectionKey(moduleId, sectionId)),
  )
  return {
    enabledModuleIds,
    enabledSections,
    shellNavigationOrder: resolveShellNavigationOrder(
      defaults,
      rows,
      new Set(['core', ...enabledModuleIds]),
      enabledSectionKeys,
    ),
  }
}

async function loadDeploymentModuleRows(connection: postgres.Sql) {
  return connection<DeploymentModuleRow[]>`
    select module_id, enabled, updated_at from deployment_modules
  `
}

async function loadDeploymentModuleSectionRows(connection: postgres.Sql) {
  return connection<DeploymentModuleSectionRow[]>`
    select module_id, section_id, kind, enabled, declaration_revision,
      disclosure_version, activation_version, updated_at
    from deployment_module_sections
  `
}

async function loadNavigationOrderRows(connection: postgres.Sql) {
  return connection<NavigationOrderRow[]>`
    select owner_id, navigation_id, position from deployment_shell_navigation_order
  `
}

function toModuleSetting(
  definition: PlatformInstalledModuleDefinition,
  row: DeploymentModuleRow,
  sections: readonly InstalledModuleSectionSetting[],
): InstalledModuleSetting {
  return {
    moduleId: definition.moduleId,
    enabled: row.enabled,
    defaultEnabled: definition.defaultEnabled,
    sections,
    updatedAt: row.updated_at.toISOString(),
  }
}

function toModuleSectionSetting(
  definition: PlatformInstalledModuleSectionDefinition,
  row: DeploymentModuleSectionRow,
): InstalledModuleSectionSetting {
  return {
    ...definition,
    enabled: row.enabled,
    disclosureVersion: row.disclosure_version,
    activationVersion: row.activation_version,
    updatedAt: row.updated_at.toISOString(),
  }
}

function moduleSectionKey(moduleId: string, sectionId: string) {
  return `${moduleId}/${sectionId}`
}

async function connectionOrDefault(connection?: postgres.Sql) {
  return connection ?? (await import('../db/client.js')).sql
}
