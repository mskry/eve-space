import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { loadMarketCatalogueProduct } from '../../../src/core-data/market-catalogue-adapter.js'
import { loadMarketStationRegionsProduct } from '../../../src/core-data/market-station-regions-adapter.js'
import { loadStaticLocationLabelsProduct } from '../../../src/core-data/static-location-labels-adapter.js'
import { runMigrations } from '../../../src/db/migration-runner.js'

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
  await runMigrations(connection)
})

beforeEach(async () => {
  await connection`update sde_projection_state set active_build_number = null`
  await connection`truncate sde_npc_stations, sde_solar_systems`
  await connection`truncate sde_dataset_rows`
  await connection`truncate sde_types, sde_groups, sde_market_groups`
  await connection`delete from sde_builds`
  await connection`
    insert into sde_builds (build_number, release_date, ingest_version, ingested_at)
    values (3542233, '2026-09-24 11:00:00+00', 5, '2026-09-24 12:00:00.123456+00')
  `
  await connection`update sde_projection_state set active_build_number = 3542233`
  await connection`
    insert into sde_market_groups (market_group_id, name, icon_id)
    values (19, 'Trade Goods', null), (604, 'Micro', 86), (2332, 'Engineering Service Modules', 3007)
  `
  await connection`
    insert into sde_market_groups (market_group_id, parent_group_id, name, icon_id)
    values (614, 19, 'Criminal Evidence', 2302), (751, 614, 'Overseer Effects', null)
  `
  await connection`
    insert into sde_groups (group_id, category_id, name, published)
    values (526, 1, 'Evidence', true), (1324, 1, 'Structure FLEX Service Module', false)
  `
  await connection`
    insert into sde_types (type_id, group_id, market_group_id, name, published)
    values
      (47450, 526, 614, 'Compressed Capsule Shell', true),
      (35912, 1324, 2332, 'Standup Cynosural Field Generator I', true),
      (12, 526, 614, 'Unpublished', false),
      (13, 526, null, 'Unassigned', true)
  `
})

describe('market station-region product', () => {
  test('requires a committed version-six projection before reporting station membership', async () => {
    await expect(
      loadMarketStationRegionsProduct({ stationIds: [60003760] }, connection),
    ).rejects.toThrow('projection is unavailable')

    await connection`update sde_builds set ingest_version = 6 where build_number = 3542233`
    await connection`
      insert into sde_solar_systems (solar_system_id, region_id, name, security_status)
      values (30000142, 10000002, 'Jita', 0.945913),
             (30000001, 10000001, 'Tanoo', 0.5)
    `
    await connection`
      insert into sde_npc_stations (station_id, solar_system_id)
      values (60003760, 30000142), (60000001, 30000001)
    `
    await expect(
      loadMarketStationRegionsProduct({ stationIds: [60000001, 60003760, 999] }, connection),
    ).resolves.toMatchObject({
      complete: true,
      revision: { ingestVersion: 6 },
      rows: [
        { stationId: 60000001, solarSystemId: 30000001, regionId: 10000001 },
        { stationId: 60003760, solarSystemId: 30000142, regionId: 10000002 },
      ],
    })
  })

  test('rejects malformed or over-bound requests and incomplete published region data', async () => {
    expect(() => loadMarketStationRegionsProduct({ stationIds: [0] }, connection)).toThrow(
      'positive safe integers',
    )
    expect(() =>
      loadMarketStationRegionsProduct(
        { stationIds: Array.from({ length: 101 }, (_, index) => index + 1) },
        connection,
      ),
    ).toThrow('cannot exceed 100 IDs')

    await connection`update sde_builds set ingest_version = 6 where build_number = 3542233`
    await connection`
      insert into sde_solar_systems (solar_system_id, name, security_status)
      values (30000142, 'Jita', 0.945913)
    `
    await connection`
      insert into sde_npc_stations (station_id, solar_system_id)
      values (60003760, 30000142)
    `
    await expect(
      loadMarketStationRegionsProduct({ stationIds: [60003760] }, connection),
    ).rejects.toThrow('market region ID is invalid')
  })
})

