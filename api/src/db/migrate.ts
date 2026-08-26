import { sql } from './client.js'
import { runStartupMigrations } from './startup-migrations.js'

runStartupMigrations(sql)
  .then(() => sql.end())
  .catch(async (error) => {
    console.error('Database migration failed', error)
    await sql.end({ timeout: 1 })
    process.exitCode = 1
  })
