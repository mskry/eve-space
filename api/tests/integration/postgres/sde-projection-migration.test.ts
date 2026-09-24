import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { runMigrations } from '../../../src/db/migration-runner.js'

let container: StartedTestContainer
let connection: postgres.Sql
const databasePassword = randomUUID()
const buildNumber = 1234
const ingestVersion = 2

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
  const databaseUrl = `postgres://eve_space:${databasePassword}@${container.getHost()}:${container.getMappedPort(5432)}/eve_space`
  connection = postgres(databaseUrl, { onnotice: () => {} })
  await waitForDatabase()

  await runMigrations(connection)
  await connection`
    insert into sde_types (type_id, group_id, name, published)
    values (3300, 255, 'Gunnery', true)
  `
  await connection`
    insert into sde_builds (build_number, release_date, ingested_at)
    values (${buildNumber}, '2026-01-01T11:00:00Z', '2026-01-01T12:00:00Z')
  `
  await connection`
    update sde_projection_state set active_build_number = ${buildNumber}
  `
})

afterAll(async () => {
  await connection?.end()
  await container?.stop()
})

describe('SDE projection migrations', () => {
  test('supports nullable type descriptions and a versioned same-build reload', async () => {
    const [type] = await connection<{ description: string | null; name: string }[]>`
      select name, description from sde_types where type_id = 3300
    `
    const [initialBuild] = await connection<
      { build_number: string; ingest_version: number; ingested_at: Date }[]
    >`
      select build_number, ingest_version, ingested_at
      from sde_builds
      where build_number = ${buildNumber}
    `
    const [projectionState] = await connection<
      { singleton: boolean; active_build_number: string | null }[]
    >`
      select singleton, active_build_number::text as active_build_number
      from sde_projection_state
    `

    expect(type).toStrictEqual({ description: null, name: 'Gunnery' })
    expect(initialBuild).toMatchObject({ build_number: String(buildNumber), ingest_version: 1 })
    expect(projectionState).toStrictEqual({
      active_build_number: String(buildNumber),
      singleton: true,
    })
    expect(needsReload(initialBuild)).toBe(true)

    await connection`
      insert into sde_builds (build_number, release_date, ingest_version)
      values (${buildNumber}, '2026-01-01T11:00:00Z', ${ingestVersion})
      on conflict (build_number) do update set
        release_date = excluded.release_date,
        ingest_version = excluded.ingest_version,
        ingested_at = now()
    `

    const [completedBuild] = await connection<
      { build_number: string; ingest_version: number; ingested_at: Date }[]
    >`
      select build_number, ingest_version, ingested_at
      from sde_builds
      where build_number = ${buildNumber}
    `
    expect(needsReload(completedBuild)).toBe(false)
    expect(completedBuild?.ingested_at.getTime()).toBeGreaterThan(
      initialBuild!.ingested_at.getTime(),
    )
  })
})

function needsReload(build: { build_number: string; ingest_version: number } | undefined) {
  return build?.build_number !== String(buildNumber) || build.ingest_version !== ingestVersion
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
