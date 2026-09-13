import { sql } from './client.js'
import { runStartupMigrations } from './startup-migrations.js'
import { recordDiagnostic } from '../logging.js'

try {
  await runStartupMigrations(sql)
  await sql.end()
} catch (error) {
  recordDiagnostic('database.migration.failed', { error })
  process.exitCode = 1
  await sql.end({ timeout: 1 }).catch((cleanupError) => {
    recordDiagnostic('database.migration.failed', { error: cleanupError })
  })
}
