import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { loadMigrations, runMigrations } from '../../../src/db/migration-runner.js'
import {
  loadStaticLocationSnapshot,
  readStaticLocationRevision,
  staticLocationDatabaseTimeoutMilliseconds,
} from '../../../src/universe/static-location-store.js'

let container: StartedTestContainer
let connection: postgres.Sql
let databaseUrl: string

beforeAll(async () => {
  const password = randomUUID()
  container = await new GenericContainer('postgres:17-alpine')
    .withEnvironment({
      POSTGRES_DB: 'eve_space',
      POSTGRES_USER: 'eve_space',
      POSTGRES_PASSWORD: password,
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start()
  databaseUrl = `postgres://eve_space:${password}@${container.getHost()}:${container.getMappedPort(5432)}/eve_space`
  connection = postgres(databaseUrl, { onnotice: () => {} })
  await runMigrations(connection, await loadMigrations())
})

beforeEach(async () => {
  await connection`truncate sde_npc_stations, sde_solar_systems, sde_builds`
  await connection`
    insert into sde_builds (build_number, release_date, ingested_at, ingest_version)
    values (1234, '2026-08-26 11:00:00+00', '2026-08-26 12:00:00.123456+00', 2)
  `
  await connection`
    insert into sde_solar_systems (solar_system_id, name, security_status)
    values
      (30000001, 'Negative', -0.06),
      (30000002, 'Zero', 0),
      (30000003, 'Precise', 0.945913)
  `
  await connection`
    insert into sde_npc_stations (station_id, solar_system_id)
    values (60000001, 30000001), (60000002, 30000002), (60000003, 30000003)
  `
})

afterAll(async () => {
  await connection?.end()
  await container?.stop()
})

describe('static location snapshot store', () => {
  test('distinguishes same-build revisions and preserves timestamp precision', async () => {
    const first = await readStaticLocationRevision(connection)
    expect(first).toEqual({
      buildNumber: 1234,
      ingestVersion: 2,
      ingestedAt: '2026-08-26 12:00:00.123456+00',
    })

    await connection`
      update sde_builds
      set ingest_version = 3, ingested_at = '2026-08-26 12:00:00.654321+00'
      where build_number = 1234
    `

    expect(await readStaticLocationRevision(connection)).toEqual({
      buildNumber: 1234,
      ingestVersion: 3,
      ingestedAt: '2026-08-26 12:00:00.654321+00',
    })
  })

  test('loads one validated snapshot with exact security values', async () => {
    const snapshot = await loadStaticLocationSnapshot(connection)

    expect([...snapshot.systems.values()]).toEqual([
      { id: 30000001, name: 'Negative', securityStatus: -0.06 },
      { id: 30000002, name: 'Zero', securityStatus: 0 },
      { id: 30000003, name: 'Precise', securityStatus: 0.945913 },
    ])
    expect([...snapshot.stationSystemIds]).toEqual([
      [60000001, 30000001],
      [60000002, 30000002],
      [60000003, 30000003],
    ])
  })

  test('waits for an overlapping ingestion and returns its complete committed revision', async () => {
    const locked = deferred<void>()
    const release = deferred<void>()
    const ingestion = connection.begin(async (transaction) => {
      await transaction`
        lock table sde_builds, sde_solar_systems, sde_npc_stations in access exclusive mode
      `
      await transaction`truncate sde_npc_stations, sde_solar_systems`
      await transaction`
        insert into sde_solar_systems (solar_system_id, name, security_status)
        values (30000142, 'Jita', 0.945913)
      `
      await transaction`
        insert into sde_npc_stations (station_id, solar_system_id)
        values (60003760, 30000142)
      `
      await transaction`
        update sde_builds
        set ingest_version = 3, ingested_at = '2026-08-26 12:01:00.000001+00'
        where build_number = 1234
      `
      locked.resolve()
      await release.promise
    })
    await locked.promise

    let settled = false
    const loading = loadStaticLocationSnapshot(connection).finally(() => {
      settled = true
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(settled).toBe(false)

    release.resolve()
    await ingestion
    const snapshot = await loading
    expect(snapshot.revision).toEqual({
      buildNumber: 1234,
      ingestVersion: 3,
      ingestedAt: '2026-08-26 12:01:00.000001+00',
    })
    expect([...snapshot.systems.values()]).toEqual([
      { id: 30000142, name: 'Jita', securityStatus: 0.945913 },
    ])
    expect([...snapshot.stationSystemIds]).toEqual([[60003760, 30000142]])
  })

  test('rejects missing and invalid projections', async () => {
    await connection`truncate sde_npc_stations`
    await expect(loadStaticLocationSnapshot(connection)).rejects.toThrow('projection is incomplete')

    await connection`
      insert into sde_npc_stations (station_id, solar_system_id)
      values (60000001, 30000001)
    `
    await connection`update sde_solar_systems set name = '' where solar_system_id = 30000001`
    await expect(loadStaticLocationSnapshot(connection)).rejects.toThrow(
      'solar system name is invalid',
    )

    await connection`delete from sde_builds`
    await expect(loadStaticLocationSnapshot(connection)).rejects.toThrow(
      'Static location revision is missing',
    )
  })

  test('times out lock waits, rolls back, and releases its pool connection', async () => {
    const singleConnection = postgres(databaseUrl, { max: 1, onnotice: () => {} })
    const locked = deferred<void>()
    const release = deferred<void>()
    const lock = connection.begin(async (transaction) => {
      await transaction`lock table sde_builds in access exclusive mode`
      locked.resolve()
      await release.promise
    })
    await locked.promise

    const startedAt = Date.now()
    await expect(readStaticLocationRevision(singleConnection)).rejects.toMatchObject({
      code: expect.stringMatching(/^(55P03|57014)$/),
    })
    expect(Date.now() - startedAt).toBeLessThan(staticLocationDatabaseTimeoutMilliseconds + 2_000)

    release.resolve()
    await lock
    await expect(singleConnection`select 1 as value`).resolves.toMatchObject([{ value: 1 }])
    await singleConnection.end()
  })
})

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
