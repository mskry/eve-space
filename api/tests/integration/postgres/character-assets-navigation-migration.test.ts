import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { loadMigrations, runMigrations } from '../../../src/db/migration-runner.js'

let container: StartedTestContainer
let connection: postgres.Sql
let migrationSql: string
const databasePassword = randomUUID()

beforeAll(async () => {
  container = await new GenericContainer('postgres:17-alpine')
    .withEnvironment({
      POSTGRES_DB: 'eve_space',
      POSTGRES_PASSWORD: databasePassword,
      POSTGRES_USER: 'eve_space',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/))
    .start()
  connection = postgres(
    `postgres://eve_space:${databasePassword}@${container.getHost()}:${container.getMappedPort(5432)}/eve_space`,
    { onnotice: () => {} },
  )
  await waitForDatabase()

  const migrations = await loadMigrations()
  const migrationIndex = migrations.findIndex(
    ({ name }) => name === '024_character_assets_navigation.sql',
  )
  if (migrationIndex < 0) throw new Error('Character Assets navigation migration is missing')
  await runMigrations(connection, migrations.slice(0, migrationIndex))
  migrationSql = migrations[migrationIndex]!.sql
})

beforeEach(async () => {
  await connection`truncate deployment_shell_navigation_order`
})

afterAll(async () => {
  await connection?.end()
  await container?.stop()
})

describe('character Assets navigation migration', () => {
  test('leaves deployments without a saved Finance order on generated defaults', async () => {
    await applyMigration()
    await applyMigration()

    expect(await loadRows()).toEqual([])
  })

  test('inserts Assets after Finance while preserving custom relative order', async () => {
    await connection`
      insert into deployment_shell_navigation_order (owner_id, navigation_id, position) values
        ('core', 'core-character-skills', 0),
        ('core', 'core-character-finance', 2),
        ('alpha', 'alpha-custom-character', 3),
        ('core', 'core-character-history', 7),
        ('core', 'core-character-mail', 9)
    `

    await applyMigration()
    await applyMigration()

    expect(await loadRows()).toEqual([
      { owner_id: 'core', navigation_id: 'core-character-skills', position: 0 },
      { owner_id: 'core', navigation_id: 'core-character-finance', position: 2 },
      { owner_id: 'core', navigation_id: 'core-character-assets', position: 3 },
      { owner_id: 'alpha', navigation_id: 'alpha-custom-character', position: 4 },
      { owner_id: 'core', navigation_id: 'core-character-history', position: 8 },
      { owner_id: 'core', navigation_id: 'core-character-mail', position: 10 },
    ])
  })

  test('leaves orders that already contain Assets unchanged', async () => {
    await connection`
      insert into deployment_shell_navigation_order (owner_id, navigation_id, position) values
        ('core', 'core-character-finance', 1),
        ('core', 'core-character-assets', 4),
        ('core', 'core-character-history', 5)
    `

    await applyMigration()

    expect(await loadRows()).toEqual([
      { owner_id: 'core', navigation_id: 'core-character-finance', position: 1 },
      { owner_id: 'core', navigation_id: 'core-character-assets', position: 4 },
      { owner_id: 'core', navigation_id: 'core-character-history', position: 5 },
    ])
  })
})

function applyMigration() {
  return connection.unsafe(migrationSql).simple()
}

function loadRows() {
  return connection<{ owner_id: string; navigation_id: string; position: number }[]>`
    select owner_id, navigation_id, position
    from deployment_shell_navigation_order
    order by position, owner_id, navigation_id
  `
}

async function waitForDatabase() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await connection`select 1`
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw new Error('PostgreSQL test container did not become ready')
}
