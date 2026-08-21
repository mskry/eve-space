import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { sql } from './client.js'

const migrationsDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url))

async function migrate() {
  await sql`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `

  const applied = await sql<{ name: string }[]>`select name from schema_migrations`
  const appliedNames = new Set(applied.map((migration) => migration.name))
  const files = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith('.sql'))
    .toSorted()

  for (const file of files) {
    if (appliedNames.has(file)) continue

    const migration = await readFile(`${migrationsDirectory}/${file}`, 'utf8')

    await sql.begin(async (transaction) => {
      await transaction.unsafe(migration).simple()
      await transaction`insert into schema_migrations (name) values (${file})`
    })

    console.log(`Applied migration ${file}`)
  }
}

migrate()
  .then(() => sql.end())
  .catch(async (error) => {
    console.error('Database migration failed', error)
    await sql.end({ timeout: 1 })
    process.exitCode = 1
  })
