import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type postgres from 'postgres'

const migrationsDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url))
const migrationLockId = 410024413

export interface Migration {
  name: string
  sql: string
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

export async function runMigrations(connection: postgres.Sql, migrations?: Migration[]) {
  const migrationsToApply = migrations ?? (await loadMigrations())
  for (const migration of migrationsToApply) assertTransactionalMigration(migration)

  const reservedConnection = await connection.reserve()
  try {
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
      reservedConnection.release()
    }
  }
}

export function assertTransactionalMigration(migration: Migration) {
  const statement = stripSqlLiteralsAndComments(migration.sql)
  const unsupported = nonTransactionalStatements.find(({ pattern }) => pattern.test(statement))

  if (unsupported) {
    throw new Error(
      `Migration ${migration.name} contains a statement that cannot run in a transaction: ${unsupported.name}`,
    )
  }
}

const nonTransactionalStatements = [
  { name: 'ALTER SYSTEM', pattern: /\balter\s+system\b/i },
  { name: 'transaction control', pattern: /\b(?:begin|commit|rollback)\b/i },
  { name: 'CREATE or DROP DATABASE', pattern: /\b(?:create|drop)\s+database\b/i },
  {
    name: 'CREATE UNIQUE INDEX CONCURRENTLY or DROP INDEX CONCURRENTLY',
    pattern: /\b(?:create\s+(?:unique\s+)?index|drop\s+index)\s+concurrently\b/i,
  },
  { name: 'CREATE or DROP TABLESPACE', pattern: /\b(?:create|drop)\s+tablespace\b/i },
  { name: 'CREATE or DROP SUBSCRIPTION', pattern: /\b(?:create|drop)\s+subscription\b/i },
  { name: 'CLUSTER', pattern: /\bcluster\b/i },
  { name: 'REINDEX CONCURRENTLY', pattern: /\breindex(?:\s+\w+)?\s+concurrently\b/i },
  {
    name: 'REFRESH MATERIALIZED VIEW CONCURRENTLY',
    pattern: /\brefresh\s+materialized\s+view\s+concurrently\b/i,
  },
  { name: 'VACUUM', pattern: /\bvacuum\b/i },
]

function stripSqlLiteralsAndComments(sql: string) {
  let result = ''
  let index = 0

  while (index < sql.length) {
    const skipped = skipNonExecutableSql(sql, index)
    if (skipped !== undefined) {
      result += ' '
      index = skipped
      continue
    }

    result += sql[index]
    index += 1
  }

  return result
}

function skipNonExecutableSql(sql: string, index: number) {
  return (
    skipLineComment(sql, index) ??
    skipBlockComment(sql, index) ??
    skipQuotedLiteral(sql, index) ??
    skipDollarQuotedLiteral(sql, index)
  )
}

function skipLineComment(sql: string, index: number) {
  if (!sql.startsWith('--', index)) return undefined
  const end = sql.indexOf('\n', index + 2)
  return end === -1 ? sql.length : end
}

function skipBlockComment(sql: string, index: number) {
  if (!sql.startsWith('/*', index)) return undefined
  const end = sql.indexOf('*/', index + 2)
  return end === -1 ? sql.length : end + 2
}

function skipQuotedLiteral(sql: string, index: number) {
  const quote = sql[index]
  if (quote !== "'" && quote !== '"') return undefined

  index += 1
  while (index < sql.length) {
    if (sql[index] === quote && sql[index + 1] === quote) {
      index += 2
      continue
    }
    if (sql[index] === quote) return index + 1
    index += 1
  }

  return index
}

function skipDollarQuotedLiteral(sql: string, index: number) {
  if (sql[index] !== '$') return undefined

  const delimiter = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0]
  if (!delimiter) return undefined

  const end = sql.indexOf(delimiter, index + delimiter.length)
  return end === -1 ? sql.length : end + delimiter.length
}