test('projects exact NPC station names and solar-system security from retained SDE rows', async () => {
  await connection`
    insert into sde_solar_systems (solar_system_id, region_id, name, security_status)
    values (30000142, 10000002, 'Jita', 0.945913)
  `
  await connection`
    insert into sde_npc_stations (station_id, solar_system_id)
    values (60003760, 30000142), (60003761, 30000142)
  `
  await connection`
    insert into sde_dataset_rows (dataset, key, data) values
      ('npcStations', '60003760', '{"orbitID":40009087,"ownerID":1000035,"operationID":14,"celestialIndex":4,"orbitIndex":4,"useOperationName":true}'::jsonb),
      ('mapMoons', '40009087', '{"_key":40009087}'::jsonb),
      ('npcCorporations', '1000035', '{"name":{"en":"Caldari Navy"}}'::jsonb),
      ('stationOperations', '14', '{"operationName":{"en":"Assembly Plant"}}'::jsonb)
  `
  await expect(
    loadStaticLocationLabelsProduct({ locationIds: [30000142, 60003760, 60003761] }, connection),
  ).resolves.toMatchObject({
    complete: true,
    rows: [
      { locationId: 30000142, name: 'Jita', solarSystemSecurityStatus: 0.945913 },
      {
        locationId: 60003760,
        name: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
        solarSystemName: 'Jita',
        solarSystemSecurityStatus: 0.945913,
      },
      {
        locationId: 60003761,
        name: 'Jita · NPC station 60003761',
        solarSystemSecurityStatus: 0.945913,
      },
    ],
  })
  await connection`
    insert into sde_solar_systems (solar_system_id, region_id, name, security_status)
    values (30000140, 10000002, 'Maurasi', 0.7)
  `
  await connection`
    insert into sde_npc_stations (station_id, solar_system_id)
    values (60003454, 30000140)
  `
  await connection`
    insert into sde_dataset_rows (dataset, key, data) values
      ('npcStations', '60003454', '{"orbitID":40008952,"ownerID":1000033,"operationID":40,"celestialIndex":8,"orbitIndex":14,"useOperationName":false}'::jsonb),
      ('mapMoons', '40008952', '{"_key":40008952}'::jsonb),
      ('npcCorporations', '1000033', '{"name":{"en":"Caldari Business Tribunal"}}'::jsonb)
  `
  await expect(
    loadStaticLocationLabelsProduct({ locationIds: [60003454] }, connection),
  ).resolves.toMatchObject({
    rows: [
      {
        name: 'Maurasi VIII - Moon 14 - Caldari Business Tribunal',
        solarSystemSecurityStatus: 0.7,
      },
    ],
  })
})

afterAll(async () => {
  await connection?.end()
  await container?.stop()
})

