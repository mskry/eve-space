import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type postgres from 'postgres'
import { migrationLockId } from './locks.js'
import { assertTransactionalMigration } from './migration-validation.js'

export { assertTransactionalMigration } from './migration-validation.js'

const migrationsDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url))
const migrationLockTimeoutMs = 30_000

export interface Migration {
  name: string
  sql: string
}

interface MigrationRunOptions {
  lockTimeoutMs?: number
}

export async function loadMigrations(): Promise<Migration[]> {
  const files = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith('.sql'))
    .toSorted()

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
  try {
    await reservedConnection`select set_config('lock_timeout', ${`${lockTimeoutMs}ms`}, false)`
    await reservedConnection`select pg_advisory_lock(${migrationLockId})`
    await reservedConnection`
      create table if not exists schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )
    `

    const applied = await reservedConnection<{ name: string }[]>`select name from schema_migrations`
    const appliedNames = new Set(applied.map((migration) => migration.name))

    // Migrations are ordered and each must commit before the next begins.
    // oxlint-disable no-await-in-loop
    for (const migration of migrationsToApply) {
      if (appliedNames.has(migration.name)) continue
      assertTransactionalMigration(migration)

      await reservedConnection`begin`
      try {
        await reservedConnection.unsafe(migration.sql).simple()
        await reservedConnection`insert into schema_migrations (name) values (${migration.name})`
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
        await reservedConnection`select set_config('lock_timeout', '0', false)`
      } finally {
        reservedConnection.release()
      }
    }
  }
}
