import { randomUUID } from 'node:crypto'
import { Redis } from 'ioredis'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { runMigrations } from '../../../src/db/migration-runner.js'
import { SsoTransportError } from '../../../src/auth/sso-errors.js'

const provider = vi.hoisted(() => ({ refreshAccessToken: vi.fn(), verifyAccessToken: vi.fn() }))
let cache: Redis
let coordination: Redis
vi.mock('../../../src/auth/sso.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/auth/sso.js')>()),
  refreshAccessToken: provider.refreshAccessToken,
  verifyAccessToken: provider.verifyAccessToken,
}))

const password = randomUUID()
const characterId = 90_000_005
const userId = randomUUID()
const lifecycleId = randomUUID()
const scope = 'esi-wallet.read_character_wallet.v1'
let containers: StartedTestContainer[]
let connection: postgres.Sql
const dbConnections = new Set<postgres.Sql>()

beforeAll(async () => {
  containers = await Promise.all([
    new GenericContainer('postgres:17-alpine')
      .withEnvironment({
        POSTGRES_DB: 'eve_space',
        POSTGRES_PASSWORD: password,
        POSTGRES_USER: 'eve_space',
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/))
      .start(),
    ...Array.from({ length: 2 }, () =>
      new GenericContainer('redis:7.4.7-alpine')
        .withExposedPorts(6379)
        .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
        .start(),
    ),
  ])
  const [databaseContainer, cacheContainer, coordinationContainer] = containers
  const databaseUrl = `postgres://eve_space:${password}@${databaseContainer!.getHost()}:${databaseContainer!.getMappedPort(5432)}/eve_space`
  connection = postgres(databaseUrl, { onnotice: () => {} })
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
    DATABASE_URL: databaseUrl,
    CACHE_REDIS_URL: `redis://${cacheContainer!.getHost()}:${cacheContainer!.getMappedPort(6379)}`,
    QUEUE_REDIS_URL: `redis://${coordinationContainer!.getHost()}:${coordinationContainer!.getMappedPort(6379)}`,
    EVE_CLIENT_ID: 'test-client',
    EVE_CLIENT_SECRET: 'test-secret',
    TOKEN_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  })
  cache = new Redis(`redis://${cacheContainer!.getHost()}:${cacheContainer!.getMappedPort(6379)}`)
  coordination = new Redis(
    `redis://${coordinationContainer!.getHost()}:${coordinationContainer!.getMappedPort(6379)}`,
  )
  cache.on('error', () => {})
  coordination.on('error', () => {})
})

const closeRuntimeConnections = async () => {
  const [{ closeProductionEsiExecutionRuntime }, cacheRedis, coordinationRedis] = await Promise.all(
    [
      import('../../../src/esi-gateway/runtime-lifecycle.js'),
      import('../../../src/cache-redis.js'),
      import('../../../src/coordination-redis.js'),
    ],
  )
  await closeProductionEsiExecutionRuntime()
  await Promise.all([
    cacheRedis.closeSharedCacheRedisConnection(),
    coordinationRedis.closeSharedCoordinationRedisConnection(),
  ])
}

afterEach(async () => {
  await closeRuntimeConnections()
  vi.unstubAllGlobals()
})

beforeEach(async () => {
  vi.resetModules()
  provider.refreshAccessToken.mockReset()
  provider.verifyAccessToken.mockReset()
  await Promise.all([cache.flushdb(), coordination.flushdb()])
  await connection`truncate users cascade`
  await connection`insert into users (id) values (${userId})`
  await connection`
    insert into characters (character_id, user_id, owner_hash, name, corporation_id)
    values (${characterId}, ${userId}, 'owner-hash', 'Pilot', 1000166)
  `
  await connection`
    insert into platform_subject_lifecycles (subject_lifecycle_id, subject_kind, subject_id, character_id)
    values (${lifecycleId}, 'character', ${String(characterId)}, ${characterId})
  `
  const { encryptTokens } = await import('../../../src/auth/security.js')
  await connection`
    insert into eve_tokens (character_id, encrypted_tokens, access_token_expires_at, scopes, token_version)
    values (${characterId}, ${encryptTokens({ accessToken: 'old-access', refreshToken: 'old-refresh' })},
      now() + interval '1 hour', jsonb_build_array(${scope}::text), 7)
  `
})

afterAll(async () => {
  await Promise.all([...dbConnections].map((sql) => sql.end()))
  await connection?.end()
  cache?.disconnect()
  coordination?.disconnect()
  await Promise.all(containers?.map((container) => container.stop()) ?? [])
})

