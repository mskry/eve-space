import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { runMigrations } from '../../../src/db/migration-runner.js'

const dayMs = 24 * 60 * 60 * 1_000
const lifetime = {
  idleSeconds: 14 * 24 * 60 * 60,
  absoluteSeconds: 30 * 24 * 60 * 60,
  renewalIntervalSeconds: 24 * 60 * 60,
}

let container: StartedTestContainer
let connection: postgres.Sql
let dbClient: typeof import('../../../src/db/client.js')
let sessionStore: typeof import('../../../src/auth/session-store.js')
let security: typeof import('../../../src/auth/security.js')
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
  const databaseUrl = `postgres://eve_space:${databasePassword}@${container.getHost()}:${container.getMappedPort(5432)}/eve_space`
  connection = postgres(databaseUrl, { onnotice: () => {} })
  await waitForDatabase()
  Object.assign(process.env, {
    DATABASE_URL: databaseUrl,
    EVE_CLIENT_ID: 'test-client',
    EVE_CLIENT_SECRET: 'test-secret',
    TOKEN_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  })
  await runMigrations(connection)

  dbClient = await import('../../../src/db/client.js')
  sessionStore = await import('../../../src/auth/session-store.js')
  security = await import('../../../src/auth/security.js')
})

beforeEach(async () => {
  await connection`truncate sessions, users restart identity cascade`
})

afterAll(async () => {
  await dbClient?.sql.end()
  await connection?.end()
  await container?.stop()
})

describe('session renewal', () => {
  test('extends an idle session once the renewal interval has elapsed', async () => {
    const token = await insertSession({ createdDaysAgo: 2, expiresInDays: 12 })

    const renewed = await sessionStore.renewSession(token, lifetime)

    expect(millisecondsFrom(renewed, Date.now() + 14 * dayMs)).toBeLessThan(60_000)
    expect(millisecondsFrom(await readExpiry(token), Date.now() + 14 * dayMs)).toBeLessThan(60_000)
  })

  test('skips the write while the last renewal is within the interval', async () => {
    const token = await insertSession({ createdDaysAgo: 0.5, expiresInDays: 13.5 })

    await expect(sessionStore.renewSession(token, lifetime)).resolves.toBeNull()

    expect(millisecondsFrom(await readExpiry(token), Date.now() + 13.5 * dayMs)).toBeLessThan(
      60_000,
    )
  })

  test('never extends a session beyond its absolute lifetime', async () => {
    const token = await insertSession({ createdDaysAgo: 20, expiresInDays: 2 })

    const renewed = await sessionStore.renewSession(token, lifetime)

    expect(millisecondsFrom(renewed, Date.now() + 10 * dayMs)).toBeLessThan(60_000)
    await expect(sessionStore.renewSession(token, lifetime)).resolves.toBeNull()
    expect(millisecondsFrom(await readExpiry(token), Date.now() + 10 * dayMs)).toBeLessThan(60_000)
  })

  test('does not revive an expired or unknown session', async () => {
    const token = await insertSession({ createdDaysAgo: 15, expiresInDays: -0.01 })

    await expect(sessionStore.renewSession(token, lifetime)).resolves.toBeNull()
    await expect(sessionStore.renewSession(randomUUID(), lifetime)).resolves.toBeNull()
    expect(millisecondsFrom(await readExpiry(token), Date.now() - 0.01 * dayMs)).toBeLessThan(
      60_000,
    )
  })
})

async function insertSession(input: { createdDaysAgo: number; expiresInDays: number }) {
  const token = randomUUID()
  const userId = randomUUID()
  const now = Date.now()
  await connection`insert into users (id) values (${userId})`
  await connection`
    insert into sessions (session_hash, user_id, expires_at, created_at)
    values (
      ${security.hashToken(token)},
      ${userId},
      ${new Date(now + input.expiresInDays * dayMs)},
      ${new Date(now - input.createdDaysAgo * dayMs)}
    )
  `
  return token
}

async function readExpiry(token: string) {
  const [record] = await connection<{ expires_at: Date }[]>`
    select expires_at from sessions where session_hash = ${security.hashToken(token)}
  `
  return record?.expires_at ?? null
}

function millisecondsFrom(value: Date | null, expected: number) {
  return Math.abs((value?.getTime() ?? Number.NaN) - expected)
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