describe('market catalogue product', () => {
  test('returns one complete deterministic hierarchy with direct items and unpublished inventory groups', async () => {
    const tree = await loadMarketCatalogueProduct({ kind: 'tree' }, connection)
    expect(tree).toStrictEqual({
      kind: 'tree',
      complete: true,
      revision: {
        buildNumber: 3542233,
        ingestVersion: 5,
        ingestedAt: '2026-09-24 12:00:00.123456+00',
      },
      groups: [
        { id: 19, parentId: null, name: 'Trade Goods', iconId: null, directTypeCount: 0 },
        { id: 604, parentId: null, name: 'Micro', iconId: 86, directTypeCount: 0 },
        { id: 614, parentId: 19, name: 'Criminal Evidence', iconId: 2302, directTypeCount: 1 },
        { id: 751, parentId: 614, name: 'Overseer Effects', iconId: null, directTypeCount: 0 },
        {
          id: 2332,
          parentId: null,
          name: 'Engineering Service Modules',
          iconId: 3007,
          directTypeCount: 1,
        },
      ],
    })
    const page = await loadMarketCatalogueProduct({ kind: 'group-types', groupId: 614 }, connection)
    expect(page).toMatchObject({
      kind: 'group-types',
      groupId: 614,
      nextCursor: null,
      items: [{ id: 47450, groupId: 614, name: 'Compressed Capsule Shell' }],
    })
    const index = await loadMarketCatalogueProduct({ kind: 'search-index' }, connection)
    expect(index).toMatchObject({
      kind: 'search-index',
      complete: true,
      types: [
        { id: 35912, groupId: 2332, name: 'Standup Cynosural Field Generator I' },
        { id: 47450, groupId: 614, name: 'Compressed Capsule Shell' },
      ],
    })
    await expect(
      loadMarketCatalogueProduct({ kind: 'type-by-id', typeId: 35912 }, connection),
    ).resolves.toMatchObject({
      kind: 'type-by-id',
      complete: true,
      item: { id: 35912, groupId: 2332, name: 'Standup Cynosural Field Generator I' },
      revision: { ingestVersion: 5 },
    })
    await expect(
      loadMarketCatalogueProduct({ kind: 'type-by-id', typeId: 12 }, connection),
    ).resolves.toMatchObject({ kind: 'type-by-id', item: null })
    await expect(
      loadMarketCatalogueProduct({ kind: 'type-by-id', typeId: 13 }, connection),
    ).resolves.toMatchObject({ kind: 'type-by-id', item: null })
    expect(() => loadMarketCatalogueProduct({ kind: 'type-by-id', typeId: 0 }, connection)).toThrow(
      'Invalid market type ID',
    )
  })

  test('fails as a whole for a missing revision, parent, cycle, or assigned group', async () => {
    await connection`update sde_projection_state set active_build_number = null`
    await expect(loadMarketCatalogueProduct({ kind: 'tree' }, connection)).rejects.toThrow(
      'revision is missing',
    )
    await connection`update sde_projection_state set active_build_number = 3542233`

    await connection`update sde_market_groups set parent_group_id = 999 where market_group_id = 614`
    await expect(loadMarketCatalogueProduct({ kind: 'tree' }, connection)).rejects.toThrow(
      'missing parent',
    )
    await connection`update sde_market_groups set parent_group_id = 751 where market_group_id = 614`
    await expect(loadMarketCatalogueProduct({ kind: 'tree' }, connection)).rejects.toThrow(
      'parent cycle',
    )
    await connection`update sde_market_groups set parent_group_id = 19 where market_group_id = 614`
    await connection`update sde_types set market_group_id = 999 where type_id = 47450`
    await expect(loadMarketCatalogueProduct({ kind: 'tree' }, connection)).rejects.toThrow(
      'missing group',
    )
    await expect(loadMarketCatalogueProduct({ kind: 'search-index' }, connection)).rejects.toThrow(
      'missing group',
    )
  })

  test('does not report a pre-icon projection as a complete market catalogue', async () => {
    await connection`update sde_builds set ingest_version = 4 where build_number = 3542233`
    await expect(loadMarketCatalogueProduct({ kind: 'tree' }, connection)).rejects.toThrow(
      'projection is not published',
    )
  })

  test('fails instead of truncating when either bound is exceeded', async () => {
    await connection`
      insert into sde_market_groups (market_group_id, name)
      select id, 'Extra group' from generate_series(10000, 13995) as id
    `
    await expect(loadMarketCatalogueProduct({ kind: 'tree' }, connection)).rejects.toThrow(
      'group bound',
    )
    await connection`delete from sde_market_groups where market_group_id >= 10000`
    await connection`
      insert into sde_types (type_id, group_id, market_group_id, name, published)
      select id, 526, 614, 'Extra type', true from generate_series(100000, 132000) as id
    `
    await expect(loadMarketCatalogueProduct({ kind: 'tree' }, connection)).rejects.toThrow(
      'type bound',
    )
    await expect(loadMarketCatalogueProduct({ kind: 'search-index' }, connection)).rejects.toThrow(
      'type bound',
    )
  })

  test('waits for same-build replacement and never mixes the old body with its revision', async () => {
    let release!: () => void
    let locked!: () => void
    const lockAcquired = new Promise<void>((resolve) => {
      locked = resolve
    })
    const resume = new Promise<void>((resolve) => {
      release = resolve
    })
    const ingestion = connection.begin(async (transaction) => {
      await transaction`lock table sde_projection_state, sde_builds, sde_market_groups, sde_types in access exclusive mode`
      await transaction`truncate sde_types, sde_market_groups`
      await transaction`insert into sde_market_groups (market_group_id, name) values (900, 'New root')`
      await transaction`
        insert into sde_types (type_id, group_id, market_group_id, name, published)
        values (900, 526, 900, 'New item', true)
      `
      await transaction`
        update sde_builds set ingest_version = 6, ingested_at = '2026-09-24 12:01:00.654321+00'
        where build_number = 3542233
      `
      locked()
      await resume
    })
    await lockAcquired
    let settled = false
    const loading = loadMarketCatalogueProduct({ kind: 'tree' }, connection).finally(() => {
      settled = true
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(settled).toBe(false)
    release()
    await ingestion
    const result = await loading
    expect(result.revision).toMatchObject({ buildNumber: 3542233, ingestVersion: 6 })
    if (result.kind !== 'tree') throw new Error('Unexpected product result')
    expect(result.groups).toStrictEqual([
      { id: 900, parentId: null, name: 'New root', iconId: null, directTypeCount: 1 },
    ])
    const page = await loadMarketCatalogueProduct({ kind: 'group-types', groupId: 900 }, connection)
    expect(page).toMatchObject({ items: [{ id: 900, groupId: 900, name: 'New item' }] })
  })

  test('pages only direct published items with a stable cursor', async () => {
    await connection`
      insert into sde_types (type_id, group_id, market_group_id, name, published)
      select id, 526, 614, 'Extra type', true from generate_series(100000, 100227) as id
    `
    const first = await loadMarketCatalogueProduct(
      { kind: 'group-types', groupId: 614 },
      connection,
    )
    expect(first.kind).toBe('group-types')
    if (first.kind !== 'group-types') throw new Error('Unexpected product result')
    expect(first.items).toHaveLength(100)
    expect(first.nextCursor).not.toBeNull()
    const second = await loadMarketCatalogueProduct(
      { kind: 'group-types', groupId: 614, cursor: first.nextCursor! },
      connection,
    )
    if (second.kind !== 'group-types') throw new Error('Unexpected product result')
    expect(second.items).toHaveLength(100)
    const final = await loadMarketCatalogueProduct(
      { kind: 'group-types', groupId: 614, cursor: second.nextCursor! },
      connection,
    )
    if (final.kind !== 'group-types') throw new Error('Unexpected product result')
    expect(final.items).toHaveLength(29)
    expect(final.nextCursor).toBeNull()
    expect(
      new Set([...first.items, ...second.items, ...final.items].map(({ id }) => id)).size,
    ).toBe(229)
    expect(() =>
      loadMarketCatalogueProduct({ kind: 'group-types', groupId: 614, cursor: 't_!' }, connection),
    ).toThrow('Invalid market group cursor')
  })
})
