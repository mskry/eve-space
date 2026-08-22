import { sql } from './db/client.js'

export const expectedWorkerMigration = '007_token_version.sql'

export class WorkerSchemaNotReadyError extends Error {
  constructor() {
    super(`Worker requires migration ${expectedWorkerMigration}`)
  }
}

export async function checkWorkerReadiness(connection = sql) {
  try {
    const [table] = await connection<{ exists: boolean }[]>`
      select exists(
        select 1 from information_schema.tables
        where table_schema = current_schema() and table_name = 'schema_migrations'
      ) as exists
    `
    if (!table?.exists) {
      return { healthy: false as const, reason: `Missing migration ${expectedWorkerMigration}` }
    }

    const [result] = await connection<{ applied: boolean }[]>`
      select exists(
        select 1 from schema_migrations where name = ${expectedWorkerMigration}
      ) as applied
    `

    if (result?.applied) return { healthy: true as const }
    return { healthy: false as const, reason: `Missing migration ${expectedWorkerMigration}` }
  } catch {
    return { healthy: false as const, reason: 'Database unavailable' }
  }
}

export async function assertWorkerReadiness(connection = sql) {
  const readiness = await checkWorkerReadiness(connection)
  if (!readiness.healthy) throw new WorkerSchemaNotReadyError()
}
