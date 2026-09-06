import {
  platformNavigationPlacements,
  type PlatformInstalledModuleDefinition,
  type PlatformNavigationDefault,
} from '@eve-space/platform-module-contract'
import type postgres from 'postgres'
import {
  installedModuleDefinitions,
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

type InstalledModuleSetting = PlatformInstalledModuleDefinition & {
  readonly enabled: boolean
  readonly updatedAt: string
}

interface DeploymentModuleRow {
  readonly module_id: string
  readonly enabled: boolean
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

export async function listInstalledModuleSettings(
  connection?: postgres.Sql,
  definitions: readonly PlatformInstalledModuleDefinition[] = installedModuleDefinitions,
): Promise<readonly InstalledModuleSetting[]> {
  if (definitions.length === 0) return []
  const rows = await loadDeploymentModuleRows(await connectionOrDefault(connection))
  const rowsById = new Map(rows.map((row) => [row.module_id, row]))
  return definitions.map((definition) => {
    const row = rowsById.get(definition.moduleId)
    if (!row) throw new Error(`Installed module setting ${definition.moduleId} is missing`)
    return toModuleSetting(definition, row)
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
    update deployment_modules
    set enabled = ${enabled}, updated_at = now()
    where module_id = ${moduleId}
    returning module_id, enabled, updated_at
  `
  if (!row) throw new Error(`Installed module setting ${moduleId} is missing`)
  invalidateModuleRuntimeState()
  return toModuleSetting(definition, row)
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
): Promise<ModuleRuntimeState> {
  if (
    connection ||
    definitions !== installedModuleDefinitions ||
    defaults !== platformNavigationDefaults
  )
    return loadUncachedModuleRuntimeState(
      await connectionOrDefault(connection),
      definitions,
      defaults,
    )

  return loadCachedModuleRuntimeState(
    () =>
      connectionOrDefault().then((database) =>
        loadUncachedModuleRuntimeState(database, definitions, defaults),
      ),
    async () => (await import('../env.js')).env.MODULE_RUNTIME_CACHE_TTL_MS,
  )
}

export async function isInstalledModuleEnabled(moduleId: string) {
  const definitions = installedModuleDefinitions as readonly PlatformInstalledModuleDefinition[]
  if (!definitions.some((definition) => definition.moduleId === moduleId)) return false
  return (await loadModuleRuntimeState()).enabledModuleIds.includes(moduleId)
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
): Promise<ModuleRuntimeState> {
  const [modules, rows] = await Promise.all([
    loadDeploymentModuleRows(database),
    loadNavigationOrderRows(database),
  ])
  const enabledRows = new Set(
    modules.filter(({ enabled }) => enabled).map(({ module_id }) => module_id),
  )
  const enabledModuleIds = definitions
    .map(({ moduleId }) => moduleId)
    .filter((moduleId) => enabledRows.has(moduleId))
  return {
    enabledModuleIds,
    shellNavigationOrder: resolveShellNavigationOrder(
      defaults,
      rows,
      new Set(['core', ...enabledModuleIds]),
    ),
  }
}

async function loadDeploymentModuleRows(connection: postgres.Sql) {
  return connection<DeploymentModuleRow[]>`
    select module_id, enabled, updated_at from deployment_modules
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
): InstalledModuleSetting {
  return {
    moduleId: definition.moduleId,
    enabled: row.enabled,
    defaultEnabled: definition.defaultEnabled,
    updatedAt: row.updated_at.toISOString(),
  }
}

async function connectionOrDefault(connection?: postgres.Sql) {
  return connection ?? (await import('../db/client.js')).sql
}
