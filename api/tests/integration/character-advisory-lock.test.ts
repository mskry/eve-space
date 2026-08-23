import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { characterLockKey, characterLockNamespace } from '../../src/db/locks.js'

let container: StartedTestContainer
let sql: postgres.Sql

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
  sql = postgres(
    `postgres://eve_space:eve_space@${container.getHost()}:${container.getMappedPort(5432)}/eve_space`,
  )
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      await sql`select 1`
      break
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
})

afterAll(async () => {
  await sql.end()
  await container.stop()
})

/** Exactly the statement `lockCharacterRow` issues, through the same driver. */
function takeCharacterLock(characterId: number) {
  return sql.begin(
    async (transaction) =>
      await transaction`select pg_advisory_xact_lock(${characterLockNamespace}, ${characterLockKey(characterId)})`,
  )
}

describe('character advisory lock', () => {
  test('locks character IDs on both sides of the integer boundary', async () => {
    // The raw ID raised SQLSTATE 22003 for anything above 2^31-1.
    for (const characterId of [
      90_000_000,
      2_147_483_647,
      2_147_483_648,
      4_294_967_295,
      Number.MAX_SAFE_INTEGER,
    ])
      await expect(takeCharacterLock(characterId)).resolves.toBeDefined()
  })

  test('rejects the raw ID it used to pass, proving the boundary is real', async () => {
    await expect(
      sql.begin(
        async (transaction) =>
          await transaction`select pg_advisory_xact_lock(${characterLockNamespace}, ${2_147_483_648})`,
      ),
    ).rejects.toMatchObject({ code: '22003' })
  })

  test('serializes two holders of one character and lets a different character through', async () => {
    const characterId = 2_147_483_648
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => (release = resolve))
    let secondEntered = false

    const first = sql.begin(async (transaction) => {
      await transaction`select pg_advisory_xact_lock(${characterLockNamespace}, ${characterLockKey(characterId)})`
      await held
    })
    // Give the first transaction time to take the lock before contending for it.
    await new Promise((resolve) => setTimeout(resolve, 200))

    const second = sql
      .begin(async (transaction) => {
        await transaction`select pg_advisory_xact_lock(${characterLockNamespace}, ${characterLockKey(characterId)})`
        secondEntered = true
      })
      .catch(() => undefined)

    await expect(takeCharacterLock(characterId + 1)).resolves.toBeDefined()
    expect(secondEntered).toBe(false)

    release?.()
    await first
    await second
    expect(secondEntered).toBe(true)
  })
})
