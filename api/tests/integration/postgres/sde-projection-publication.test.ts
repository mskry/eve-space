import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { loadMigrations, runMigrations } from '../../../src/db/migration-runner.js'

let container: StartedTestContainer
let connection: postgres.Sql
let databaseUrl: string

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
  databaseUrl = `postgres://eve_space:${password}@${container.getHost()}:${container.getMappedPort(5432)}/eve_space`
  connection = postgres(databaseUrl, { onnotice: () => {} })
  await runMigrations(connection, await loadMigrations())
})

beforeEach(async () => {
  await connection`update sde_projection_state set active_build_number = null`
  await connection`truncate sde_categories`
  await connection`delete from sde_builds`
  await connection`
    insert into sde_builds (build_number, release_date, ingest_version)
    values (100, '2026-09-01 11:00:00+00', 4)
  `
  await connection`insert into sde_categories values (1, 'Build 100', true)`
  await connection`update sde_projection_state set active_build_number = 100`
})

afterAll(async () => {
  await connection?.end()
  await container?.stop()
})

describe('SDE projection publication', () => {
  test('keeps the newer projection when it publishes before an older ingester', async () => {
    const newerConnection = postgres(databaseUrl, { max: 1, onnotice: () => {} })
    const olderConnection = postgres(databaseUrl, { max: 1, onnotice: () => {} })
    const newerReady = deferred<void>()
    const finishNewer = deferred<void>()

    const newerPublication = newerConnection.begin(async (transaction) => {
      await transaction`
        select singleton from sde_projection_state where singleton = true for update
      `
      await transaction`truncate sde_categories`
      await transaction`insert into sde_categories values (1, 'Build 102', true)`
      await transaction`
        insert into sde_builds (build_number, release_date, ingest_version)
        values (102, '2026-09-03 11:00:00+00', 4)
      `
      await transaction`
        update sde_projection_state set active_build_number = 102 where singleton = true
      `
      newerReady.resolve()
      await finishNewer.promise
      return 102
    })
    await newerReady.promise

    const olderPid = deferred<number>()
    const olderPublication = olderConnection.begin(async (transaction) => {
      const [session] = await transaction<{ pid: number }[]>`select pg_backend_pid() as pid`
      olderPid.resolve(session!.pid)
      await transaction`
        select singleton from sde_projection_state where singleton = true for update
      `
      const [active] = await transaction<{ build_number: string; ingest_version: number }[]>`
        select builds.build_number::text as build_number, builds.ingest_version
        from sde_projection_state as state
        inner join sde_builds as builds on builds.build_number = state.active_build_number
        where state.singleton = true
      `
      if (isNewerProjection(101, 4, active)) {
        await transaction`truncate sde_categories`
        await transaction`insert into sde_categories values (1, 'Build 101', true)`
        await transaction`
          insert into sde_builds (build_number, release_date, ingest_version)
          values (101, '2026-09-02 11:00:00+00', 4)
        `
        await transaction`
          update sde_projection_state set active_build_number = 101 where singleton = true
        `
      }
      return Number(active!.build_number)
    })

    try {
      await waitForLock(olderPid.promise)
    } finally {
      finishNewer.resolve()
    }

    await expect(Promise.all([newerPublication, olderPublication])).resolves.toEqual([102, 102])
    await expect(
      connection`
        select active_build_number::text as active_build_number
        from sde_projection_state
        where singleton = true
      `,
    ).resolves.toEqual([{ active_build_number: '102' }])
    await expect(connection`select name from sde_categories`).resolves.toEqual([
      { name: 'Build 102' },
    ])
    await expect(
      connection`select build_number::text as build_number from sde_builds order by build_number`,
    ).resolves.toEqual([{ build_number: '100' }, { build_number: '102' }])

    await Promise.all([newerConnection.end(), olderConnection.end()])
  })
})

function isNewerProjection(
  buildNumber: number,
  ingestVersion: number,
  active: { build_number: string; ingest_version: number } | undefined,
) {
  if (!active) return true
  const activeBuildNumber = Number(active.build_number)
  return (
    buildNumber > activeBuildNumber ||
    (buildNumber === activeBuildNumber && ingestVersion > active.ingest_version)
  )
}

async function waitForLock(pidPromise: Promise<number>) {
  const pid = await pidPromise
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const [activity] = await connection<{ wait_event_type: string | null }[]>`
      select wait_event_type from pg_stat_activity where pid = ${pid}
    `
    if (activity?.wait_event_type === 'Lock') return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Older SDE publisher did not wait for publication ownership')
}

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
