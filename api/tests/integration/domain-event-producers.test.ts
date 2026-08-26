import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { runMigrations } from '../../src/db/migration-runner.js'

const ssoMocks = vi.hoisted(() => ({
  refreshAccessToken: vi.fn(),
  verifyAccessToken: vi.fn(),
}))

vi.mock('../../src/eve-sso.js', () => ({
  refreshAccessToken: ssoMocks.refreshAccessToken,
  verifyAccessToken: ssoMocks.verifyAccessToken,
}))

let container: StartedTestContainer
let databaseUrl: string
let authStore: typeof import('../../src/auth-store.js')
let tokenService: typeof import('../../src/token-service.js')
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
  await waitForDatabase(databaseUrl)
  Object.assign(process.env, {
    DATABASE_URL: databaseUrl,
    EVE_CLIENT_ID: 'test-client',
    EVE_CLIENT_SECRET: 'test-secret',
    TOKEN_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  })

  const migrationConnection = postgres(databaseUrl)
  try {
    await runMigrations(migrationConnection)
  } finally {
    await migrationConnection.end()
  }

  authStore = await import('../../src/auth-store.js')
  tokenService = await import('../../src/token-service.js')
  dbClient = await import('../../src/db/client.js')
})

afterAll(async () => {
  await dbClient?.sql.end()
  await container?.stop()
})

beforeEach(async () => {
  await dbClient.sql.unsafe(
    'alter table domain_events drop constraint if exists reject_attached_event',
  )
  await dbClient.sql.unsafe(
    'alter table domain_events drop constraint if exists reject_scope_change_event',
  )
  await dbClient.sql.unsafe(
    'truncate domain_events, oauth_states, sessions, eve_tokens, characters, users restart identity cascade',
  )
  ssoMocks.refreshAccessToken.mockReset()
  ssoMocks.verifyAccessToken.mockReset()
})

