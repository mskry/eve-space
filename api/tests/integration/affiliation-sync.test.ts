import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { runMigrations } from '../../src/db/migration-runner.js'

let container: StartedTestContainer
let databaseUrl: string
let connection: postgres.Sql
let affiliation: typeof import('../../src/affiliation-sync.js')
let authStore: typeof import('../../src/auth-store.js')
let dbClient: typeof import('../../src/db/client.js')
const databasePassword = randomUUID()

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
  databaseUrl = `postgres://eve_space:${databasePassword}@${container.getHost()}:${container.getMappedPort(5432)}/eve_space`
  connection = postgres(databaseUrl)
  await waitForDatabase(connection)
  Object.assign(process.env, {
    DATABASE_URL: databaseUrl,
    EVE_CLIENT_ID: 'test-client',
    EVE_CLIENT_SECRET: 'test-secret',
    TOKEN_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  })

  await runMigrations(connection)
  affiliation = await import('../../src/affiliation-sync.js')
  authStore = await import('../../src/auth-store.js')
  dbClient = await import('../../src/db/client.js')
})

beforeEach(async () => {
  await connection.unsafe(
    'truncate domain_events, oauth_states, sessions, eve_tokens, characters, users restart identity cascade',
  )
})

afterAll(async () => {
  await dbClient?.sql.end()
  await connection?.end()
  await container?.stop()
})

describe('affiliation persistence', () => {
  test('derives active sessions at persistence time and treats other scheduled characters as inactive', async () => {
    const observedAt = new Date('2026-08-24T12:00:00.000Z')
    await insertCharacter(1, 10)
    await insertCharacter(2, 20)
    await connection`
      insert into sessions (session_hash, user_id, expires_at)
      values (${'a'.repeat(64)}, ${userId(10)}, ${new Date(observedAt.getTime() + 60_000)})
    `

    await affiliation.persistAffiliationObservations(
      [1, 2],
      [
        { characterId: 1, corporationId: 101, allianceId: null },
        { characterId: 2, corporationId: 102, allianceId: null },
      ],
      observedAt,
    )
    const rows = await connection<{ character_id: string; seconds: number }[]>`
      select character_id, extract(epoch from next_affiliation_check - ${observedAt})::integer as seconds
      from characters order by character_id
    `
    expect(rows).toEqual([
      { character_id: '1', seconds: 3_600 },
      { character_id: '2', seconds: 86_400 },
    ])
  })

  test('SSO observations schedule an active refresh and older batches cannot overwrite them', async () => {
    const expiresAt = new Date(Date.now() + 60_000)
    await authStore.saveLogin({
      characterId: 1,
      characterName: 'Login Pilot',
      corporationId: 100,
      allianceId: 200,
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: 1_200,
      scopes: [],
      sessionToken: 'session-token',
      sessionExpiresAt: expiresAt,
    })
    const [fresh] = await connection<
      { affiliation_checked_at: Date; next_affiliation_check: Date }[]
    >`
      select affiliation_checked_at, next_affiliation_check from characters where character_id = 1
    `
    expect(fresh!.next_affiliation_check.getTime()).toBeGreaterThan(
      fresh!.affiliation_checked_at.getTime(),
    )

    await affiliation.persistAffiliationObservations(
      [1],
      [{ characterId: 1, corporationId: 999, allianceId: 998 }],
      new Date(fresh!.affiliation_checked_at.getTime() - 1),
    )
    const [record] = await connection<{ corporation_id: string; alliance_id: string | null }[]>`
      select corporation_id, alliance_id from characters where character_id = 1
    `
    expect(record).toEqual({ corporation_id: '100', alliance_id: '200' })
  })

  test('keeps successful omissions pending for a later recoverable lookup without changing observations', async () => {
    await insertCharacter(1, 10, { corporationId: 100, allianceId: 200 })
    const observedAt = new Date('2026-08-24T12:00:00.000Z')

    await affiliation.persistAffiliationObservations([1], [], observedAt)
    const [record] = await connection<
      {
        corporation_id: string
        alliance_id: string | null
        affiliation_resolution_state: string
        next_affiliation_check: Date | null
      }[]
    >`
      select corporation_id, alliance_id, affiliation_resolution_state, next_affiliation_check
      from characters where character_id = 1
    `
    expect(record).toEqual({
      corporation_id: '100',
      alliance_id: '200',
      affiliation_resolution_state: 'pending',
      next_affiliation_check: expect.any(Date),
    })
  })

  test('selects due work deterministically and reconstructs it after queue loss', async () => {
    const now = new Date('2026-08-24T12:00:00.000Z')
    await insertCharacter(3, 30, { nextCheck: new Date(now.getTime() - 2_000) })
    await insertCharacter(1, 10, { nextCheck: new Date(now.getTime() - 1_000) })
    await insertCharacter(2, 20, { nextCheck: new Date(now.getTime() - 1_000) })
    await connection`
      update characters
      set affiliation_resolution_state = 'unresolvable', next_affiliation_check = null
      where character_id = 3
    `

    await expect(affiliation.selectDueAffiliationCharacterIds(now)).resolves.toEqual([
      { characterId: 1 },
      { characterId: 2 },
    ])
    // Queue state is deliberately not consulted: another planner pass reconstructs the same due work.
    await expect(affiliation.selectDueAffiliationCharacterIds(now)).resolves.toEqual([
      { characterId: 1 },
      { characterId: 2 },
    ])
  })

  test('is idempotent, discards faction data, and leaves rows unchanged on failed ESI work', async () => {
    await insertCharacter(1, 10)
    const observedAt = new Date('2026-08-24T12:00:00.000Z')
    const observation = { characterId: 1, corporationId: 101, allianceId: 201, factionId: 500001 }
    await affiliation.persistAffiliationObservations([1], [observation], observedAt)
    await affiliation.persistAffiliationObservations([1], [observation], observedAt)
    const beforeFailure = await connection<
      { corporation_id: string; alliance_id: string | null; affiliation_resolution_state: string }[]
    >`select corporation_id, alliance_id, affiliation_resolution_state from characters where character_id = 1`

    await expect(
      affiliation.processAffiliationBatch([1], {
        lookup: async () => {
          throw new Error('ESI unavailable')
        },
      }),
    ).rejects.toThrow('ESI unavailable')
    const afterFailure = await connection<
      { corporation_id: string; alliance_id: string | null; affiliation_resolution_state: string }[]
    >`select corporation_id, alliance_id, affiliation_resolution_state from characters where character_id = 1`
    expect(afterFailure).toEqual(beforeFailure)
    expect(JSON.stringify(afterFailure)).not.toContain('500001')
  })
})

async function insertCharacter(
  characterId: number,
  user: number,
  options: { corporationId?: number; allianceId?: number | null; nextCheck?: Date | null } = {},
) {
  const id = userId(user)
  await connection`insert into users (id) values (${id}) on conflict do nothing`
  await connection`
    insert into characters (
      character_id, user_id, name, corporation_id, alliance_id, is_main,
      affiliation_resolution_state, next_affiliation_check
    ) values (
      ${characterId}, ${id}, ${`Character ${characterId}`}, ${options.corporationId ?? 10},
      ${options.allianceId ?? null}, true, 'pending', ${options.nextCheck ?? new Date()}
    )
  `
}

function userId(value: number) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
}

async function waitForDatabase(client: postgres.Sql) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      await client`select 1`
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw new Error('PostgreSQL did not become ready')
}
