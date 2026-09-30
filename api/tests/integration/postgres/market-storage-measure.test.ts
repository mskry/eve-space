import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, expect, test } from 'vitest'

let container: StartedTestContainer
let connection: postgres.Sql

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
    { onnotice: () => {} },
  )
  const migration = await readFile(
    new URL(
      '../../../../features/market/server/migrations/market-001-initial.sql',
      import.meta.url,
    ),
    'utf8',
  )
  await connection.unsafe(
    `create schema eve_module_market; set search_path to eve_module_market; ${migration}`,
    [],
    {
      prepare: false,
    },
  )
})

afterAll(async () => {
  await connection?.end()
  await container?.stop()
})

test('measures order-row and index growth for a representative regional page', async () => {
  const profileId = randomUUID()
  const observationId = randomUUID()
  await connection`
    insert into eve_module_market.market_profiles (profile_id, region_id, mode, last_request_id)
    values (${profileId}, 10000002, 'region', ${randomUUID()})
  `
  await connection`
    insert into eve_module_market.market_observations (
      observation_id, profile_id, profile_revision, market_key,
      region_id, expected_pages, status, started_at
    ) values (
      ${observationId}, ${profileId}, 1, 'region:10000002',
      10000002, 1, 'staging', '2026-09-28T12:00:00Z'
    )
  `
  const [before] = await connection<{ bytes: string }[]>`
    select pg_total_relation_size('eve_module_market.market_observation_orders')::text as bytes
  `
  await connection`
    insert into eve_module_market.market_observation_orders (
      observation_id, order_id, type_id, location_id, system_id,
      side, price, volume_remain, issued_at, duration_days,
      minimum_volume, order_range
    )
    select ${observationId}::uuid, series, 34, 60003760, 30000142,
           case when series % 2 = 0 then 'buy' else 'sell' end,
           6.42 + (series % 100)::numeric / 100,
           1000000 + series, '2026-09-27T12:00:00Z'::timestamptz,
           90, 1, 'station'
    from generate_series(1, 1000) as series
  `
  const [after] = await connection<{ bytes: string }[]>`
    select pg_total_relation_size('eve_module_market.market_observation_orders')::text as bytes
  `
  const growth = Number(after!.bytes) - Number(before!.bytes)
  const bytesPerOrder = growth / 1000
  expect(bytesPerOrder).toBeGreaterThan(0)
  expect(bytesPerOrder).toBeLessThan(512)
  console.info('Market order-row and index growth:', { orders: 1000, growth, bytesPerOrder })
})
