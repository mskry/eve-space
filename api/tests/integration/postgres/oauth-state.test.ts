import { createHash, randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { loadMigrations, runMigrations } from '../../../src/db/migration-runner.js'

let container: StartedTestContainer
let connection: postgres.Sql
let authStore: typeof import('../../../src/auth/store.js')
let dbClient: typeof import('../../../src/db/client.js')
let legacyReturnPath: string | null | undefined
const databasePassword = randomUUID()
const characterId = 1404328063

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
  Object.assign(process.env, {
    DATABASE_URL: databaseUrl,
    EVE_CLIENT_ID: 'test-client',
    EVE_CLIENT_SECRET: 'test-secret',
    TOKEN_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  })

  const migrations = await loadMigrations()
  const returnPathMigrationIndex = migrations.findIndex(
    ({ name }) => name === '020_oauth_state_return_path.sql',
  )
  if (returnPathMigrationIndex < 0) throw new Error('OAuth return-path migration is missing')
  await runMigrations(connection, migrations.slice(0, returnPathMigrationIndex))
  const userId = await insertOwnedCharacter()
  await connection`
    insert into oauth_states (state_hash, intent, user_id, character_id, expires_at)
    values (${'a'.repeat(64)}, 'reauthorize', ${userId}, ${characterId}, now() + interval '10 minutes')
  `
  await runMigrations(connection, migrations.slice(returnPathMigrationIndex))
  const [legacyState] = await connection<{ return_path: string | null }[]>`
    select return_path from oauth_states where state_hash = ${'a'.repeat(64)}
  `
  legacyReturnPath = legacyState?.return_path

  authStore = await import('../../../src/auth/store.js')
  dbClient = await import('../../../src/db/client.js')
})

beforeEach(async () => {
  await connection`
    truncate oauth_states, sessions, eve_tokens, platform_subject_lifecycles, characters, users
    restart identity cascade
  `
})

afterAll(async () => {
  await dbClient?.sql.end()
  await connection?.end()
  await container?.stop()
})

