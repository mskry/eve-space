import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { loadPublishedTypeGroupsProduct } from '../../../src/core-data/published-type-groups-adapter.js'
import { loadMigrations, runMigrations } from '../../../src/db/migration-runner.js'

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
  await runMigrations(connection, await loadMigrations())
})

beforeEach(async () => {
  await connection`update sde_projection_state set active_build_number = null`
  await connection`truncate sde_types, sde_groups`
  await connection`delete from sde_builds`
  await connection`
    insert into sde_builds (build_number, release_date, ingested_at, ingest_version)
    values
      (1234, '2026-09-01 11:00:00+00', '2026-09-01 12:00:00.123456+00', 2),
      (1235, '2026-09-02 11:00:00+00', '2026-09-02 12:00:00.123456+00', 2)
  `
  await connection`update sde_projection_state set active_build_number = 1234`
  await connection`
    insert into sde_groups (group_id, category_id, name, published)
    values (18, 4, 'Mineral', true), (19, 4, 'Unpublished group', false)
  `
  await connection`
    insert into sde_types (type_id, group_id, name, published)
    values
      (34, 18, 'Tritanium', true),
      (35, 18, 'Pyerite', true),
      (36, 18, 'Unpublished type', false),
      (37, 19, 'Hidden group type', true)
  `
})

afterAll(async () => {
  await connection?.end()
  await container?.stop()
})

describe('published type-groups product', () => {
  test('deduplicates, filters, omits missing rows, and returns a complete revisioned result', async () => {
    await expect(
      loadPublishedTypeGroupsProduct({ typeIds: [37, 35, 999, 34, 36, 35] }, connection),
    ).resolves.toStrictEqual({
      complete: true,
      revision: {
        buildNumber: 1234,
        ingestVersion: 2,
        ingestedAt: '2026-09-01 12:00:00.123456+00',
      },
      rows: [
        { typeId: 34, typeName: 'Tritanium', groupId: 18, groupName: 'Mineral' },
        { typeId: 35, typeName: 'Pyerite', groupId: 18, groupName: 'Mineral' },
      ],
    })
  })

  test('returns the committed revision for an empty request', async () => {
    await expect(
      loadPublishedTypeGroupsProduct({ typeIds: [] }, connection),
    ).resolves.toStrictEqual({
      complete: true,
      revision: {
        buildNumber: 1234,
        ingestVersion: 2,
        ingestedAt: '2026-09-01 12:00:00.123456+00',
      },
      rows: [],
    })
  })

  test('fails closed without a committed SDE revision', async () => {
    await connection`update sde_projection_state set active_build_number = null`

    await expect(loadPublishedTypeGroupsProduct({ typeIds: [34] }, connection)).rejects.toThrow(
      'Committed SDE revision is missing',
    )
  })

  test('waits for a same-build replacement and returns only its committed projection', async () => {
    const locked = deferred<void>()
    const release = deferred<void>()
    const ingestion = connection.begin(async (transaction) => {
      await transaction`lock table sde_builds, sde_types, sde_groups in access exclusive mode`
      await transaction`truncate sde_types, sde_groups`
      await transaction`
        insert into sde_groups (group_id, category_id, name, published)
        values (25, 6, 'Frigate', true)
      `
      await transaction`
        insert into sde_types (type_id, group_id, name, published)
        values (587, 25, 'Rifter', true)
      `
      await transaction`
        update sde_builds
        set ingest_version = 3, ingested_at = '2026-09-01 12:01:00.654321+00'
        where build_number = 1234
      `
      locked.resolve()
      await release.promise
    })
    await locked.promise

    let settled = false
    const loading = loadPublishedTypeGroupsProduct({ typeIds: [34, 587] }, connection).finally(
      () => {
        settled = true
      },
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(settled).toBe(false)

    release.resolve()
    await ingestion
    await expect(loading).resolves.toStrictEqual({
      complete: true,
      revision: {
        buildNumber: 1234,
        ingestVersion: 3,
        ingestedAt: '2026-09-01 12:01:00.654321+00',
      },
      rows: [{ typeId: 587, typeName: 'Rifter', groupId: 25, groupName: 'Frigate' }],
    })
  })
})

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
