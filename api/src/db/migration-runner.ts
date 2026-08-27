import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type postgres from 'postgres'
import { migrationLockId } from './locks.js'
import { assertTransactionalMigration, type Migration } from './migration-validation.js'

const migrationsDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url))
const migrationLockTimeoutMs = 30_000
const coreMigrationOwner = 'core'

export interface MigrationRunOptions {
  lockTimeoutMs?: number
}

export async function loadMigrations(): Promise<Migration[]> {
  const files = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith('.sql'))
    .toSorted((left, right) => left.localeCompare(right))

  return Promise.all(
    files.map(async (name) => ({
      name,
      sql: await readFile(`${migrationsDirectory}/${name}`, 'utf8'),
    })),
  )
}

export async function runMigrations(
  connection: postgres.Sql,
  migrations?: Migration[],
  { lockTimeoutMs = migrationLockTimeoutMs }: MigrationRunOptions = {},
) {
  const migrationsToApply = migrations ?? (await loadMigrations())

  const reservedConnection = await connection.reserve()
  const [session] = await reservedConnection<{ lock_timeout: string }[]>`
    select current_setting('lock_timeout') as lock_timeout
  `
  const restoreLockTimeout = session?.lock_timeout ?? '0'
  try {
    await reservedConnection`select set_config('lock_timeout', ${`${lockTimeoutMs}ms`}, false)`
    await reservedConnection`select pg_advisory_lock(${migrationLockId})`
    await reservedConnection`
      create table if not exists schema_migrations (
        module text not null default 'core',
        name text not null,
        applied_at timestamptz not null default now(),
        constraint schema_migrations_pkey primary key (module, name)
      )
    `

    const applied = await reservedConnection<{ name: string }[]>`
      select name from schema_migrations where module = ${coreMigrationOwner}
    `
    const appliedNames = new Set(applied.map((migration) => migration.name))

    // Migrations are ordered and each must commit before the next begins.
    // oxlint-disable no-await-in-loop
    for (const migration of migrationsToApply) {
      if (appliedNames.has(migration.name)) continue
      assertTransactionalMigration(migration)

      await reservedConnection`begin`
      try {
        await reservedConnection.unsafe(migration.sql).simple()
        await reservedConnection`
          insert into schema_migrations (module, name)
          values (${coreMigrationOwner}, ${migration.name})
        `
        await reservedConnection`commit`
      } catch (error) {
        await reservedConnection`rollback`
        throw error
      }

      console.log(`Applied migration ${migration.name}`)
    }
    // oxlint-enable no-await-in-loop
  } finally {
    try {
      await reservedConnection`select pg_advisory_unlock(${migrationLockId})`
    } finally {
      try {
        await reservedConnection`select set_config('lock_timeout', ${restoreLockTimeout}, false)`
      } finally {
        reservedConnection.release()
      }
    }
  }
}
