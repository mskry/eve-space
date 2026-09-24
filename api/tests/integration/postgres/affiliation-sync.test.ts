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
let managedMemberLifecycle: typeof import('../../../src/organization/managed-member-lifecycle.js')
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
  managedMemberLifecycle = await import('../../../src/organization/managed-member-lifecycle.js')
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
  test('records departure and re-entry as separate managed-member intervals before events run', async () => {
    const id = userId(10)
    await ensureCorporationOrganization()
    await insertCharacter(1, 10)
    const converge: NonNullable<Parameters<typeof affiliation.processAffiliationBatch>[2]> = (
      transaction,
      userIds,
      observedAt,
    ) =>
      managedMemberLifecycle.convergeCurrentManagedMemberLifecyclesInTransaction(transaction, {
        now: observedAt,
        userIds,
      })

    await processBatch(
      [1],
      [{ allianceId: null, characterId: 1, corporationId: 98_000_001 }],
      new Date('2026-09-16T12:00:00.000Z'),
      converge,
    )
    await processBatch(
      [1],
      [{ allianceId: null, characterId: 1, corporationId: 98_000_002 }],
      new Date('2026-09-16T12:01:00.000Z'),
      converge,
    )
    await processBatch(
      [1],
      [{ allianceId: null, characterId: 1, corporationId: 98_000_001 }],
      new Date('2026-09-16T12:02:00.000Z'),
      converge,
    )
    await processBatch(
      [1],
      [{ allianceId: null, characterId: 1, corporationId: 98_000_001 }],
      new Date('2026-09-17T12:03:00.000Z'),
      converge,
    )

    const lifecycles = await connection<
      { managed_member_lifecycle_id: string; started_at: Date; ended_at: Date | null }[]
    >`
      select managed_member_lifecycle_id, started_at, ended_at
      from organization_managed_member_lifecycles
      where user_id = ${id}
      order by started_at
    `
    expect(lifecycles).toHaveLength(3)
    expect(lifecycles[0]).toMatchObject({
      ended_at: new Date('2026-09-16T12:01:00.000Z'),
      managed_member_lifecycle_id: expect.any(String),
    })
    expect(lifecycles[1]).toMatchObject({
      ended_at: new Date('2026-09-17T12:03:00.000Z'),
      managed_member_lifecycle_id: expect.any(String),
      started_at: new Date('2026-09-16T12:02:00.000Z'),
    })
    expect(lifecycles[1]!.managed_member_lifecycle_id).not.toBe(
      lifecycles[0]!.managed_member_lifecycle_id,
    )
    expect(lifecycles[2]).toMatchObject({
      ended_at: null,
      managed_member_lifecycle_id: expect.any(String),
      started_at: new Date('2026-09-17T12:03:00.000Z'),
    })
    expect(lifecycles[2]!.managed_member_lifecycle_id).not.toBe(
      lifecycles[1]!.managed_member_lifecycle_id,
    )
  })

  test('starts a new managed-member interval when SSO refreshes expired affiliation evidence', async () => {
    await ensureCorporationOrganization()
    const firstObservedAt = new Date('2026-09-18T10:00:00.000Z')
    const secondObservedAt = new Date('2026-09-18T12:00:00.000Z')
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(firstObservedAt)
      await characterLifecycle.saveLogin({
        accessToken: 'first-access-token',
        affiliationCheckedAt: firstObservedAt,
        allianceId: null,
        characterId: 1,
        characterName: 'Login Pilot',
        corporationId: 98_000_001,
        expiresIn: 1200,
        ownerHash: 'login-owner',
        refreshToken: 'first-refresh-token',
        scopes: [],
        sessionExpiresAt: new Date('2026-09-19T10:00:00.000Z'),
        sessionToken: 'first-session-token',
      })

      vi.setSystemTime(secondObservedAt)
      await characterLifecycle.saveLogin({
        accessToken: 'second-access-token',
        affiliationCheckedAt: secondObservedAt,
        allianceId: null,
        characterId: 1,
        characterName: 'Login Pilot',
        corporationId: 98_000_001,
        expiresIn: 1200,
        ownerHash: 'login-owner',
        refreshToken: 'second-refresh-token',
        scopes: [],
        sessionExpiresAt: new Date('2026-09-19T12:00:00.000Z'),
        sessionToken: 'second-session-token',
      })
    } finally {
      vi.useRealTimers()
    }

    const lifecycles = await connection<
      { managed_member_lifecycle_id: string; started_at: Date; ended_at: Date | null }[]
    >`
      select managed_member_lifecycle_id, started_at, ended_at
      from organization_managed_member_lifecycles
      where user_id = (select user_id from characters where character_id = 1)
      order by started_at
    `
    expect([...lifecycles]).toStrictEqual([
      {
        ended_at: secondObservedAt,
        managed_member_lifecycle_id: expect.any(String),
        started_at: firstObservedAt,
      },
      {
        ended_at: null,
        managed_member_lifecycle_id: expect.any(String),
        started_at: secondObservedAt,
      },
    ])
    expect(lifecycles[1]!.managed_member_lifecycle_id).not.toBe(
      lifecycles[0]!.managed_member_lifecycle_id,
    )
  })

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
        { allianceId: null, characterId: 1, corporationId: 101 },
        { allianceId: null, characterId: 2, corporationId: 102 },
      ],
      observedAt,
    )
    const rows = await connection<{ character_id: string; seconds: number }[]>`
      select character_id, extract(epoch from next_affiliation_check - ${observedAt})::integer as seconds
      from characters order by character_id
    `
    expect([...rows]).toStrictEqual([
      { character_id: '1', seconds: 3600 },
      { character_id: '2', seconds: 86_400 },
    ])
  })

  test('SSO observations schedule an active refresh and older batches cannot overwrite them', async () => {
    const expiresAt = new Date(Date.now() + 60_000)
    await characterLifecycle.saveLogin({
      accessToken: 'access-token',
      allianceId: 200,
      characterId: 1,
      characterName: 'Login Pilot',
      corporationId: 100,
      expiresIn: 1200,
      ownerHash: 'login-owner',
      refreshToken: 'refresh-token',
      scopes: [],
      sessionExpiresAt: expiresAt,
      sessionToken: 'session-token',
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
      [{ allianceId: 998, characterId: 1, corporationId: 999 }],
      new Date(fresh!.affiliation_checked_at.getTime() - 1),
    )
    const [record] = await connection<{ corporation_id: string; alliance_id: string | null }[]>`
      select corporation_id, alliance_id from characters where character_id = 1
    `
    expect(record).toStrictEqual({ alliance_id: '200', corporation_id: '100' })
  })

  test('keeps successful omissions pending for a later recoverable lookup without changing observations', async () => {
    await insertCharacter(1, 10, { allianceId: 200, corporationId: 100 })
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
    expect(record).toStrictEqual({
      affiliation_resolution_state: 'pending',
      alliance_id: '200',
      corporation_id: '100',
      next_affiliation_check: expect.any(Date),
    })
  })

  test('selects due work deterministically and reconstructs it after queue loss', async () => {
    const now = new Date('2026-08-24T12:00:00.000Z')
    await insertCharacter(3, 30, { nextCheck: new Date(now.getTime() - 2000) })
    await insertCharacter(1, 10, { nextCheck: new Date(now.getTime() - 1000) })
    await insertCharacter(2, 20, { nextCheck: new Date(now.getTime() - 1000) })
    await connection`
      update characters
      set affiliation_resolution_state = 'unresolvable', next_affiliation_check = null
      where character_id = 3
    `

    await expect(affiliation.selectDueAffiliationBatches(now)).resolves.toStrictEqual([[1, 2]])
    // Queue state is deliberately not consulted: another planner pass reconstructs the same due work.
    await expect(affiliation.selectDueAffiliationBatches(now)).resolves.toStrictEqual([[1, 2]])
  })

  test('selects due membership before numerically ordering one operation-bounded batch', async () => {
    const now = new Date('2026-08-24T12:00:00.000Z')
    const id = userId(30)
    await connection`insert into users (id) values (${id})`
    await connection`
      insert into characters (
        character_id, user_id, owner_hash, name, corporation_id, is_main,
        affiliation_resolution_state, next_affiliation_check
      )
      select
        value,
        ${id},
        'owner-' || value,
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

    const expected = [...Array.from({ length: 999 }, (_, index) => index + 1), 1001]
    await expect(affiliation.selectDueAffiliationBatches(now)).resolves.toStrictEqual([expected])
  })

  test('persists one fresh existing-character observation at the ESI validation time', async () => {
    await insertCharacter(1, 10)
    const validatedAt = new Date('2026-08-24T11:59:00.000Z')
    esiMocks.executeRepresentation.mockResolvedValueOnce(
      affiliationResult([{ allianceId: 201, characterId: 1, corporationId: 101 }], validatedAt),
    )

    await expect(affiliation.observeAndPersistCharacterAffiliation(1)).resolves.toStrictEqual({
      affiliationCheckedAt: validatedAt,
      affiliationFreshUntil: new Date(validatedAt.getTime() + 60 * 60 * 1000),
      allianceId: 201,
      characterId: 1,
      corporationId: 101,
      stale: false,
    })
    const [record] = await connection<
      { corporation_id: string; alliance_id: string; affiliation_checked_at: Date }[]
    >`
      select corporation_id, alliance_id, affiliation_checked_at
      from characters where character_id = 1
    `
    expect(record).toStrictEqual({
      affiliation_checked_at: validatedAt,
      alliance_id: '201',
      corporation_id: '101',
    })
  })

  test('returns stale existing-character observations without persisting them', async () => {
    await insertCharacter(1, 10, { allianceId: 200, corporationId: 100 })
    const validatedAt = new Date('2026-08-24T11:59:00.000Z')
    esiMocks.executeRepresentation.mockResolvedValueOnce(
      affiliationResult(
        [{ allianceId: 201, characterId: 1, corporationId: 101 }],
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
    expect(record).toStrictEqual({
      affiliation_checked_at: null,
      alliance_id: '200',
      corporation_id: '100',
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
                [{ allianceId: null, characterId: 1, corporationId: 101 }],
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
    expect(record?.affiliation_checked_at).toStrictEqual(requestStartedAt)
  })

  test('rolls back affiliation changes when an ordered domain event cannot be appended', async () => {
    await insertCharacter(1, 10, { allianceId: 200, corporationId: 100 })
    await connection.unsafe(
      "alter table domain_events add constraint reject_affiliation_event check (event_type <> 'character.affiliation-observed')",
    )
    try {
      await expect(
        processBatch(
          [1],
          [{ allianceId: 201, characterId: 1, corporationId: 101 }],
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
    expect(record).toStrictEqual({ alliance_id: '200', corporation_id: '100', event_count: 0 })
  })

  test('emits affiliation events in stable user and character order', async () => {
    await insertCharacter(3, 10)
    await insertCharacter(2, 10, { isMain: false })
    await insertCharacter(1, 20)
    const observedAt = new Date('2026-08-24T12:00:00.000Z')

    await processBatch(
      [1, 3, 2],
      [
        { allianceId: null, characterId: 1, corporationId: 101 },
        { allianceId: null, characterId: 2, corporationId: 102 },
        { allianceId: null, characterId: 3, corporationId: 103 },
      ],
      observedAt,
    )

    const events = await connection<{ character_id: string; occurred_at: Date }[]>`
      select payload->>'characterId' as character_id, occurred_at
      from domain_events order by event_sequence
    `
    expect([...events]).toStrictEqual([
      { character_id: '2', occurred_at: observedAt },
      { character_id: '3', occurred_at: observedAt },
      { character_id: '1', occurred_at: observedAt },
    ])
  })

  test('is idempotent, discards faction data, and leaves rows unchanged on failed ESI work', async () => {
    await insertCharacter(1, 10)
    const observedAt = new Date('2026-08-24T12:00:00.000Z')
    const observation = { allianceId: 201, characterId: 1, corporationId: 101, factionId: 500_001 }
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
    expect(afterFailure).toStrictEqual(beforeFailure)
    expect(JSON.stringify(afterFailure)).not.toContain('500001')
  })
})

async function ensureCorporationOrganization() {
  await connection`
    insert into organization_epochs (
      deployment_id, organization_version, organization_type, organization_id,
      organization_name, organization_ticker
    ) values (1, 1, 'corporation', 98000001, 'Managed Corporation', 'CORP')
    on conflict do nothing
  `
  await connection`
    insert into deployment_settings (
      id, organization_type, organization_id,
      organization_name, organization_ticker, organization_version
    ) values (1, 'corporation', 98000001, 'Managed Corporation', 'CORP', 1)
    on conflict do nothing
  `
  await connection`
    insert into organization_managed_corporations (
      deployment_id, organization_version, corporation_id, is_current,
      first_observed_at, last_observed_at
    ) values (1, 1, 98000001, true, now(), now())
    on conflict do nothing
  `
}

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
      character_id, user_id, owner_hash, name, corporation_id, alliance_id, is_main,
      affiliation_resolution_state, next_affiliation_check
    ) values (
      ${characterId}, ${id}, ${`owner-${characterId}`}, ${`Character ${characterId}`}, ${options.corporationId ?? 10},
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
  afterPersist?: Parameters<typeof affiliation.processAffiliationBatch>[2],
) {
  esiMocks.executeRepresentation.mockResolvedValueOnce(affiliationResult(observations, observedAt))
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(observedAt)
  try {
    await affiliation.processAffiliationBatch(characterIds, undefined, afterPersist)
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
    cachedUntil: new Date(validatedAt.getTime() + 60 * 60 * 1000).toISOString(),
    data: observations,
    quota: {},
    source: 'esi' as const,
    stale,
    validatedAt: validatedAt.toISOString(),
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
