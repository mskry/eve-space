import { maskSqlLiteralsAndComments } from './sql-validation.js'

export interface Migration {
  name: string
  sql: string
}

interface TransactionalMigrationValidationOptions {
  readonly rejectUnterminated?: boolean
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
export function assertTransactionalMigration(
  migration: Migration,
  options: TransactionalMigrationValidationOptions = {},
) {
  const statement = maskSqlLiteralsAndComments(migration.sql, {
    rejectUnterminated: options.rejectUnterminated,
  })
  const unsupported = nonTransactionalStatements.find(({ pattern }) => pattern.test(statement))

  if (unsupported) {
    throw new Error(
      `Migration ${migration.name} contains a statement that cannot run in a transaction: ${unsupported.name}`,
    )
  }
}
