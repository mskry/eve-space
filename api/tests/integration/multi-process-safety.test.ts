import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { migrationLockId } from '../../src/db/locks.js'
import { loadMigrations, runMigrations } from '../../src/db/migration-runner.js'

let container: StartedTestContainer
let databaseUrl: string

beforeAll(async () => {
  container = await new GenericContainer('postgres:17-alpine')
    .withEnvironment({
      POSTGRES_DB: 'eve_space',
      POSTGRES_PASSWORD: 'eve_space',
      POSTGRES_USER: 'eve_space',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/))
    .start()
  databaseUrl = `postgres://eve_space:eve_space@${container.getHost()}:${container.getMappedPort(5432)}/eve_space`
  await waitForDatabase(databaseUrl)
  Object.assign(process.env, {
    DATABASE_URL: databaseUrl,
    EVE_CLIENT_ID: 'test-client',
    EVE_CLIENT_SECRET: 'test-secret',
    TOKEN_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  })
})

afterAll(async () => {
  await container.stop()
})

beforeEach(async () => {
  const connection = postgres(databaseUrl)
  try {
    await connection.unsafe('drop schema public cascade; create schema public;').simple()
  } finally {
    await connection.end()
  }
})

async function waitForDatabase(url: string) {
  const connection = postgres(url)
  const deadline = Date.now() + 10_000

  try {
    while (Date.now() < deadline) {
      try {
        await connection`select 1`
        return
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
  } finally {
    await connection.end()
  }

  throw new Error('PostgreSQL did not become ready')
}

describe('multi-process safety', () => {
  test('refuses worker readiness until its expected migration is applied', async () => {
    const connection = postgres(databaseUrl)
    const { checkWorkerReadiness, expectedWorkerMigration } =
      await import('../../src/worker-readiness.js')

    try {
      await expect(checkWorkerReadiness(connection)).resolves.toEqual({
        healthy: false,
        reason: `Missing migration ${expectedWorkerMigration}`,
      })
    } finally {
      await connection.end()
    }
  })

  test('serializes concurrent migration runners and records every migration once', async () => {
    const first = postgres(databaseUrl)
    const second = postgres(databaseUrl)
    const inspector = postgres(databaseUrl)

    try {
      await Promise.all([runMigrations(first), runMigrations(second)])

      const migrations = await loadMigrations()
      const applied = await inspector<{ name: string }[]>`
        select name from schema_migrations order by name
      `
      expect(applied.map((migration) => migration.name)).toEqual(
        migrations.map((migration) => migration.name),
      )

      const { checkWorkerReadiness } = await import('../../src/worker-readiness.js')
      await expect(checkWorkerReadiness(inspector)).resolves.toEqual({ healthy: true })
    } finally {
      await Promise.all([first.end(), second.end(), inspector.end()])
    }
  })

  test('generates one stable planner offset for the installation', async () => {
    const connection = postgres(databaseUrl)

    try {
      await runMigrations(connection)
      const [first] = await connection<{ planner_schedule_offset_ms: number }[]>`
        select planner_schedule_offset_ms from deployment_installation_settings where id = 1
      `
      await runMigrations(connection)
      const [second] = await connection<{ planner_schedule_offset_ms: number }[]>`
        select planner_schedule_offset_ms from deployment_installation_settings where id = 1
      `

      expect(first?.planner_schedule_offset_ms).toBeGreaterThanOrEqual(0)
      expect(first?.planner_schedule_offset_ms).toBeLessThan(60_000)
      expect(second).toEqual(first)
    } finally {
      await connection.end()
    }
  })

  test('rolls back a failed migration with its migration record', async () => {
    const connection = postgres(databaseUrl)

    try {
      await expect(
        runMigrations(connection, [
          {
            name: 'test_rollback.sql',
            sql: 'create table migration_rollback_probe (id integer); select missing_function();',
          },
        ]),
      ).rejects.toThrow('missing_function')

      const [table] = await connection<{ exists: boolean }[]>`
        select to_regclass('migration_rollback_probe') is not null as exists
      `
      const applied = await connection<{ count: number }[]>`
        select count(*)::integer as count from schema_migrations where name = 'test_rollback.sql'
      `
      expect(table?.exists).toBe(false)
      expect(applied[0]?.count).toBe(0)
    } finally {
      await connection.end()
    }
  })

  test('rolls back every domain-event migration object when the migration fails', async () => {
    const connection = postgres(databaseUrl)
    const migration = (await loadMigrations()).find(({ name }) => name === '009_domain_events.sql')
    expect(migration).toBeDefined()

    try {
      await expect(
        runMigrations(connection, [
          {
            name: migration!.name,
            sql: `${migration!.sql}\nselect missing_domain_event_migration_function();`,
          },
        ]),
      ).rejects.toThrow('missing_domain_event_migration_function')

      const [objects] = await connection<
        { table_exists: boolean; function_exists: boolean; migration_count: number }[]
      >`
        select
          to_regclass('domain_events') is not null as table_exists,
          to_regprocedure('prevent_domain_event_envelope_update()') is not null as function_exists,
          (
            select count(*)::integer from schema_migrations
            where name = '009_domain_events.sql'
          ) as migration_count
      `
      expect(objects).toEqual({
        table_exists: false,
        function_exists: false,
        migration_count: 0,
      })
    } finally {
      await connection.end()
    }
  })

  test('rejects migrations that cannot run in a transaction', async () => {
    const connection = postgres(databaseUrl)

    try {
      await expect(
        runMigrations(connection, [
          {
            name: 'test_concurrent_index.sql',
            sql: 'create index concurrently test_index on users (created_at);',
          },
        ]),
      ).rejects.toThrow('cannot run in a transaction')

      const applied = await connection<{ count: number }[]>`
        select count(*)::integer as count
        from schema_migrations
        where name = 'test_concurrent_index.sql'
      `
      expect(applied[0]?.count).toBe(0)
    } finally {
      await connection.end()
    }
  })

  test('does not revalidate an already-applied migration', async () => {
    const connection = postgres(databaseUrl)

    try {
      await runMigrations(connection, [{ name: 'legacy.sql', sql: 'select 1' }])
      await expect(
        runMigrations(connection, [{ name: 'legacy.sql', sql: 'vacuum' }]),
      ).resolves.toBeUndefined()
    } finally {
      await connection.end()
    }
  })

  test('bounds migration advisory-lock waits', async () => {
    const holder = await postgres(databaseUrl).reserve()
    const contender = postgres(databaseUrl)

    try {
      await holder`select pg_advisory_lock(${migrationLockId})`
      await expect(runMigrations(contender, [], { lockTimeoutMs: 100 })).rejects.toMatchObject({
        code: '55P03',
      })
    } finally {
      await holder`select pg_advisory_unlock(${migrationLockId})`
      holder.release()
      await contender.end()
    }
  })

  test('persists one rotated refresh token across independent token-service instances', async () => {
    const connection = postgres(databaseUrl)
    const characterId = 1404328063
    const userId = '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c'
    const scope = 'esi-wallet.read_character_wallet.v1'
    await runMigrations(connection)
    const { decryptTokens, encryptTokens } = await import('../../src/security.js')

    await connection`insert into users (id) values (${userId})`
    await connection`
      insert into characters (character_id, user_id, name, corporation_id, is_main)
      values (${characterId}, ${userId}, 'Refresh Test', 1000166, true)
    `
    await connection`
      insert into eve_tokens (
        character_id, encrypted_tokens, access_token_expires_at, scopes
      ) values (
        ${characterId},
        ${encryptTokens({ accessToken: 'expired-access-token', refreshToken: 'original-refresh-token' })},
        ${new Date(Date.now() - 60_000)},
        ${connection.json([scope])}
      )
    `

    let releaseRefresh: () => void
    const refreshReleased = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    let notifyRefreshStarted: () => void
    const refreshStarted = new Promise<void>((resolve) => {
      notifyRefreshStarted = resolve
    })
    const refreshAccessToken = vi.fn(async () => {
      notifyRefreshStarted()
      await refreshReleased
      return {
        access_token: 'rotated-access-token',
        refresh_token: 'rotated-refresh-token',
        expires_in: 1200,
        token_type: 'Bearer',
      }
    })
    const verifyAccessToken = vi.fn(async () => ({
      characterId,
      characterName: 'Refresh Test',
      scopes: [scope],
    }))

    vi.resetModules()
    vi.doMock('../../src/eve-sso.js', () => ({ refreshAccessToken, verifyAccessToken }))
    const firstService = await import('../../src/token-service.js')
    const firstClient = await import('../../src/db/client.js')

    vi.resetModules()
    vi.doMock('../../src/eve-sso.js', () => ({ refreshAccessToken, verifyAccessToken }))
    const secondService = await import('../../src/token-service.js')
    const secondClient = await import('../../src/db/client.js')

    try {
      const first = firstService.getCharacterAccessToken(characterId, scope)
      await refreshStarted
      const second = secondService.getCharacterAccessToken(characterId, scope)
      releaseRefresh!()

      await expect(Promise.all([first, second])).resolves.toEqual([
        'rotated-access-token',
        'rotated-access-token',
      ])
      expect(refreshAccessToken).toHaveBeenCalledOnce()

      const [stored] = await connection<
        {
          encrypted_tokens: string
          token_version: number
        }[]
      >`
        select encrypted_tokens, token_version from eve_tokens where character_id = ${characterId}
      `
      expect(stored?.token_version).toBe(1)
      expect(decryptTokens(stored!.encrypted_tokens)).toEqual({
        accessToken: 'rotated-access-token',
        refreshToken: 'rotated-refresh-token',
      })
    } finally {
      await Promise.all([connection.end(), firstClient.sql.end(), secondClient.sql.end()])
      vi.doUnmock('../../src/eve-sso.js')
    }
  })
})
