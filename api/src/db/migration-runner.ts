import type postgres from 'postgres'
import { migrationLockId } from './locks.js'
import { assertCoreMigrationHistory, type CoreMigrationHistoryRow } from './migration-history.js'
import {
  activeCoreMigrationManifest,
  loadCoreMigrations,
  migrationSha256,
  type LoadedCoreMigration,
} from './migration-manifest.js'
import { assertTransactionalMigration, type Migration } from './migration-validation.js'

const migrationLockTimeoutMs = 30_000
const coreMigrationOwner = 'core'

export interface MigrationRunOptions {
  lockTimeoutMs?: number
}

export async function loadMigrations(): Promise<LoadedCoreMigration[]> {
  return loadCoreMigrations()
}

export async function runMigrations(
  connection: postgres.Sql,
  migrations?: Migration[],
  { lockTimeoutMs = migrationLockTimeoutMs }: MigrationRunOptions = {},
) {
  const usesCanonicalManifest = migrations === undefined
  const migrationsToApply = migrations ?? (await loadMigrations())

  const reservedConnection = await connection.reserve()
  const [session] = await reservedConnection<{ lock_timeout: string }[]>`
    select current_setting('lock_timeout') as lock_timeout
  `
  const restoreLockTimeout = session?.lock_timeout ?? '0'
  const lockTimeout = `${lockTimeoutMs}ms`
  try {
    await reservedConnection`select set_config('lock_timeout', ${lockTimeout}, false)`
    await reservedConnection`select pg_advisory_lock(${migrationLockId})`
    await reservedConnection`
      create table if not exists schema_migrations (
        module text not null default 'core',
        name text not null,
        content_sha256 text,
        applied_at timestamptz not null default now(),
        constraint schema_migrations_pkey primary key (module, name),
        constraint schema_migrations_content_sha256_check
          check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$')
      )
    `

    if (!(await hasContentIdentityColumn(reservedConnection)))
      throw new Error('Unsupported core migration history (missing content identity storage)')
    const applied = await readCoreMigrationHistory(reservedConnection)
    if (usesCanonicalManifest) {
      assertCoreMigrationHistory(applied, activeCoreMigrationManifest)
    } else {
      assertProvidedMigrationIdentities(applied, migrationsToApply)
    }
    const appliedNames = new Set(applied.map((migration) => migration.name))

    // Migrations are ordered and each must commit before the next begins.
    // oxlint-disable no-await-in-loop
    for (const migration of migrationsToApply) {
      if (appliedNames.has(migration.name)) continue
      assertTransactionalMigration(migration)

      await reservedConnection`begin`
      try {
        await reservedConnection.unsafe(migration.sql).simple()
        const contentSha256 = migrationIdentity(migration)
        await reservedConnection`
          insert into schema_migrations (module, name, content_sha256)
          values (${coreMigrationOwner}, ${migration.name}, ${contentSha256})
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

async function hasContentIdentityColumn(connection: postgres.ReservedSql) {
  const [column] = await connection<{ exists: boolean }[]>`
    select exists(
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'schema_migrations'
        and column_name = 'content_sha256'
    ) as exists
  `
  return column?.exists ?? false
}

async function readCoreMigrationHistory(
  connection: postgres.ReservedSql,
): Promise<CoreMigrationHistoryRow[]> {
  return connection<CoreMigrationHistoryRow[]>`
    select name, content_sha256 as "contentSha256"
    from schema_migrations
    where module = ${coreMigrationOwner}
  `
}

function assertProvidedMigrationIdentities(
  applied: readonly CoreMigrationHistoryRow[],
  migrations: readonly Migration[],
) {
  const appliedByName = new Map(applied.map((row) => [row.name, row]))
  for (const migration of migrations) {
    const row = appliedByName.get(migration.name)
    if (!row) continue
    if (row.contentSha256 !== migrationIdentity(migration))
      throw new Error(`Applied migration content identity mismatch: ${migration.name}`)
  }
}

function migrationIdentity(migration: Migration) {
  return 'sha256' in migration && typeof migration.sha256 === 'string'
    ? migration.sha256
    : migrationSha256(migration.sql)
}