describe('transactional domain event producers', () => {
  test('accepts player-controlled names containing sensitive marker words', async () => {
    const characterName = 'Bearer of Top Secret Sessions'
    await saveLogin({ ...authorizationInput(mainCharacterId, []), characterName }, 'marker-session')

    expect(await readEvents()).toEqual([
      expect.objectContaining({
        event_type: 'character.attached',
        payload: expect.objectContaining({ characterName }),
      }),
    ])
  })

  test('login emits one attachment and only later material scope changes', async () => {
    const input = authorizationInput(mainCharacterId, ['z.scope', 'a.scope', 'z.scope'])
    await saveLogin(input, 'first-session')
    const userId = await findCharacterUserId(mainCharacterId)

    expect(await readEvents()).toEqual([
      expect.objectContaining({
        event_type: 'character.attached',
        aggregate_id: String(mainCharacterId),
        payload: characterSnapshot(userId, mainCharacterId, true, ['a.scope', 'z.scope']),
      }),
    ])
    expect(JSON.stringify(await readEvents())).not.toContain('access-token')
    expect(JSON.stringify(await readEvents())).not.toContain('refresh-token')

    await saveLogin({ ...input, scopes: ['a.scope', 'z.scope'] }, 'second-session')
    expect(await readEvents()).toHaveLength(1)
    await expect(sessionCount()).resolves.toBe(2)

    await saveLogin({ ...input, scopes: ['z.scope', 'new.scope'] }, 'third-session')
    expect(await readEvents()).toEqual([
      expect.objectContaining({ event_type: 'character.attached' }),
      expect.objectContaining({
        event_type: 'character.scopes-changed',
        payload: {
          userId,
          characterId: mainCharacterId,
          addedScopes: ['new.scope'],
          removedScopes: ['a.scope'],
        },
      }),
    ])

    await authStore.deleteSession('third-session')
    expect(await readEvents()).toHaveLength(2)
  })

  test('attachment emits once, compares existing scopes, and rejects cross-user conflicts', async () => {
    await saveLogin(authorizationInput(mainCharacterId, []), 'main-session')
    const userId = await findCharacterUserId(mainCharacterId)
    await clearEvents()

    const alt = authorizationInput(altCharacterId, ['z.scope', 'a.scope'])
    await authStore.attachCharacter({ ...alt, userId })
    expect(await readEvents()).toEqual([
      expect.objectContaining({
        event_type: 'character.attached',
        payload: characterSnapshot(userId, altCharacterId, false, ['a.scope', 'z.scope']),
      }),
    ])

    await authStore.attachCharacter({ ...alt, userId, scopes: ['a.scope', 'z.scope'] })
    expect(await readEvents()).toHaveLength(1)
    await authStore.attachCharacter({ ...alt, userId, scopes: ['z.scope', 'new.scope'] })
    expect(await readEvents()).toEqual([
      expect.objectContaining({ event_type: 'character.attached' }),
      expect.objectContaining({
        event_type: 'character.scopes-changed',
        payload: {
          userId,
          characterId: altCharacterId,
          addedScopes: ['new.scope'],
          removedScopes: ['a.scope'],
        },
      }),
    ])

    await saveLogin(authorizationInput(otherCharacterId, []), 'other-session')
    const otherUserId = await findCharacterUserId(otherCharacterId)
    await clearEvents()
    await expect(authStore.attachCharacter({ ...alt, userId: otherUserId })).rejects.toBeInstanceOf(
      authStore.CharacterOwnershipConflictError,
    )
    await expect(readEvents()).resolves.toEqual([])
    await expect(findCharacterUserId(altCharacterId)).resolves.toBe(userId)
  })

  test('reauthorization emits only a normalized material scope delta', async () => {
    await saveLogin(authorizationInput(mainCharacterId, ['old.scope', 'z.scope']), 'main-session')
    const userId = await findCharacterUserId(mainCharacterId)
    await clearEvents()

    const reauthorization = {
      ...authorizationInput(mainCharacterId, ['new.scope', 'z.scope', 'new.scope']),
      userId,
      expectedCharacterId: mainCharacterId,
    }
    await authStore.reauthorizeCharacter(reauthorization)
    expect(await readEvents()).toEqual([
      expect.objectContaining({
        event_type: 'character.scopes-changed',
        payload: {
          userId,
          characterId: mainCharacterId,
          addedScopes: ['new.scope'],
          removedScopes: ['old.scope'],
        },
      }),
    ])

    await authStore.reauthorizeCharacter({
      ...reauthorization,
      scopes: ['z.scope', 'new.scope'],
    })
    expect(await readEvents()).toHaveLength(1)
    await expect(
      authStore.reauthorizeCharacter({
        ...reauthorization,
        expectedCharacterId: altCharacterId,
      }),
    ).rejects.toThrow('Reauthorization returned a different character')
    expect(await readEvents()).toHaveLength(1)
  })

  test('main selection emits only an actual transition with its prior character', async () => {
    await saveLogin(authorizationInput(mainCharacterId, []), 'main-session')
    const userId = await findCharacterUserId(mainCharacterId)
    await authStore.attachCharacter({ ...authorizationInput(altCharacterId, []), userId })
    await clearEvents()

    await expect(authStore.setMainCharacter(userId, altCharacterId)).resolves.toMatchObject({
      characterId: altCharacterId,
      isMain: true,
    })
    expect(await readEvents()).toEqual([
      expect.objectContaining({
        event_type: 'character.main-changed',
        aggregate_id: userId,
        payload: {
          userId,
          previousMainCharacterId: mainCharacterId,
          newMainCharacterId: altCharacterId,
        },
      }),
    ])

    await authStore.setMainCharacter(userId, altCharacterId)
    await expect(authStore.setMainCharacter(userId, otherCharacterId)).resolves.toBeNull()
    expect(await readEvents()).toHaveLength(1)
  })

  test('repairs a missing main without fabricating a main-change event', async () => {
    await saveLogin(authorizationInput(mainCharacterId, []), 'main-session')
    const userId = await findCharacterUserId(mainCharacterId)
    await authStore.attachCharacter({ ...authorizationInput(altCharacterId, []), userId })
    await dbClient.sql`update characters set is_main = false where user_id = ${userId}`
    await clearEvents()

    await expect(authStore.setMainCharacter(userId, altCharacterId)).resolves.toMatchObject({
      characterId: altCharacterId,
      isMain: true,
    })
    const mains = await dbClient.sql<{ character_id: string }[]>`
      select character_id from characters where user_id = ${userId} and is_main
    `
    expect(mains).toEqual([{ character_id: String(altCharacterId) }])
    await expect(readEvents()).resolves.toEqual([])
  })

  test('successful non-main deletion emits the complete pre-delete snapshot', async () => {
    await saveLogin(authorizationInput(mainCharacterId, ['main.scope']), 'main-session')
    const userId = await findCharacterUserId(mainCharacterId)
    await authStore.attachCharacter({
      ...authorizationInput(altCharacterId, ['z.scope', 'a.scope', 'z.scope']),
      userId,
    })
    await clearEvents()

    const main = await authStore.findOwnedCharacter(userId, mainCharacterId)
    const alt = await authStore.findOwnedCharacter(userId, altCharacterId)
    await expect(authStore.deleteCharacter(userId, otherCharacterId, randomUUID())).resolves.toBe(
      'not-found',
    )
    await expect(
      authStore.deleteCharacter(userId, mainCharacterId, main!.subjectLifecycleId),
    ).resolves.toBe('main-character')
    await expect(readEvents()).resolves.toEqual([])

    await expect(
      authStore.deleteCharacter(userId, altCharacterId, alt!.subjectLifecycleId),
    ).resolves.toBe('deleted')
    expect(await readEvents()).toEqual([
      expect.objectContaining({
        event_type: 'character.detached',
        aggregate_id: String(altCharacterId),
        payload: characterSnapshot(userId, altCharacterId, false, ['a.scope', 'z.scope']),
      }),
    ])
    await expect(characterAndTokenCounts(altCharacterId)).resolves.toEqual({
      characters: 0,
      tokens: 0,
    })
  })

  test('event persistence failure rolls back its character and token mutation', async () => {
    await saveLogin(authorizationInput(mainCharacterId, []), 'main-session')
    const userId = await findCharacterUserId(mainCharacterId)
    await clearEvents()
    await dbClient.sql.unsafe(
      "alter table domain_events add constraint reject_attached_event check (event_type <> 'character.attached')",
    )

    try {
      await expect(
        authStore.attachCharacter({ ...authorizationInput(altCharacterId, ['a.scope']), userId }),
      ).rejects.toMatchObject({
        cause: { constraint_name: 'reject_attached_event' },
      })
      await expect(characterAndTokenCounts(altCharacterId)).resolves.toEqual({
        characters: 0,
        tokens: 0,
      })
      await expect(readEvents()).resolves.toEqual([])
    } finally {
      await dbClient.sql.unsafe('alter table domain_events drop constraint reject_attached_event')
    }
  })

  test('winning refresh emits scope changes while rotation and transient failures stay silent', async () => {
    const requiredScope = 'esi-wallet.read_character_wallet.v1'
    await saveLogin(
      authorizationInput(mainCharacterId, [requiredScope, 'removed.scope']),
      'main-session',
    )
    const userId = await findCharacterUserId(mainCharacterId)
    await clearEvents()
    await expireToken(mainCharacterId)
    ssoMocks.refreshAccessToken.mockResolvedValue({
      access_token: 'rotated-access',
      refresh_token: 'rotated-refresh',
      expires_in: 1200,
      token_type: 'Bearer',
    })
    ssoMocks.verifyAccessToken.mockResolvedValue({
      characterId: mainCharacterId,
      characterName: `Character ${mainCharacterId}`,
      scopes: ['z.scope', requiredScope, 'a.scope', 'z.scope'],
    })

    await expect(
      tokenService.getCharacterAccessToken(mainCharacterId, requiredScope),
    ).resolves.toBe('rotated-access')
    expect(await readEvents()).toEqual([
      expect.objectContaining({
        event_type: 'character.scopes-changed',
        payload: {
          userId,
          characterId: mainCharacterId,
          addedScopes: ['a.scope', 'z.scope'],
          removedScopes: ['removed.scope'],
        },
      }),
    ])
    await expect(readTokenState(mainCharacterId)).resolves.toMatchObject({
      scopes: ['a.scope', requiredScope, 'z.scope'],
      token_version: 1,
    })
    expect(JSON.stringify(await readEvents())).not.toContain('rotated-access')
    expect(JSON.stringify(await readEvents())).not.toContain('rotated-refresh')

    await clearEvents()
    await expireToken(mainCharacterId)
    ssoMocks.refreshAccessToken.mockResolvedValue({
      access_token: 'routine-access',
      refresh_token: 'routine-refresh',
      expires_in: 1200,
      token_type: 'Bearer',
    })
    ssoMocks.verifyAccessToken.mockResolvedValue({
      characterId: mainCharacterId,
      characterName: `Character ${mainCharacterId}`,
      scopes: ['z.scope', 'a.scope', requiredScope],
    })
    await tokenService.getCharacterAccessToken(mainCharacterId, requiredScope)
    await expect(readEvents()).resolves.toEqual([])

    await expireToken(mainCharacterId)
    const beforeFailure = await readTokenState(mainCharacterId)
    ssoMocks.refreshAccessToken.mockRejectedValue(new Error('temporary ESI SSO failure'))
    await expect(
      tokenService.getCharacterAccessToken(mainCharacterId, requiredScope),
    ).rejects.toThrow('temporary ESI SSO failure')
    await expect(readTokenState(mainCharacterId)).resolves.toEqual(beforeFailure)
    await expect(readEvents()).resolves.toEqual([])
  })

  test('scope-event persistence failure rolls back the winning token refresh', async () => {
    const requiredScope = 'esi-wallet.read_character_wallet.v1'
    await saveLogin(authorizationInput(mainCharacterId, [requiredScope]), 'main-session')
    await clearEvents()
    await expireToken(mainCharacterId)
    const beforeRefresh = await readTokenState(mainCharacterId)
    ssoMocks.refreshAccessToken.mockResolvedValue({
      access_token: 'rolled-back-access',
      refresh_token: 'rolled-back-refresh',
      expires_in: 1200,
      token_type: 'Bearer',
    })
    ssoMocks.verifyAccessToken.mockResolvedValue({
      characterId: mainCharacterId,
      characterName: `Character ${mainCharacterId}`,
      scopes: [requiredScope, 'new.scope'],
    })
    await dbClient.sql.unsafe(
      "alter table domain_events add constraint reject_scope_change_event check (event_type <> 'character.scopes-changed')",
    )

    try {
      await expect(
        tokenService.getCharacterAccessToken(mainCharacterId, requiredScope),
      ).rejects.toMatchObject({
        cause: { constraint_name: 'reject_scope_change_event' },
      })
      await expect(readTokenState(mainCharacterId)).resolves.toEqual(beforeRefresh)
      await expect(readEvents()).resolves.toEqual([])
    } finally {
      await dbClient.sql.unsafe(
        'alter table domain_events drop constraint reject_scope_change_event',
      )
    }
  })
})

