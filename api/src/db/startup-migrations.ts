import type { PlatformInstalledModuleDefinition } from '@eve-space/platform-module-contract'
import type postgres from 'postgres'
import {
  installedModuleIds,
  installedModuleMigrations,
} from '../generated/platform/installed-module-migrations.js'
import {
  loadInstalledModuleMigrationSets,
  runModuleMigrationSets,
  type InstalledModuleMigrationDescriptor,
  type ModuleMigrationSqlLoader,
} from './module-migration-runner.js'
import { runMigrations } from './migration-runner.js'
import { reconcileInstalledModules } from '../platform/module-settings.js'

interface StartupMigrationOptions {
  installed?: readonly InstalledModuleMigrationDescriptor[]
  moduleIds?: readonly string[]
  moduleDefinitions?: readonly PlatformInstalledModuleDefinition[]
  loadModuleSql?: ModuleMigrationSqlLoader
}

export async function runStartupMigrations(
  connection: postgres.Sql,
  options: StartupMigrationOptions = {},
) {
  const installed = options.installed ?? installedModuleMigrations
  const moduleIds =
    options.moduleIds ??
    (options.installed
      ? [...new Set(installed.map(({ moduleId }) => moduleId))]
      : installedModuleIds)
  const moduleMigrations = await loadInstalledModuleMigrationSets(
    installed,
    options.loadModuleSql,
    moduleIds,
  )
  await runMigrations(connection)
  await runModuleMigrationSets(connection, moduleMigrations)
  await reconcileInstalledModules(connection, options.moduleDefinitions)
}
