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
    ({ name }) => name === '023_character_clones_navigation.sql',
  )
  if (migrationIndex < 0) throw new Error('Character Clones navigation migration is missing')
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

describe('character Clones navigation migration', () => {
  test('leaves deployments without a saved Skills order on generated defaults', async () => {
    await applyMigration()

    const rows = await loadRows()
    expect(rows).toEqual([])
  })

  test('inserts Clones after Skills while preserving custom relative order', async () => {
    await connection`
      insert into deployment_shell_navigation_order (owner_id, navigation_id, position) values
        ('core', 'core-character-overview', 0),
        ('core', 'core-character-skills', 3),
        ('alpha', 'alpha-custom-character', 4),
        ('core', 'core-character-mail', 8)
    `

    await applyMigration()

    expect(await loadRows()).toEqual([
      { owner_id: 'core', navigation_id: 'core-character-overview', position: 0 },
      { owner_id: 'core', navigation_id: 'core-character-skills', position: 3 },
      { owner_id: 'core', navigation_id: 'core-character-clones', position: 4 },
      { owner_id: 'alpha', navigation_id: 'alpha-custom-character', position: 5 },
      { owner_id: 'core', navigation_id: 'core-character-mail', position: 9 },
    ])
  })

  test('is idempotent and skips orders that already contain Clones', async () => {
    await connection`
      insert into deployment_shell_navigation_order (owner_id, navigation_id, position) values
        ('core', 'core-character-skills', 2),
        ('core', 'core-character-finance', 3)
    `

    await applyMigration()
    await applyMigration()

    expect(await loadRows()).toEqual([
      { owner_id: 'core', navigation_id: 'core-character-skills', position: 2 },
      { owner_id: 'core', navigation_id: 'core-character-clones', position: 3 },
      { owner_id: 'core', navigation_id: 'core-character-finance', position: 4 },
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
