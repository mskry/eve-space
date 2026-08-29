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
import type { MigrationRunOptions } from './migration-runner.js'
import { assertTransactionalMigration, type Migration } from './migration-validation.js'
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
  { lockTimeoutMs = moduleMigrationLockTimeoutMs }: MigrationRunOptions = {},
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
  for (const { migrations } of migrationSets)
    for (const migration of migrations) assertTransactionalMigration(migration)

  for (const migrationSet of migrationSets) {
    // oxlint-disable-next-line no-await-in-loop
    await runModuleMigrationSet(connection, migrationSet, lockTimeoutMs)
  }
}

async function runModuleMigrationSet(
  connection: postgres.Sql,
  { moduleId, migrations }: ModuleMigrationSet,
  lockTimeoutMs: number,
) {
  const lease = await acquireModuleMigrationLease(connection, moduleId, lockTimeoutMs)
  let failure: Failure | undefined
  try {
    await applyModuleMigrationSet(lease.connection, moduleId, migrations)
  } catch (error) {
    failure = { error }
  }

  const cleanupFailure = await lease.release()
  if (failure) throw withCleanupFailure(failure.error, cleanupFailure)
  if (cleanupFailure) throw cleanupFailure.error
}

async function applyModuleMigrationSet(
  connection: postgres.ReservedSql,
  moduleId: string,
  migrations: readonly Migration[],
) {
  const applied = await connection<{ name: string }[]>`
    select name from public.schema_migrations where module = ${moduleId}
  `
  const appliedNames = new Set(applied.map(({ name }) => name))
  const pendingMigrations = migrations.filter(({ name }) => !appliedNames.has(name))
  if (pendingMigrations.length === 0) {
    await runInTransaction(connection, () => provisionModulePersistence(connection, moduleId))
    return
  }

  const { schemaName } = modulePersistenceNames(moduleId)
  const searchPath = `${schemaName}, pg_catalog`
  for (const [index, migration] of pendingMigrations.entries()) {
    // oxlint-disable-next-line no-await-in-loop
    await runInTransaction(connection, async () => {
      if (index === 0) await provisionModulePersistence(connection, moduleId)
      await connection`select set_config('search_path', ${searchPath}, true)`
      await connection.unsafe(migration.sql).simple()
      await connection`
        insert into public.schema_migrations (module, name)
        values (${moduleId}, ${migration.name})
      `
    })
    console.log(`Applied migration ${moduleId}/${migration.name}`)
  }
}

async function runInTransaction(connection: postgres.ReservedSql, body: () => Promise<unknown>) {
  await connection`begin`
  try {
    await body()
    await connection`commit`
  } catch (error) {
    throw withCleanupFailure(error, await attempt(() => connection`rollback`))
  }
}

interface ModuleMigrationLease {
  readonly connection: postgres.ReservedSql
  release(): Promise<Failure | undefined>
}

async function acquireModuleMigrationLease(
  connection: postgres.Sql,
  moduleId: string,
  lockTimeoutMs: number,
): Promise<ModuleMigrationLease> {
  const reservedConnection = await connection.reserve()
  const lockKey = moduleMigrationLockKey(moduleId)
  let restoreLockTimeout: string | undefined
  let lockHeld = false

  try {
    const [session] = await reservedConnection<{ lock_timeout: string }[]>`
      select current_setting('lock_timeout') as lock_timeout
    `
    restoreLockTimeout = session?.lock_timeout
    const lockTimeout = `${lockTimeoutMs}ms`
    await reservedConnection`select set_config('lock_timeout', ${lockTimeout}, false)`
    await reservedConnection`
      select pg_advisory_lock(${moduleMigrationLockNamespace}, ${lockKey})
    `
    lockHeld = true
  } catch (error) {
    throw withCleanupFailure(
      error,
      await releaseLease(reservedConnection, lockKey, lockHeld, restoreLockTimeout),
    )
  }

  return {
    connection: reservedConnection,
    release: () => releaseLease(reservedConnection, lockKey, lockHeld, restoreLockTimeout),
  }
}

/**
 * Every step runs even when an earlier one fails, so a broken unlock cannot leave the session
 * timeout overridden or the connection reserved.
 */
async function releaseLease(
  connection: postgres.ReservedSql,
  lockKey: number,
  lockHeld: boolean,
  restoreLockTimeout: string | undefined,
) {
  const failures: unknown[] = []
  const record = (failure: Failure | undefined) => {
    if (failure) failures.push(failure.error)
  }

  if (lockHeld)
    record(
      await attempt(
        () => connection`select pg_advisory_unlock(${moduleMigrationLockNamespace}, ${lockKey})`,
      ),
    )
  if (restoreLockTimeout !== undefined)
    record(
      await attempt(
        () => connection`select set_config('lock_timeout', ${restoreLockTimeout}, false)`,
      ),
    )
  record(await attempt(async () => connection.release()))

  if (failures.length === 0) return undefined
  return {
    error:
      failures.length === 1
        ? failures[0]
        : new AggregateError(failures, 'Module migration connection release failed'),
  }
}

interface Failure {
  readonly error: unknown
}

async function attempt(action: () => Promise<unknown>): Promise<Failure | undefined> {
  try {
    await action()
    return undefined
  } catch (error) {
    return { error }
  }
}

/** Keeps the originating failure first; cleanup failures never replace it. */
function withCleanupFailure(error: unknown, cleanupFailure: Failure | undefined) {
  if (!cleanupFailure) return error
  return new AggregateError(
    [error, cleanupFailure.error],
    'Module migration failed and could not be cleaned up',
  )
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
