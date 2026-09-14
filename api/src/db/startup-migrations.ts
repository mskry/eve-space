import type { PlatformInstalledModuleDefinition } from '@eve-space/platform-module-contract'
import type postgres from 'postgres'
import {
  installedModuleIds,
  installedModuleMigrations,
} from '../generated/platform/installed-module-migrations.js'
import {
  installedModulePersistenceContractFingerprint,
  installedModulePersistenceOperations,
} from '../generated/platform/installed-module-persistence.js'
import {
  assertInstalledModulePersistenceContractWhenCurrent,
  persistenceContractFingerprintFor,
  reconcileInstalledModulePersistenceContract,
} from './module-persistence-attestation.js'
import {
  loadInstalledModuleMigrationSets,
  runModuleMigrationSets,
  type InstalledModuleMigrationDescriptor,
  type ModuleMigrationSet,
  type ModuleMigrationSqlLoader,
} from './module-migration-runner.js'
import { runMigrations } from './migration-runner.js'
import { reconcileInstalledModules } from '../platform/module-settings.js'

interface StartupMigrationOptions {
  installed?: readonly InstalledModuleMigrationDescriptor[]
  moduleIds?: readonly string[]
  moduleDefinitions?: readonly PlatformInstalledModuleDefinition[]
  persistenceOperations?: NonNullable<ModuleMigrationSet['persistenceOperations']>
  persistenceContractFingerprint?: string
  loadModuleSql?: ModuleMigrationSqlLoader
}

export async function runStartupMigrations(
  connection: postgres.Sql,
  options: StartupMigrationOptions = {},
) {
  const installed = options.installed ?? installedModuleMigrations
  const usesGeneratedCatalog =
    options.installed === undefined &&
    options.moduleIds === undefined &&
    options.persistenceOperations === undefined
  const persistenceOperations =
    options.persistenceOperations ??
    (usesGeneratedCatalog ? installedModulePersistenceOperations : [])
  const moduleIds =
    options.moduleIds ??
    (options.installed
      ? [...new Set(installed.map(({ moduleId }) => moduleId))]
      : installedModuleIds)
  const persistenceContractFingerprint =
    options.persistenceContractFingerprint ??
    (usesGeneratedCatalog
      ? installedModulePersistenceContractFingerprint
      : persistenceContractFingerprintFor(persistenceOperations, moduleIds))
  const moduleMigrations = await loadInstalledModuleMigrationSets(
    installed,
    options.loadModuleSql,
    moduleIds,
    persistenceOperations,
  )
  await runMigrations(connection)
  await assertInstalledModulePersistenceContractWhenCurrent(
    connection,
    persistenceContractFingerprint,
    persistenceOperations,
    moduleIds,
  )
  await runModuleMigrationSets(connection, moduleMigrations)
  await reconcileInstalledModulePersistenceContract(
    connection,
    persistenceContractFingerprint,
    persistenceOperations,
    moduleIds,
  )
  await reconcileInstalledModules(connection, options.moduleDefinitions)
}
