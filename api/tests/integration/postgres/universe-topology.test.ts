import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { loadMigrations, runMigrations } from '../../../src/db/migration-runner.js'
import { loadUniverseTopologySnapshot } from '../../../src/universe/topology-store.js'

let container: StartedTestContainer
let connection: postgres.Sql

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
  connection = postgres(
    `postgres://eve_space:${password}@${container.getHost()}:${container.getMappedPort(5432)}/eve_space`,
    { onnotice: () => {} },
  )
  await runMigrations(connection, await loadMigrations())
  await connection`
    insert into sde_builds (build_number, release_date, ingest_version, ingested_at)
    values (1234, now(), 4, '2026-08-26 12:00:00.123456+00')
  `
  await connection`
    insert into sde_dataset_rows (dataset, key, data)
    values
      ('mapSolarSystems', '30000001', '{"_key":30000001,"securityStatus":0.9}'),
      ('mapSolarSystems', '30000002', '{"_key":30000002,"securityStatus":0.5}'),
      ('mapSolarSystems', '30000003', '{"_key":30000003,"securityStatus":-0.2}'),
      ('mapStargates', '50000001', '{"_key":50000001,"solarSystemID":30000001,"destination":{"solarSystemID":30000002}}'),
      ('mapStargates', '50000002', '{"_key":50000002,"solarSystemID":30000002,"destination":{"solarSystemID":30000001}}')
  `
})

afterAll(async () => {
  await connection?.end()
  await container?.stop()
})

describe('universe topology PostgreSQL projection', () => {
  test('loads one completed-build graph with disconnected systems intact', async () => {
    const snapshot = await loadUniverseTopologySnapshot(connection)

    expect(snapshot.revision).toEqual({
      buildNumber: 1234,
      ingestVersion: 4,
      ingestedAt: '2026-08-26 12:00:00.123456+00',
    })
    expect([...snapshot.systems.values()]).toEqual([
      { id: 30_000_001, securityStatus: 0.9, neighbors: [30_000_002] },
      { id: 30_000_002, securityStatus: 0.5, neighbors: [30_000_001] },
      { id: 30_000_003, securityStatus: -0.2, neighbors: [] },
    ])
  })
})
