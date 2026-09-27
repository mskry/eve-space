import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { runMigrations } from '../../../src/db/migration-runner.js'
import { SsoTransportError } from '../../../src/auth/sso-errors.js'

const provider = vi.hoisted(() => ({ refreshAccessToken: vi.fn(), verifyAccessToken: vi.fn() }))
vi.mock('../../../src/auth/sso.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/auth/sso.js')>()),
  refreshAccessToken: provider.refreshAccessToken,
  verifyAccessToken: provider.verifyAccessToken,
}))

const runProcess = promisify(execFile)
const password = randomUUID()
const characterId = 90_000_004
const userId = randomUUID()
const lifecycleId = randomUUID()
const fixture = fileURLToPath(
  new URL('../../support/pending-token-recovery-process.ts', import.meta.url),
)
let container: StartedTestContainer
let connection: postgres.Sql
let dbClient: typeof import('../../../src/db/client.js')
let tokenService: typeof import('../../../src/auth/tokens.js')
let encryptTokens: (typeof import('../../../src/auth/security.js'))['encryptTokens']
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey']
let jwks: string

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
  const databaseUrl = `postgres://eve_space:${password}@${container.getHost()}:${container.getMappedPort(5432)}/eve_space`
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
    EVE_CLIENT_ID: 'test-client',
    EVE_CLIENT_SECRET: 'test-secret',
    TOKEN_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  })
  dbClient = await import('../../../src/db/client.js')
  tokenService = await import('../../../src/auth/tokens.js')
  encryptTokens = (await import('../../../src/auth/security.js')).encryptTokens
  const keys = await generateKeyPair('RS256')
  privateKey = keys.privateKey
  jwks = JSON.stringify({
    keys: [{ ...(await exportJWK(keys.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' }],
  })
})

beforeEach(async () => {
  provider.refreshAccessToken.mockReset()
  provider.verifyAccessToken.mockReset()
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
  await connection`
    insert into eve_tokens (character_id, encrypted_tokens, access_token_expires_at, scopes, token_version)
    values (${characterId}, ${encryptTokens({ accessToken: 'old-access', refreshToken: 'old-refresh' })},
      now() - interval '1 minute', '["scope.one"]'::jsonb, 7)
  `
})

afterAll(async () => {
  await dbClient?.sql.end()
  await connection?.end()
  await container?.stop()
})

const signedToken = async () =>
  new SignJWT({
    name: 'Pilot',
    owner: 'owner-hash',
    scp: 'scope.one',
    sub: `CHARACTER:EVE:${characterId}`,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer('https://login.eveonline.com')
    .setAudience(['EVE Online', 'test-client'])
    .setExpirationTime('5m')
    .sign(privateKey)

const createPendingAttempt = async (accessToken: string) => {
  provider.refreshAccessToken.mockResolvedValueOnce({
    access_token: accessToken,
    refresh_token: 'rotated-refresh',
    expires_in: 1200,
    token_type: 'Bearer',
  })
  provider.verifyAccessToken.mockRejectedValueOnce(new SsoTransportError(new Error('JWKS offline')))
  await expect(
    tokenService.getCharacterAuthorizationForLifecycle(characterId, lifecycleId, 'scope.one'),
  ).rejects.toMatchObject({ message: 'EVE token refresh is temporarily unavailable' })
}

describe('pending token recovery with PostgreSQL', () => {
  test('retains the rotation across an outage and verifies it in a new OS process', async () => {
    const accessToken = await signedToken()
    provider.refreshAccessToken.mockResolvedValueOnce({
      access_token: accessToken,
      refresh_token: 'rotated-refresh',
      expires_in: 1200,
      token_type: 'Bearer',
    })
    provider.verifyAccessToken.mockRejectedValueOnce(
      new SsoTransportError(new Error('JWKS offline')),
    )

    await expect(
      tokenService.getCharacterAuthorizationForLifecycle(characterId, lifecycleId, 'scope.one'),
    ).rejects.toMatchObject({ message: 'EVE token refresh is temporarily unavailable' })
    const [beforeRecovery] = await connection<
      { token_version: number; encrypted_tokens: string }[]
    >`
      select token_version, encrypted_tokens from eve_tokens where character_id = ${characterId}
    `
    expect(beforeRecovery?.token_version).toBe(7)
    const [pending] = await connection<{ encrypted_tokens: string }[]>`
      select encrypted_tokens from pending_character_tokens where character_id = ${characterId}
    `
    expect(pending?.encrypted_tokens).not.toContain('rotated-refresh')

    const { stdout, stderr } = await runProcess(process.execPath, ['--import', 'tsx', fixture], {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)),
      env: {
        ...process.env,
        TEST_CHARACTER_ID: String(characterId),
        TEST_LIFECYCLE_ID: lifecycleId,
        TEST_ACCESS_TOKEN: accessToken,
        TEST_JWKS: jwks,
        TEST_RUNTIME_ROLE: 'worker',
      },
      timeout: 30_000,
    })
    expect(stdout.trim()).toBe('{"tokenVersion":8}')
    expect(stderr).toBe('')
    expect(provider.refreshAccessToken).toHaveBeenCalledExactlyOnceWith('old-refresh')
    const [afterRecovery] = await connection<{ token_version: number }[]>`
      select token_version from eve_tokens where character_id = ${characterId}
    `
    expect(afterRecovery?.token_version).toBe(8)
    const [remaining] = await connection`select character_id from pending_character_tokens`
    expect(remaining).toBeUndefined()
  })

  test('retains a second rotation after another outage, then revokes on pending invalid_grant', async () => {
    const accessToken = await signedToken()
    provider.refreshAccessToken.mockResolvedValueOnce({
      access_token: accessToken,
      refresh_token: 'first-rotation',
      expires_in: 1200,
      token_type: 'Bearer',
    })
    provider.verifyAccessToken.mockRejectedValueOnce(
      new SsoTransportError(new Error('JWKS offline')),
    )
    await expect(
      tokenService.getCharacterAuthorizationForLifecycle(characterId, lifecycleId, 'scope.one'),
    ).rejects.toMatchObject({ message: 'EVE token refresh is temporarily unavailable' })
    await connection`
      update pending_character_tokens set access_token_expires_at = now() - interval '1 minute'
      where character_id = ${characterId}
    `
    provider.refreshAccessToken.mockResolvedValueOnce({
      access_token: accessToken,
      refresh_token: 'second-rotation',
      expires_in: 1200,
      token_type: 'Bearer',
    })
    provider.verifyAccessToken.mockRejectedValueOnce(
      new SsoTransportError(new Error('JWKS offline again')),
    )
    await expect(
      tokenService.getCharacterAuthorizationForLifecycle(characterId, lifecycleId, 'scope.one'),
    ).rejects.toMatchObject({ message: 'EVE token refresh is temporarily unavailable' })
    const [pending] = await connection<{ encrypted_tokens: string }[]>`
      select encrypted_tokens from pending_character_tokens where character_id = ${characterId}
    `
    const { decryptTokens } = await import('../../../src/auth/security.js')
    expect(decryptTokens(pending!.encrypted_tokens).refreshToken).toBe('second-rotation')
    await connection`
      update pending_character_tokens set access_token_expires_at = now() - interval '1 minute'
      where character_id = ${characterId}
    `
    const { EveSsoTokenRefreshError } = await import('../../../src/auth/sso.js')
    provider.refreshAccessToken.mockRejectedValueOnce(new EveSsoTokenRefreshError(400, true))
    await expect(
      tokenService.getCharacterAuthorizationForLifecycle(characterId, lifecycleId, 'scope.one'),
    ).rejects.toBeInstanceOf(EveSsoTokenRefreshError)
    expect(provider.refreshAccessToken.mock.calls.map(([refreshToken]) => refreshToken)).toEqual([
      'old-refresh',
      'first-rotation',
      'second-rotation',
    ])
    const [remaining] = await connection`select character_id from eve_tokens`
    expect(remaining).toBeUndefined()
    const [stillPending] = await connection`select character_id from pending_character_tokens`
    expect(stillPending).toBeUndefined()
  })

  test('only one of two independent verifiers promotes the same pending attempt', async () => {
    const accessToken = await signedToken()
    await createPendingAttempt(accessToken)

    let release: (() => void) | undefined
    const verificationGate = new Promise<void>((resolve) => {
      release = resolve
    })
    let verifiersStarted = 0
    provider.verifyAccessToken.mockImplementation(async () => {
      verifiersStarted += 1
      await verificationGate
      return { characterId, ownerHash: 'owner-hash', characterName: 'Pilot', scopes: ['scope.one'] }
    })
    const attempts = [
      tokenService.getCharacterAuthorizationForLifecycle(characterId, lifecycleId, 'scope.one'),
      tokenService.getCharacterAuthorizationForLifecycle(characterId, lifecycleId, 'scope.one'),
    ]
    try {
      await vi.waitFor(() => expect(verifiersStarted).toBe(2))
    } finally {
      release?.()
    }
    await expect(Promise.all(attempts)).resolves.toEqual([
      { accessToken, tokenVersion: 8 },
      { accessToken, tokenVersion: 8 },
    ])
    const [token] = await connection<{ token_version: number }[]>`
      select token_version from eve_tokens where character_id = ${characterId}
    `
    expect(token?.token_version).toBe(8)
    expect(provider.refreshAccessToken).toHaveBeenCalledOnce()
    const [remaining] = await connection`select character_id from pending_character_tokens`
    expect(remaining).toBeUndefined()
  })

  test.each([
    ['different character', characterId + 1, 'owner-hash', 'SsoTokenRejectedError'],
    ['different owner', characterId, 'other-owner', 'CharacterOwnerMismatchError'],
  ] as const)(
    'invalidates a verified %s without secret-bearing events',
    async (_case, verifiedId, ownerHash, errorName) => {
      await createPendingAttempt(await signedToken())
      provider.verifyAccessToken.mockResolvedValueOnce({
        characterId: verifiedId,
        ownerHash,
        characterName: 'Other',
        scopes: ['scope.one'],
      })

      await expect(
        tokenService.getCharacterAuthorizationForLifecycle(characterId, lifecycleId, 'scope.one'),
      ).rejects.toMatchObject({ name: errorName, status: 401 })
      const [remaining] = await connection`select character_id from eve_tokens`
      expect(remaining).toBeUndefined()
      const [stillPending] = await connection`select character_id from pending_character_tokens`
      expect(stillPending).toBeUndefined()
      const events = await connection<{ payload: unknown }[]>`select payload from domain_events`
      expect(JSON.stringify(events)).not.toContain('rotated-refresh')
      expect(JSON.stringify(events)).not.toContain('old-refresh')
    },
  )

  test('reauthorization fences an old verifier before it can revoke the replacement', async () => {
    await createPendingAttempt(await signedToken())
    let release: (() => void) | undefined
    const verificationGate = new Promise<void>((resolve) => {
      release = resolve
    })
    provider.verifyAccessToken.mockImplementationOnce(async () => {
      await verificationGate
      return {
        characterId: characterId + 1,
        ownerHash: 'owner-hash',
        characterName: 'Other',
        scopes: [],
      }
    })
    const obsolete = tokenService
      .getCharacterAuthorizationForLifecycle(characterId, lifecycleId, 'scope.one')
      .catch((error) => error)
    await vi.waitFor(() => expect(provider.verifyAccessToken).toHaveBeenCalledTimes(2))
    const { reauthorizeCharacter } = await import('../../../src/auth/character-lifecycle.js')
    const replacement = await reauthorizeCharacter({
      characterId,
      expectedCharacterId: characterId,
      userId,
      characterName: 'Pilot',
      corporationId: 1000166,
      allianceId: null,
      ownerHash: 'owner-hash',
      accessToken: 'replacement-access',
      refreshToken: 'replacement-refresh',
      expiresIn: 1200,
      scopes: ['scope.one'],
    })
    expect(replacement.outcome).toBe('reauthorized')
    release?.()
    await expect(obsolete).resolves.toMatchObject({
      message: 'EVE token refresh is temporarily unavailable',
    })
    const [current] = await connection<{ encrypted_tokens: string; token_version: number }[]>`
      select encrypted_tokens, token_version from eve_tokens where character_id = ${characterId}
    `
    const { decryptTokens } = await import('../../../src/auth/security.js')
    expect(decryptTokens(current!.encrypted_tokens).accessToken).toBe('replacement-access')
    expect(current?.token_version).toBe(8)
    const [stillPending] = await connection`select character_id from pending_character_tokens`
    expect(stillPending).toBeUndefined()
  })

  test('reports only the pending character as suspended and later observes committed recovery', async () => {
    const otherCharacterId = characterId + 1
    const otherLifecycleId = randomUUID()
    await connection`
      insert into characters (character_id, user_id, owner_hash, name, corporation_id)
      values (${otherCharacterId}, ${userId}, 'other-owner', 'Other Pilot', 1000166)
    `
    await connection`
      insert into platform_subject_lifecycles (subject_lifecycle_id, subject_kind, subject_id, character_id)
      values (${otherLifecycleId}, 'character', ${String(otherCharacterId)}, ${otherCharacterId})
    `
    await connection`
      insert into eve_tokens (character_id, encrypted_tokens, access_token_expires_at, scopes, token_version)
      values (${otherCharacterId}, 'other-encrypted-token', now() + interval '1 hour', '["scope.one"]'::jsonb, 3)
    `
    await createPendingAttempt(await signedToken())
    const { loadCacheAdmissionContext } = await import('../../../src/cache-admission/service.js')
    const { loadCharacterAdmissionFacts } = await import('../../../src/cache-admission/store.js')
    const scheduleRecovery = vi.fn()
    const load = () =>
      loadCacheAdmissionContext(userId, {
        loadCharacters: loadCharacterAdmissionFacts,
        loadOrganization: async () => null,
        scheduleRecovery,
      })
    const pending = await load()
    expect(pending.characters).toEqual([
      { characterId, status: 'temporarily-unavailable' },
      { characterId: otherCharacterId, admissionRevision: expect.any(String) },
    ])
    expect(scheduleRecovery).toHaveBeenCalledExactlyOnceWith(characterId, lifecycleId)
    expect(JSON.stringify(pending)).not.toContain('rotated-refresh')

    provider.verifyAccessToken.mockResolvedValueOnce({
      characterId,
      ownerHash: 'owner-hash',
      characterName: 'Pilot',
      scopes: ['scope.one'],
    })
    await tokenService.recoverPendingCharacterToken(characterId, lifecycleId)
    const recovered = await load()
    expect(recovered.characters).toEqual([
      { characterId, admissionRevision: expect.any(String) },
      pending.characters[1],
    ])
    expect(scheduleRecovery).toHaveBeenCalledOnce()
  })

  test('does not wait for slow SSO recovery during admission bootstrap', async () => {
    await createPendingAttempt(await signedToken())
    const { loadCacheAdmissionContext } = await import('../../../src/cache-admission/service.js')
    const { loadCharacterAdmissionFacts } = await import('../../../src/cache-admission/store.js')
    let release: (() => void) | undefined
    const providerGate = new Promise<void>((resolve) => {
      release = resolve
    })
    provider.verifyAccessToken.mockImplementationOnce(async () => {
      await providerGate
      return { characterId, ownerHash: 'owner-hash', characterName: 'Pilot', scopes: ['scope.one'] }
    })
    const started = Date.now()
    const first = await loadCacheAdmissionContext(userId, {
      loadCharacters: loadCharacterAdmissionFacts,
      loadOrganization: async () => null,
    })
    expect(Date.now() - started).toBeLessThan(1000)
    expect(first.characters).toEqual([{ characterId, status: 'temporarily-unavailable' }])
    await vi.waitFor(() => expect(provider.verifyAccessToken).toHaveBeenCalledTimes(2))
    const stillPending = await loadCacheAdmissionContext(userId, {
      loadCharacters: loadCharacterAdmissionFacts,
      loadOrganization: async () => null,
    })
    expect(stillPending.characters).toEqual(first.characters)
    expect(provider.verifyAccessToken).toHaveBeenCalledTimes(2)

    release?.()
    await vi.waitFor(async () => {
      const recovered = await loadCacheAdmissionContext(userId, {
        loadCharacters: loadCharacterAdmissionFacts,
        loadOrganization: async () => null,
      })
      expect(recovered.characters).toEqual([{ characterId, admissionRevision: expect.any(String) }])
    })
  })
})
