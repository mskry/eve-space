import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { loadMigrations, runMigrations } from '../../../src/db/migration-runner.js'

let container: StartedTestContainer
let connection: postgres.Sql
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
    ({ name }) => name === '022_character_finance_navigation.sql',
  )
  if (migrationIndex < 0) throw new Error('Character Finance navigation migration is missing')

  await runMigrations(connection, migrations.slice(0, migrationIndex))
  await connection`
    insert into deployment_shell_navigation_order (
      owner_id,
      navigation_id,
      position,
      created_at,
      updated_at
    ) values
      ('core', 'core-character-wallet', 2, '2026-08-30T10:00:00Z', '2026-08-30T11:00:00Z'),
      ('core', 'core-character-finance', 8, '2026-08-31T10:00:00Z', '2026-08-31T11:00:00Z')
  `
  await runMigrations(connection, [migrations[migrationIndex]!])
})

afterAll(async () => {
  await connection?.end()
  await container?.stop()
})

describe('character Finance navigation migration', () => {
  test('replaces a conflicting Finance row and retains the customized Wallet position', async () => {
    const rows = await connection<
      { navigation_id: string; position: number; created_at: Date; updated_at: Date }[]
    >`
      select navigation_id, position, created_at, updated_at
      from deployment_shell_navigation_order
      where owner_id = 'core'
        and navigation_id in ('core-character-wallet', 'core-character-finance')
    `

    expect(rows).toEqual([
      {
        navigation_id: 'core-character-finance',
        position: 2,
        created_at: new Date('2026-08-30T10:00:00Z'),
        updated_at: new Date('2026-08-30T11:00:00Z'),
      },
    ])
  })
})

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
