import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { runMigrations } from '../../../src/db/migration-runner.js'

const password = randomUUID()
const characterId = 90_000_001
const otherCharacterId = 90_000_002
const ownerId = randomUUID()
const otherOwnerId = randomUUID()
const lifecycleId = randomUUID()
const otherLifecycleId = randomUUID()
let container: StartedTestContainer
let connection: postgres.Sql
let dbClient: typeof import('../../../src/db/client.js')
let tokenStore: typeof import('../../../src/auth/character-token-store.js')
let pendingStore: typeof import('../../../src/auth/pending-character-token-store.js')

beforeAll(async () => {
  container = await new GenericContainer('postgres:17-alpine')
    .withEnvironment({
      POSTGRES_DB: 'eve_space',
      POSTGRES_PASSWORD: password,
      POSTGRES_USER: 'eve_space',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/))
    .start()
  connection = postgres(
    `postgres://eve_space:${password}@${container.getHost()}:${container.getMappedPort(5432)}/eve_space`,
    { onnotice: () => {} },
  )
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await connection`select 1`
      break
    } catch (error) {
      if (attempt === 29) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  await runMigrations(connection)
  Object.assign(process.env, {
    DATABASE_URL: `postgres://eve_space:${password}@${container.getHost()}:${container.getMappedPort(5432)}/eve_space`,
    EVE_CLIENT_ID: 'test-client',
    EVE_CLIENT_SECRET: 'test-secret',
    TOKEN_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  })
  dbClient = await import('../../../src/db/client.js')
  tokenStore = await import('../../../src/auth/character-token-store.js')
  pendingStore = await import('../../../src/auth/pending-character-token-store.js')
})

beforeEach(async () => {
  await connection`truncate users cascade`
  await connection`insert into users (id) values (${ownerId}), (${otherOwnerId})`
  await connection`
    insert into characters (character_id, user_id, owner_hash, name, corporation_id)
    values (${characterId}, ${ownerId}, 'owner-one', 'Pilot One', 1000166),
      (${otherCharacterId}, ${otherOwnerId}, 'owner-two', 'Pilot Two', 1000166)
  `
  await connection`
    insert into platform_subject_lifecycles (subject_lifecycle_id, subject_kind, subject_id, character_id)
    values (${lifecycleId}, 'character', ${String(characterId)}, ${characterId}),
      (${otherLifecycleId}, 'character', ${String(otherCharacterId)}, ${otherCharacterId})
  `
  await connection`
    insert into eve_tokens (character_id, encrypted_tokens, access_token_expires_at, scopes, token_version)
    values (${characterId}, 'verified', now() + interval '1 hour', '["scope.one"]'::jsonb, 7)
  `
})

afterAll(async () => {
  await dbClient?.sql.end()
  await connection?.end()
  await container?.stop()
})

