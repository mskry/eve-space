import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { runMigrations } from '../../../src/db/migration-runner.js'
import { createFeatureExecutionMock } from '../../support/mock-feature-execution.js'

const esiMocks = vi.hoisted(() => ({ executeRepresentation: vi.fn() }))

vi.mock('../../../src/esi-gateway/feature-execution.js', () =>
  createFeatureExecutionMock(esiMocks.executeRepresentation),
)

let container: StartedTestContainer
let databaseUrl: string
let connection: postgres.Sql
let affiliation: typeof import('../../../src/characters/affiliation-sync.js')
let characterLifecycle: typeof import('../../../src/auth/character-lifecycle.js')
let dbClient: typeof import('../../../src/db/client.js')
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
  affiliation = await import('../../../src/characters/affiliation-sync.js')
  characterLifecycle = await import('../../../src/auth/character-lifecycle.js')
  dbClient = await import('../../../src/db/client.js')
})

beforeEach(async () => {
  esiMocks.executeRepresentation.mockReset().mockResolvedValue(affiliationResult([]))
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

    await processBatch(
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
    await characterLifecycle.saveLogin({
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

    await processBatch(
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

    await processBatch([1], [], observedAt)
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

    await expect(affiliation.selectDueAffiliationBatches(now)).resolves.toEqual([[1, 2]])
    // Queue state is deliberately not consulted: another planner pass reconstructs the same due work.
    await expect(affiliation.selectDueAffiliationBatches(now)).resolves.toEqual([[1, 2]])
  })

  test('selects due membership before numerically ordering one operation-bounded batch', async () => {
    const now = new Date('2026-08-24T12:00:00.000Z')
    const id = userId(30)
    await connection`insert into users (id) values (${id})`
    await connection`
      insert into characters (
        character_id, user_id, name, corporation_id, is_main,
        affiliation_resolution_state, next_affiliation_check
      )
      select
        value,
        ${id},
        'Character ' || value,
        10,
        false,
        'pending',
        case
          when value = 1001 then ${now}::timestamptz - interval '2 seconds'
          when value = 1000 then ${now}::timestamptz - interval '500 milliseconds'
          else ${now}::timestamptz - interval '1 second'
        end
      from generate_series(1, 1001) as value
    `

    const expected = [...Array.from({ length: 999 }, (_, index) => index + 1), 1_001]
    await expect(affiliation.selectDueAffiliationBatches(now)).resolves.toEqual([expected])
  })

  test('persists one fresh existing-character observation at the ESI validation time', async () => {
    await insertCharacter(1, 10)
    const validatedAt = new Date('2026-08-24T11:59:00.000Z')
    esiMocks.executeRepresentation.mockResolvedValueOnce(
      affiliationResult([{ characterId: 1, corporationId: 101, allianceId: 201 }], validatedAt),
    )

    await expect(affiliation.observeAndPersistCharacterAffiliation(1)).resolves.toEqual({
      characterId: 1,
      corporationId: 101,
      allianceId: 201,
      affiliationCheckedAt: validatedAt,
      stale: false,
    })
    const [record] = await connection<
      { corporation_id: string; alliance_id: string; affiliation_checked_at: Date }[]
    >`
      select corporation_id, alliance_id, affiliation_checked_at
      from characters where character_id = 1
    `
    expect(record).toEqual({
      corporation_id: '101',
      alliance_id: '201',
      affiliation_checked_at: validatedAt,
    })
  })

  test('returns stale existing-character observations without persisting them', async () => {
    await insertCharacter(1, 10, { corporationId: 100, allianceId: 200 })
    const validatedAt = new Date('2026-08-24T11:59:00.000Z')
    esiMocks.executeRepresentation.mockResolvedValueOnce(
      affiliationResult(
        [{ characterId: 1, corporationId: 101, allianceId: 201 }],
        validatedAt,
        true,
      ),
    )

    await expect(affiliation.observeAndPersistCharacterAffiliation(1)).resolves.toMatchObject({
      affiliationCheckedAt: validatedAt,
      stale: true,
    })
    const [record] = await connection<
      { corporation_id: string; alliance_id: string; affiliation_checked_at: Date | null }[]
    >`
      select corporation_id, alliance_id, affiliation_checked_at
      from characters where character_id = 1
    `
    expect(record).toEqual({
      corporation_id: '100',
      alliance_id: '200',
      affiliation_checked_at: null,
    })
  })

  test('uses scheduled request start as observedAt even when ESI completes later', async () => {
    await insertCharacter(1, 10)
    const requestStartedAt = new Date('2026-08-24T12:00:00.000Z')
    let completeLookup!: () => void
    esiMocks.executeRepresentation.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeLookup = () =>
            resolve(
              affiliationResult(
                [{ characterId: 1, corporationId: 101, allianceId: null }],
                new Date('2026-08-24T11:55:00.000Z'),
              ),
            )
        }),
    )
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(requestStartedAt)
    try {
      const pending = affiliation.processAffiliationBatch([1])
      vi.setSystemTime(new Date('2026-08-24T12:05:00.000Z'))
      completeLookup()
      await pending
    } finally {
      vi.useRealTimers()
    }

    const [record] = await connection<{ affiliation_checked_at: Date }[]>`
      select affiliation_checked_at from characters where character_id = 1
    `
    expect(record?.affiliation_checked_at).toEqual(requestStartedAt)
  })

  test('rolls back affiliation changes when an ordered domain event cannot be appended', async () => {
    await insertCharacter(1, 10, { corporationId: 100, allianceId: 200 })
    await connection.unsafe(
      "alter table domain_events add constraint reject_affiliation_event check (event_type <> 'character.affiliation-observed')",
    )
    try {
      await expect(
        processBatch(
          [1],
          [{ characterId: 1, corporationId: 101, allianceId: 201 }],
          new Date('2026-08-24T12:00:00.000Z'),
        ),
      ).rejects.toMatchObject({
        cause: { constraint_name: 'reject_affiliation_event' },
      })
    } finally {
      await connection.unsafe('alter table domain_events drop constraint reject_affiliation_event')
    }

    const [record] = await connection<
      { corporation_id: string; alliance_id: string; event_count: number }[]
    >`
      select
        corporation_id,
        alliance_id,
        (select count(*)::integer from domain_events) as event_count
      from characters where character_id = 1
    `
    expect(record).toEqual({ corporation_id: '100', alliance_id: '200', event_count: 0 })
  })

  test('emits affiliation events in stable user and character order', async () => {
    await insertCharacter(3, 10)
    await insertCharacter(2, 10, { isMain: false })
    await insertCharacter(1, 20)
    const observedAt = new Date('2026-08-24T12:00:00.000Z')

    await processBatch(
      [1, 3, 2],
      [
        { characterId: 1, corporationId: 101, allianceId: null },
        { characterId: 2, corporationId: 102, allianceId: null },
        { characterId: 3, corporationId: 103, allianceId: null },
      ],
      observedAt,
    )

    const events = await connection<{ character_id: string; occurred_at: Date }[]>`
      select payload->>'characterId' as character_id, occurred_at
      from domain_events order by event_sequence
    `
    expect(events).toEqual([
      { character_id: '2', occurred_at: observedAt },
      { character_id: '3', occurred_at: observedAt },
      { character_id: '1', occurred_at: observedAt },
    ])
  })

  test('is idempotent, discards faction data, and leaves rows unchanged on failed ESI work', async () => {
    await insertCharacter(1, 10)
    const observedAt = new Date('2026-08-24T12:00:00.000Z')
    const observation = { characterId: 1, corporationId: 101, allianceId: 201, factionId: 500001 }
    await processBatch([1], [observation], observedAt)
    await processBatch([1], [observation], observedAt)
    const beforeFailure = await connection<
      { corporation_id: string; alliance_id: string | null; affiliation_resolution_state: string }[]
    >`select corporation_id, alliance_id, affiliation_resolution_state from characters where character_id = 1`

    await expect(
      (async () => {
        esiMocks.executeRepresentation.mockRejectedValueOnce(new Error('ESI unavailable'))
        await affiliation.processAffiliationBatch([1])
      })(),
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
  options: {
    corporationId?: number
    allianceId?: number | null
    nextCheck?: Date | null
    isMain?: boolean
  } = {},
) {
  const id = userId(user)
  await connection`insert into users (id) values (${id}) on conflict do nothing`
  await connection`
    insert into characters (
      character_id, user_id, name, corporation_id, alliance_id, is_main,
      affiliation_resolution_state, next_affiliation_check
    ) values (
      ${characterId}, ${id}, ${`Character ${characterId}`}, ${options.corporationId ?? 10},
      ${options.allianceId ?? null}, ${options.isMain ?? true}, 'pending', ${options.nextCheck ?? new Date()}
    )
  `
}

async function processBatch(
  characterIds: readonly number[],
  observations: readonly {
    characterId: number
    corporationId: number
    allianceId: number | null
  }[],
  observedAt: Date,
) {
  esiMocks.executeRepresentation.mockResolvedValueOnce(affiliationResult(observations, observedAt))
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(observedAt)
  try {
    await affiliation.processAffiliationBatch(characterIds)
  } finally {
    vi.useRealTimers()
  }
}

function affiliationResult(
  observations: readonly unknown[],
  validatedAt = new Date('2026-08-24T12:00:00.000Z'),
  stale = false,
) {
  return {
    data: observations,
    cachedUntil: new Date(validatedAt.getTime() + 60 * 60 * 1_000).toISOString(),
    validatedAt: validatedAt.toISOString(),
    source: 'esi' as const,
    stale,
    quota: {},
  }
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