const mainCharacterId = 1404328063
const altCharacterId = 2112625428
const otherCharacterId = 2112625429

function authorizationInput(characterId: number, scopes: string[]) {
  return {
    characterId,
    characterName: `Character ${characterId}`,
    corporationId: 1000166,
    allianceId: 99000001,
    accessToken: `access-token-${characterId}`,
    refreshToken: `refresh-token-${characterId}`,
    expiresIn: 1200,
    scopes,
  }
}

function saveLogin(input: ReturnType<typeof authorizationInput>, sessionToken: string) {
  return authStore.saveLogin({
    ...input,
    sessionToken,
    sessionExpiresAt: new Date(Date.now() + 60_000),
  })
}

function characterSnapshot(userId: string, characterId: number, isMain: boolean, scopes: string[]) {
  return {
    userId,
    characterId,
    characterName: `Character ${characterId}`,
    corporationId: 1000166,
    allianceId: 99000001,
    isMain,
    scopes,
  }
}

async function findCharacterUserId(characterId: number) {
  const [record] = await dbClient.sql<{ user_id: string }[]>`
    select user_id from characters where character_id = ${characterId}
  `
  if (!record) throw new Error('Expected character')
  return record.user_id
}

function readEvents() {
  return dbClient.sql<
    { event_type: string; aggregate_id: string; payload: Record<string, unknown> }[]
  >`
    select event_type, aggregate_id, payload
    from domain_events
    order by event_sequence
  `
}

async function sessionCount() {
  const [record] = await dbClient.sql<{ count: number }[]>`
    select count(*)::integer as count from sessions
  `
  return record?.count ?? 0
}

function clearEvents() {
  return dbClient.sql`delete from domain_events`
}

async function characterAndTokenCounts(characterId: number) {
  const [record] = await dbClient.sql<{ characters: number; tokens: number }[]>`
    select
      (select count(*)::integer from characters where character_id = ${characterId}) as characters,
      (select count(*)::integer from eve_tokens where character_id = ${characterId}) as tokens
  `
  if (!record) throw new Error('Expected counts')
  return record
}

function expireToken(characterId: number) {
  return dbClient.sql`
    update eve_tokens
    set access_token_expires_at = now() - interval '1 minute'
    where character_id = ${characterId}
  `
}

async function readTokenState(characterId: number) {
  const [record] = await dbClient.sql<{ scopes: string[]; token_version: number }[]>`
    select scopes, token_version from eve_tokens where character_id = ${characterId}
  `
  if (!record) throw new Error('Expected token')
  return record
}

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