describe('OAuth state return path persistence', () => {
  test('applies a nullable varchar(512) column while preserving context constraints and legacy rows', async () => {
    const [column] = await connection<
      {
        data_type: string
        character_maximum_length: number
        is_nullable: string
        column_default: string | null
      }[]
    >`
      select data_type, character_maximum_length, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'oauth_states'
        and column_name = 'return_path'
    `
    const constraints = await connection<{ conname: string }[]>`
      select conname
      from pg_constraint
      where conrelid = 'oauth_states'::regclass
      order by conname
    `

    expect(column).toEqual({
      data_type: 'character varying',
      character_maximum_length: 512,
      is_nullable: 'YES',
      column_default: null,
    })
    expect(constraints.map(({ conname }) => conname)).toEqual(
      expect.arrayContaining([
        'oauth_states_character_id_fkey',
        'oauth_states_context_check',
        'oauth_states_intent_check',
        'oauth_states_return_path_context_check',
        'oauth_states_user_id_fkey',
      ]),
    )
    expect(legacyReturnPath).toBeNull()
  })

  test('enforces the return-path bound and reauthorization-only context constraint', async () => {
    const userId = await insertOwnedCharacter()
    await expect(
      connection`
        insert into oauth_states (state_hash, intent, user_id, return_path, expires_at)
        values (${'b'.repeat(64)}, 'attach', ${userId}, '/characters', now() + interval '10 minutes')
      `,
    ).rejects.toMatchObject({
      code: '23514',
      constraint_name: 'oauth_states_return_path_context_check',
    })
    await expect(
      connection`
        insert into oauth_states (
          state_hash, intent, user_id, character_id, return_path, expires_at
        ) values (
          ${'c'.repeat(64)}, 'reauthorize', ${userId}, ${characterId}, ${'a'.repeat(513)},
          now() + interval '10 minutes'
        )
      `,
    ).rejects.toMatchObject({ code: '22001' })
  })

  test('persists only a hash and atomically round-trips then deletes a return path', async () => {
    const userId = await insertOwnedCharacter()
    const state = 'raw-oauth-state'
    const returnPath = `/characters/${characterId}/mail?label=7`

    await authStore.storeOAuthState(state, {
      intent: 'reauthorize',
      userId,
      characterId,
      returnPath,
    })
    const [stored] = await connection<{ state_hash: string; return_path: string | null }[]>`
      select state_hash, return_path from oauth_states
    `

    expect(stored).toEqual({ state_hash: hashState(state), return_path: returnPath })
    expect(stored?.state_hash).not.toBe(state)
    await expect(authStore.consumeOAuthState(state)).resolves.toEqual({
      intent: 'reauthorize',
      userId,
      characterId,
      returnPath,
    })
    await expect(authStore.consumeOAuthState(state)).resolves.toBeNull()
    const [remaining] = await connection<{ count: number }[]>`
      select count(*)::integer as count from oauth_states
    `
    expect(remaining?.count).toBe(0)
  })

  test('preserves legacy omitted paths and stores null for other intents', async () => {
    const userId = await insertOwnedCharacter()
    await authStore.storeOAuthState('legacy-reauthorization', {
      intent: 'reauthorize',
      userId,
      characterId,
    })
    await authStore.storeOAuthState('login-state', { intent: 'login' })
    const rows = await connection<{ intent: string; return_path: string | null }[]>`
      select intent, return_path from oauth_states order by intent
    `

    expect(rows).toEqual([
      { intent: 'login', return_path: null },
      { intent: 'reauthorize', return_path: null },
    ])
    await expect(authStore.consumeOAuthState('legacy-reauthorization')).resolves.toEqual({
      intent: 'reauthorize',
      userId,
      characterId,
    })
  })

  test('allows exactly one concurrent consumer', async () => {
    const userId = await insertOwnedCharacter()
    const context = {
      intent: 'reauthorize' as const,
      userId,
      characterId,
      returnPath: `/characters/${characterId}/mail`,
    }
    await authStore.storeOAuthState('concurrent-state', context)

    const results = await Promise.all([
      authStore.consumeOAuthState('concurrent-state'),
      authStore.consumeOAuthState('concurrent-state'),
    ])

    expect(results.filter((result) => result === null)).toHaveLength(1)
    expect(results.filter((result) => result !== null)).toEqual([context])
  })

  test('round-trips a single-use organization-owner claim context', async () => {
    const userId = await insertOwnedCharacter()
    await connection`
      insert into organization_epochs (
        deployment_id,
        organization_version,
        organization_type,
        organization_id,
        organization_name,
        organization_ticker
      ) values (1, 1, 'corporation', 1000166, 'Claim Corporation', 'CLAIM')
      on conflict do nothing
    `
    const context = {
      intent: 'claim-organization-owner' as const,
      userId,
      characterId,
      organizationId: 1_000_166,
      organizationVersion: 1,
    }
    await authStore.storeOAuthState('owner-claim-state', context)

    const [stored] = await connection<
      {
        state_hash: string
        organization_id: string
        organization_version: string
      }[]
    >`
      select state_hash, organization_id, organization_version
      from oauth_states
      where intent = 'claim-organization-owner'
    `
    expect(stored).toEqual({
      state_hash: hashState('owner-claim-state'),
      organization_id: '1000166',
      organization_version: '1',
    })

    const results = await Promise.all([
      authStore.consumeOAuthState('owner-claim-state'),
      authStore.consumeOAuthState('owner-claim-state'),
    ])
    expect(results.filter(Boolean)).toEqual([context])
    expect(results.filter((result) => result === null)).toHaveLength(1)
  })
})

async function insertOwnedCharacter() {
  const userId = randomUUID()
  await connection`insert into users (id) values (${userId})`
  await connection`
    insert into characters (character_id, user_id, name, corporation_id, is_main)
    values (${characterId}, ${userId}, 'OAuth Pilot', 1000166, true)
  `
  return userId
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

function hashState(state: string) {
  return createHash('sha256').update(state).digest('hex')
}