describe('pending character token storage', () => {
  const insertPending = (userId: string, subjectLifecycleId: string, id = characterId) =>
    connection`
      insert into pending_character_tokens (
        character_id, user_id, subject_lifecycle_id, base_token_version,
        encrypted_tokens, access_token_expires_at
      ) values (${id}, ${userId}, ${subjectLifecycleId}, 7,
        'pending-ciphertext', now() + interval '1 hour')
    `

  test('requires the verified character, its owner, and its lifecycle', async () => {
    await expect(insertPending(otherOwnerId, lifecycleId)).rejects.toMatchObject({ code: '23503' })
    await expect(insertPending(ownerId, otherLifecycleId)).rejects.toMatchObject({ code: '23503' })
    await expect(insertPending(ownerId, lifecycleId, otherCharacterId)).rejects.toMatchObject({
      code: '23503',
    })
    await insertPending(ownerId, lifecycleId)
    await expect(insertPending(ownerId, lifecycleId)).rejects.toMatchObject({ code: '23505' })
    const [pending] = await connection<{ attempt_id: string; base_token_version: number }[]>`
      select attempt_id, base_token_version from pending_character_tokens
    `
    expect(pending).toMatchObject({ base_token_version: 7 })
    expect(pending?.attempt_id).toMatch(/^[\da-f-]{36}$/)
    const [verified] = await connection<
      {
        encrypted_tokens: string
        token_version: number
        scopes: string[]
      }[]
    >`select encrypted_tokens, token_version, scopes from eve_tokens where character_id = ${characterId}`
    expect(verified).toEqual({
      encrypted_tokens: 'verified',
      token_version: 7,
      scopes: ['scope.one'],
    })
  })

  test('cascades when verified authorization or character is deleted', async () => {
    await insertPending(ownerId, lifecycleId)
    await connection`delete from eve_tokens where character_id = ${characterId}`
    const [afterTokenDelete] = await connection`select character_id from pending_character_tokens`
    expect(afterTokenDelete).toBeUndefined()

    await connection`
      insert into eve_tokens (character_id, encrypted_tokens, access_token_expires_at)
      values (${characterId}, 'replacement', now() + interval '1 hour')
    `
    await insertPending(ownerId, lifecycleId)
    await connection`delete from characters where character_id = ${characterId}`
    const [afterCharacterDelete] =
      await connection`select character_id from pending_character_tokens`
    expect(afterCharacterDelete).toBeUndefined()
  })

  test('fences conditional writes and deletes across transactions and connections', async () => {
    const firstAttempt = randomUUID()
    const secondAttempt = randomUUID()
    const binding = {
      characterId,
      userId: ownerId,
      subjectLifecycleId: lifecycleId,
      baseTokenVersion: 7,
      attemptId: firstAttempt,
    }
    const write = (attemptId: string, expectedAttemptId: string | null, encryptedTokens: string) =>
      tokenStore.withCharacterTokenLifecycleLock(
        characterId,
        lifecycleId,
        async (_token, transaction) =>
          pendingStore.writePendingCharacterToken(transaction, {
            ...binding,
            attemptId,
            expectedAttemptId,
            encryptedTokens,
            accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
          }),
      )

    await expect(write(firstAttempt, null, 'first-ciphertext')).resolves.toBe(true)
    await expect(write(randomUUID(), null, 'stale-first')).resolves.toBe(false)
    await expect(write(secondAttempt, randomUUID(), 'stale-revision')).resolves.toBe(false)
    await expect(write(secondAttempt, firstAttempt, 'second-ciphertext')).resolves.toBe(true)
    await expect(write(randomUUID(), firstAttempt, 'stale-rotation')).resolves.toBe(false)

    const [acrossConnections] = await connection<
      {
        attempt_id: string
        encrypted_tokens: string
      }[]
    >`select attempt_id, encrypted_tokens from pending_character_tokens where character_id = ${characterId}`
    expect(acrossConnections).toEqual({
      attempt_id: secondAttempt,
      encrypted_tokens: 'second-ciphertext',
    })

    await tokenStore.withCharacterTokenLifecycleLock(
      characterId,
      lifecycleId,
      async (_token, transaction) => {
        expect(await pendingStore.deletePendingCharacterToken(transaction, binding)).toBe(false)
      },
    )
    await connection`update eve_tokens set token_version = 8 where character_id = ${characterId}`
    await expect(write(randomUUID(), secondAttempt, 'stale-generation')).resolves.toBe(false)
    await tokenStore.withCharacterTokenLifecycleLock(
      characterId,
      lifecycleId,
      async (_token, transaction) => {
        expect(
          await pendingStore.deletePendingCharacterToken(transaction, {
            ...binding,
            attemptId: secondAttempt,
          }),
        ).toBe(false)
      },
    )
    const [stillPending] = await connection`select character_id from pending_character_tokens`
    expect(stillPending).toBeDefined()
  })

  test('rejects stale lifecycle and owner and rolls back a newer pending rotation', async () => {
    const attemptId = randomUUID()
    const input = {
      characterId,
      userId: ownerId,
      subjectLifecycleId: lifecycleId,
      baseTokenVersion: 7,
      attemptId,
      expectedAttemptId: null,
      encryptedTokens: 'original-pending',
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    }
    await tokenStore.withCharacterTokenLifecycleLock(
      characterId,
      lifecycleId,
      async (_token, transaction) => {
        expect(await pendingStore.writePendingCharacterToken(transaction, input)).toBe(true)
        expect(
          await pendingStore.writePendingCharacterToken(transaction, {
            ...input,
            userId: otherOwnerId,
          }),
        ).toBe(false)
        expect(
          await pendingStore.writePendingCharacterToken(transaction, {
            ...input,
            subjectLifecycleId: otherLifecycleId,
          }),
        ).toBe(false)
        expect(
          await pendingStore.writePendingCharacterToken(transaction, {
            ...input,
            baseTokenVersion: 8,
          }),
        ).toBe(false)
      },
    )
    await expect(
      tokenStore.withCharacterTokenLifecycleLock(
        characterId,
        lifecycleId,
        async (_token, transaction) => {
          expect(
            await pendingStore.writePendingCharacterToken(transaction, {
              ...input,
              attemptId: randomUUID(),
              expectedAttemptId: attemptId,
              encryptedTokens: 'rolled-back-rotation',
            }),
          ).toBe(true)
          throw new Error('rollback')
        },
      ),
    ).rejects.toThrow('rollback')
    await expect(
      pendingStore.findPendingCharacterToken(characterId, lifecycleId),
    ).resolves.toMatchObject({
      attemptId,
      encryptedTokens: 'original-pending',
    })
    await tokenStore.withCharacterTokenLifecycleLock(
      characterId,
      lifecycleId,
      async (_token, transaction) => {
        expect(await pendingStore.deletePendingCharacterToken(transaction, input)).toBe(true)
      },
    )
    await expect(
      pendingStore.findPendingCharacterToken(characterId, lifecycleId),
    ).resolves.toBeNull()
  })

  test('rolls back pending deletion and verified promotion together', async () => {
    const attemptId = randomUUID()
    const binding = {
      characterId,
      userId: ownerId,
      subjectLifecycleId: lifecycleId,
      baseTokenVersion: 7,
      attemptId,
    }
    await tokenStore.withCharacterTokenLifecycleLock(
      characterId,
      lifecycleId,
      async (_token, transaction) => {
        expect(
          await pendingStore.writePendingCharacterToken(transaction, {
            ...binding,
            expectedAttemptId: null,
            encryptedTokens: 'pending-ciphertext',
            accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
          }),
        ).toBe(true)
      },
    )

    await expect(
      tokenStore.withCharacterTokenLifecycleLock(
        characterId,
        lifecycleId,
        async (_token, transaction) => {
          expect(await pendingStore.deletePendingCharacterToken(transaction, binding)).toBe(true)
          expect(
            await tokenStore.updateCharacterToken(
              {
                characterId,
                tokenVersion: 7,
                encryptedTokens: 'would-be-verified',
                expiresAt: new Date(Date.now() + 3_600_000),
                scopes: ['scope.two'],
              },
              transaction,
            ),
          ).toBe(true)
          throw new Error('promotion transaction failed')
        },
      ),
    ).rejects.toThrow('promotion transaction failed')

    const [verified] = await connection<
      {
        encrypted_tokens: string
        token_version: number
        scopes: string[]
      }[]
    >`select encrypted_tokens, token_version, scopes from eve_tokens where character_id = ${characterId}`
    expect(verified).toEqual({
      encrypted_tokens: 'verified',
      token_version: 7,
      scopes: ['scope.one'],
    })
    await expect(
      pendingStore.findPendingCharacterToken(characterId, lifecycleId),
    ).resolves.toMatchObject({
      ...binding,
      encryptedTokens: 'pending-ciphertext',
    })
  })
})
