import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { runMigrations } from '../../../src/db/migration-runner.js'

let container: StartedTestContainer
let connection: postgres.Sql
let getStaticLocations: typeof import('../../../src/universe/static-locations.js').getStaticLocations
let resetStaticLocationCacheForTests: typeof import('../../../src/universe/static-locations.js').resetStaticLocationCacheForTests
const queries: string[] = []

beforeAll(async () => {
  const password = randomUUID()
  container = await new GenericContainer('postgres:17-alpine')
    .withEnvironment({
      POSTGRES_DB: 'eve_space',
      POSTGRES_PASSWORD: password,
      POSTGRES_USER: 'eve_space',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start()
  connection = postgres(
    `postgres://eve_space:${password}@${container.getHost()}:${container.getMappedPort(5432)}/eve_space`,
    { debug: (_, query) => queries.push(query), onnotice: () => {} },
  )
  await runMigrations(connection)
  await connection`insert into sde_builds (build_number, release_date, ingest_version) values (1234, now(), 2)`
  await connection`update sde_projection_state set active_build_number = 1234`
  await connection`insert into sde_dataset_rows (dataset, key, data) values ('npcStations', '60003760', '{"_key":60003760,"solarSystemID":30000142}')`
  await connection`insert into sde_solar_systems (solar_system_id, name, security_status)
    select 30000000 + n, 'System ' || n, case when n = 1 then -0.06 when n = 2 then 0 else 0.945913 end from generate_series(1, 300) n`
  await connection`insert into sde_npc_stations (station_id, solar_system_id)
    select 60000000 + n, 30000000 + n from generate_series(1, 300) n`
  vi.doMock('../../../src/db/client.js', () => ({
    sql: connection,
  }))
  ;({ getStaticLocations, resetStaticLocationCacheForTests } =
    await import('../../../src/universe/static-locations.js'))
})

beforeEach(() => {
  resetStaticLocationCacheForTests?.()
})

afterAll(async () => {
  vi.doUnmock('../../../src/db/client.js')
  await connection?.end()
  await container?.stop()
})

describe('SDE location projection', () => {
  test('keeps raw SDE data available alongside the location projection', async () => {
    expect([
      ...(await connection`select ingest_version from sde_builds where build_number = 1234`),
    ]).toStrictEqual([{ ingest_version: 2 }])
    expect([
      ...(await connection`select key from sde_dataset_rows where dataset = 'npcStations'`),
    ]).toStrictEqual([{ key: '60003760' }])
  })

  test('resolves hundreds of stations and direct systems, then serves them without database work', async () => {
    const locations = Array.from({ length: 300 }, (_, index) => [
      { id: 60_000_001 + index, type: 'station' as const },
      { id: 30_000_001 + index, type: 'solar_system' as const },
    ]).flat()
    queries.length = 0
    const result = await getStaticLocations(locations)
    const initializationQueries = queries.length
    expect(initializationQueries).toBeGreaterThan(0)
    expect(result).toHaveLength(600)
    expect(result.every((location) => location.solarSystemSecurityStatus !== null)).toBe(true)
    expect(result).toStrictEqual(
      expect.arrayContaining([
        {
          id: 60_000_001,
          name: null,
          solarSystemId: 30_000_001,
          solarSystemSecurityStatus: -0.06,
          type: 'station',
        },
        {
          id: 30_000_001,
          name: 'System 1',
          solarSystemId: 30_000_001,
          solarSystemSecurityStatus: -0.06,
          type: 'solar_system',
        },
        {
          id: 60_000_002,
          name: null,
          solarSystemId: 30_000_002,
          solarSystemSecurityStatus: 0,
          type: 'station',
        },
        {
          id: 30_000_003,
          name: 'System 3',
          solarSystemId: 30_000_003,
          solarSystemSecurityStatus: 0.945913,
          type: 'solar_system',
        },
      ]),
    )
    await expect(getStaticLocations(locations)).resolves.toStrictEqual(result)
    expect(queries).toHaveLength(initializationQueries)
  })

  test('keeps missing and mismatched locations unresolved', async () => {
    const locations = [
      { id: 30_000_001, type: 'station' as const },
      { id: 60_000_001, type: 'solar_system' as const },
      { id: 1_035_466_617_946, type: 'station' as const },
    ]
    expect(await getStaticLocations(locations)).toStrictEqual(
      locations.map((location) => ({
        id: location.id,
        name: null,
        solarSystemId: null,
        solarSystemSecurityStatus: null,
        type: location.type,
      })),
    )
    queries.length = 0
    expect(await getStaticLocations([])).toStrictEqual([])
    expect(queries).toHaveLength(0)
  })

  test('rolls back a failed location reload without losing the previous projection', async () => {
    await expect(
      connection.begin(async (transaction) => {
        await transaction`truncate sde_npc_stations, sde_solar_systems`
        await transaction`insert into sde_solar_systems values (30000001, 'Invalid', 2)`
      }),
    ).rejects.toMatchObject({ code: '23514' })
    expect(await getStaticLocations([{ id: 60_000_001, type: 'station' }])).toStrictEqual([
      {
        id: 60_000_001,
        name: null,
        solarSystemId: 30_000_001,
        solarSystemSecurityStatus: -0.06,
        type: 'station',
      },
    ])
  })
})