const walletRead = async (name: string) => {
  const [{ operationRegistry }, { createCharacterEsiRead }, { sql }] = await Promise.all([
    import('@evespace/esi-client/operations'),
    import('../../../src/esi-gateway/feature-execution.js'),
    import('../../../src/db/client.js'),
  ])
  dbConnections.add(sql)
  return createCharacterEsiRead({
    cacheSchema: operationRegistry.GetCharactersCharacterIdWallet.responseSchema,
    descriptor: operationRegistry.GetCharactersCharacterIdWallet.transport,
    encodeRequest: (input: { characterId: number; subjectLifecycleId: string }) => ({
      path: { character_id: input.characterId },
    }),
    map: ({ data }) => data,
    name,
    operation: 'wallet-balance',
  })
}

const readWallet = (representation: Awaited<ReturnType<typeof walletRead>>) =>
  representation.execute({ characterId, subjectLifecycleId: lifecycleId })

describe('real character authorization before Redis cache lookup', () => {
  test.each(['l1', 'shared'] as const)(
    'recovers matching pending credentials before a fresh %s wallet hit',
    async (layer) => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(new Response('10', { headers: { 'cache-control': 'max-age=300' } }))
        .mockResolvedValueOnce(new Response('20', { headers: { 'cache-control': 'max-age=300' } }))
      vi.stubGlobal('fetch', fetch)
      let representation = await walletRead(`pending-wallet-${layer}`)
      await expect(readWallet(representation)).resolves.toMatchObject({ data: 10, source: 'esi' })
      await expect(readWallet(representation)).resolves.toMatchObject({ data: 10, source: 'cache' })
      expect(provider.verifyAccessToken).not.toHaveBeenCalled()

      let sharedHit: Awaited<ReturnType<typeof readWallet>> | null = null
      if (layer === 'shared') {
        await closeRuntimeConnections()
        vi.resetModules()
        representation = await walletRead(`pending-wallet-${layer}`)
        sharedHit = await readWallet(representation)
      }
      expect(sharedHit?.data ?? null).toBe(layer === 'shared' ? 10 : null)
      expect(sharedHit?.source ?? null).toBe(layer === 'shared' ? 'cache' : null)
      const { encryptTokens } = await import('../../../src/auth/security.js')
      await connection`
        insert into pending_character_tokens (
          character_id, user_id, subject_lifecycle_id, base_token_version,
          encrypted_tokens, access_token_expires_at
        ) values (
          ${characterId}, ${userId}, ${lifecycleId}, 7,
          ${encryptTokens({ accessToken: 'pending-access', refreshToken: 'pending-refresh' })},
          now() + interval '1 hour'
        )
      `
      provider.verifyAccessToken.mockRejectedValueOnce(
        new SsoTransportError(new Error('JWKS offline')),
      )
      await expect(readWallet(representation)).rejects.toThrow(
        'EVE token refresh is temporarily unavailable',
      )
      expect(fetch).toHaveBeenCalledOnce()
      expect(provider.refreshAccessToken).not.toHaveBeenCalled()

      provider.verifyAccessToken.mockResolvedValueOnce({
        characterId,
        ownerHash: 'owner-hash',
        characterName: 'Pilot',
        scopes: [scope],
      })
      await expect(readWallet(representation)).resolves.toMatchObject({ data: 20, source: 'esi' })
      await expect(readWallet(representation)).resolves.toMatchObject({ data: 20, source: 'cache' })
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(provider.verifyAccessToken).toHaveBeenCalledTimes(2)
      expect(provider.refreshAccessToken).not.toHaveBeenCalled()
      const [token] = await connection<{ token_version: number; encrypted_tokens: string }[]>`
        select token_version, encrypted_tokens from eve_tokens where character_id = ${characterId}
      `
      expect(token?.token_version).toBe(8)
      const redisValues = await Promise.all(
        [cache, coordination].map(async (client) => {
          const keys = await client.keys('*')
          return Promise.all(keys.map((key) => client.dump(key)))
        }),
      )
      const serializedRedis = redisValues
        .flat()
        .map((value) => value ?? '')
        .join('')
      expect(serializedRedis).not.toContain('pending-refresh')
      expect(serializedRedis).not.toContain('pending-access')
      expect(serializedRedis).not.toContain(token!.encrypted_tokens)
      const events = await connection<{ payload: unknown }[]>`select payload from domain_events`
      expect(JSON.stringify(events)).not.toContain('pending-refresh')
      expect(JSON.stringify(events)).not.toContain('pending-access')
    },
  )
})
