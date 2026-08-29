import { sql } from './client.js'
import { runStartupMigrations } from './startup-migrations.js'

try {
  await runStartupMigrations(sql)
  await sql.end()
} catch (error) {
  console.error('Database migration failed', error)
  await sql.end({ timeout: 1 })
  process.exitCode = 1
}
