import { readFile } from 'node:fs/promises'
import {
  compareStable,
  isReservedPlatformModuleId,
  platformMigrationFilenamePattern,
  platformModuleIdMaxLength,
  platformModuleIdPattern,
  type PlatformInstalledModuleMigrationDescriptor,
} from '@eve-space/platform-module-contract'
import type postgres from 'postgres'
import {
  assertDistinctModuleMigrationLockKeys,
  moduleMigrationLockKey,
  moduleMigrationLockNamespace,
} from './locks.js'
import { assertTransactionalMigration, type Migration } from './migration-runner.js'
import {
  modulePersistenceNames,
  provisionModulePersistence,
} from './module-persistence-provisioner.js'

const moduleMigrationLockTimeoutMs = 30_000

export type InstalledModuleMigrationDescriptor = PlatformInstalledModuleMigrationDescriptor

export interface ModuleMigrationSet {
  readonly moduleId: string
  readonly migrations: readonly Migration[]
}

export type ModuleMigrationSqlLoader = (
  descriptor: InstalledModuleMigrationDescriptor,
) => Promise<string>

interface ModuleMigrationRunOptions {
  lockTimeoutMs?: number
}

export async function loadInstalledModuleMigrationSets(
  descriptors: readonly InstalledModuleMigrationDescriptor[],
  loadSql: ModuleMigrationSqlLoader = loadModuleMigrationSql,
  moduleIds: readonly string[] = [...new Set(descriptors.map(({ moduleId }) => moduleId))],
): Promise<readonly ModuleMigrationSet[]> {
  validateDescriptors(descriptors, moduleIds)
  const grouped = new Map<string, InstalledModuleMigrationDescriptor[]>()
  for (const moduleId of moduleIds) grouped.set(moduleId, [])
  for (const descriptor of descriptors) {
    const migrations = grouped.get(descriptor.moduleId)
    if (!migrations)
      throw new Error(`Migration references uninstalled module ${descriptor.moduleId}`)
    migrations.push(descriptor)
  }

  return Promise.all(
    [...grouped]
      .toSorted(([left], [right]) => compareStable(left, right))
      .map(async ([moduleId, migrations]) => ({
        moduleId,
        migrations: await Promise.all(
          migrations.map(async ({ name, ...descriptor }) => ({
            name,
            sql: await loadSql({ name, ...descriptor }),
          })),
        ),
      })),
  )
}

export async function runModuleMigrationSets(
  connection: postgres.Sql,
  migrationSets: readonly ModuleMigrationSet[],
  { lockTimeoutMs = moduleMigrationLockTimeoutMs }: ModuleMigrationRunOptions = {},
) {
  const moduleIds = migrationSets.map(({ moduleId }) => moduleId)
  validateDescriptors(
    migrationSets.flatMap(({ moduleId, migrations }) =>
      migrations.map(({ name }) => ({ moduleId, name })),
    ),
    moduleIds,
  )
  if (new Set(moduleIds).size !== moduleIds.length)
    throw new Error('Installed module migration sets contain duplicate module owners')

  // oxlint-disable no-await-in-loop
  for (const { moduleId, migrations } of migrationSets) {
    const reservedConnection = await connection.reserve()
    let lockAcquired = false
    try {
      await reservedConnection`select set_config('lock_timeout', ${`${lockTimeoutMs}ms`}, false)`
      await reservedConnection`
        select pg_advisory_lock(
          ${moduleMigrationLockNamespace},
          ${moduleMigrationLockKey(moduleId)}
        )
      `
      lockAcquired = true

      const applied = await reservedConnection<{ name: string }[]>`
        select name from public.schema_migrations where module = ${moduleId}
      `
      const appliedNames = new Set(applied.map(({ name }) => name))
      const { schemaName } = modulePersistenceNames(moduleId)
      let persistenceProvisioned = false

      for (const migration of migrations) {
        if (appliedNames.has(migration.name)) continue
        assertTransactionalMigration(migration)

        await reservedConnection`begin`
        try {
          if (!persistenceProvisioned)
            await provisionModulePersistence(reservedConnection, moduleId)
          await reservedConnection`
            select set_config('search_path', ${`${schemaName}, pg_catalog`}, true)
          `
          await reservedConnection.unsafe(migration.sql).simple()
          await reservedConnection`
            insert into public.schema_migrations (module, name)
            values (${moduleId}, ${migration.name})
          `
          await reservedConnection`commit`
        } catch (error) {
          await reservedConnection`rollback`
          throw error
        }

        persistenceProvisioned = true
        console.log(`Applied migration ${moduleId}/${migration.name}`)
      }

      if (!persistenceProvisioned) {
        await reservedConnection`begin`
        try {
          await provisionModulePersistence(reservedConnection, moduleId)
          await reservedConnection`commit`
        } catch (error) {
          await reservedConnection`rollback`
          throw error
        }
      }
    } finally {
      try {
        if (lockAcquired)
          await reservedConnection`
            select pg_advisory_unlock(
              ${moduleMigrationLockNamespace},
              ${moduleMigrationLockKey(moduleId)}
            )
          `
      } finally {
        try {
          await reservedConnection`select set_config('lock_timeout', '0', false)`
        } finally {
          reservedConnection.release()
        }
      }
    }
  }
  // oxlint-enable no-await-in-loop
}

async function loadModuleMigrationSql({ moduleId, name }: InstalledModuleMigrationDescriptor) {
  const resolved = import.meta.resolve(`@eve-space/${moduleId}-server/migrations/${name}`)
  return readFile(new URL(resolved), 'utf8')
}

function validateDescriptors(
  descriptors: readonly InstalledModuleMigrationDescriptor[],
  moduleIds: readonly string[],
) {
  for (const moduleId of moduleIds) validateModuleId(moduleId)
  const identities = new Set<string>()
  for (const { moduleId, name } of descriptors) {
    validateModuleId(moduleId)
    if (!name.startsWith(`${moduleId}-`) || !platformMigrationFilenamePattern.test(name))
      throw new Error(`Migration ${moduleId}/${name} must use package-local ${moduleId}-*.sql`)

    const identity = `${moduleId}/${name}`
    if (identities.has(identity))
      throw new Error(`Duplicate installed module migration ${identity}`)
    identities.add(identity)
  }
  assertDistinctModuleMigrationLockKeys(moduleIds)
}

function validateModuleId(moduleId: string) {
  if (
    !platformModuleIdPattern.test(moduleId) ||
    moduleId.length > platformModuleIdMaxLength ||
    isReservedPlatformModuleId(moduleId)
  )
    throw new Error(`Invalid installed module migration owner ${moduleId}`)
}
