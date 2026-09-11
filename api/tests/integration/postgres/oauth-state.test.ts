import { createHash, randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { loadMigrations, runMigrations } from '../../../src/db/migration-runner.js'

let container: StartedTestContainer
let connection: postgres.Sql
let oauthStateStore: typeof import('../../../src/auth/oauth-state-store.js')
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
  const loginReturnPathMigrationIndex = migrations.findIndex(
    ({ name }) => name === '025_login_oauth_return_path.sql',
  )
  if (returnPathMigrationIndex < 0) throw new Error('OAuth return-path migration is missing')
  if (loginReturnPathMigrationIndex < 0)
    throw new Error('Login OAuth return-path migration is missing')
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
  await runMigrations(connection, [migrations[loginReturnPathMigrationIndex]!])

  oauthStateStore = await import('../../../src/auth/oauth-state-store.js')
  dbClient = await import('../../../src/db/client.js')
})

beforeEach(async () => {
  await connection`
    truncate character_transfer_audit, character_transfer_approvals, character_transfer_previews,
      oauth_states, sessions, eve_tokens, platform_subject_lifecycles, characters, users
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

  test('enforces the return-path bound and login-or-reauthorization context constraint', async () => {
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

    await oauthStateStore.storeOAuthState(state, {
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
    await expect(oauthStateStore.consumeOAuthState(state)).resolves.toEqual({
      intent: 'reauthorize',
      userId,
      characterId,
      returnPath,
    })
    await expect(oauthStateStore.consumeOAuthState(state)).resolves.toBeNull()
    const [remaining] = await connection<{ count: number }[]>`
      select count(*)::integer as count from oauth_states
    `
    expect(remaining?.count).toBe(0)
  })

  test('atomically round-trips a login return path', async () => {
    const state = 'login-oauth-state'
    const returnPath = `/characters/${characterId}?tab=wallet#activity`

    await oauthStateStore.storeOAuthState(state, { intent: 'login', returnPath })

    await expect(oauthStateStore.consumeOAuthState(state)).resolves.toEqual({
      intent: 'login',
      returnPath,
    })
    await expect(oauthStateStore.consumeOAuthState(state)).resolves.toBeNull()
  })

  test('preserves legacy omitted paths and stores null for other intents', async () => {
    const userId = await insertOwnedCharacter()
    await oauthStateStore.storeOAuthState('legacy-reauthorization', {
      intent: 'reauthorize',
      userId,
      characterId,
    })
    await oauthStateStore.storeOAuthState('login-state', { intent: 'login' })
    const rows = await connection<{ intent: string; return_path: string | null }[]>`
      select intent, return_path from oauth_states order by intent
    `

    expect(rows).toEqual([
      { intent: 'login', return_path: null },
      { intent: 'reauthorize', return_path: null },
    ])
    await expect(oauthStateStore.consumeOAuthState('legacy-reauthorization')).resolves.toEqual({
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
    await oauthStateStore.storeOAuthState('concurrent-state', context)

    const results = await Promise.all([
      oauthStateStore.consumeOAuthState('concurrent-state'),
      oauthStateStore.consumeOAuthState('concurrent-state'),
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
    await oauthStateStore.storeOAuthState('owner-claim-state', context)

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
      oauthStateStore.consumeOAuthState('owner-claim-state'),
      oauthStateStore.consumeOAuthState('owner-claim-state'),
    ])
    expect(results.filter(Boolean)).toEqual([context])
    expect(results.filter((result) => result === null)).toHaveLength(1)
  })

  test('round-trips an exact single-use transfer context without storing the raw state', async () => {
    const sourceUserId = await insertOwnedCharacter()
    const [sourceLifecycle] = await connection<{ subject_lifecycle_id: string }[]>`
      insert into platform_subject_lifecycles (subject_kind, subject_id, character_id)
      values ('character', ${String(characterId)}, ${characterId})
      returning subject_lifecycle_id
    `
    const destinationUserId = randomUUID()
    const destinationCharacterId = 2_112_625_428
    await connection`insert into users (id) values (${destinationUserId})`
    await connection`
      insert into characters (character_id, user_id, name, corporation_id, is_main)
      values (${destinationCharacterId}, ${destinationUserId}, 'Destination Pilot', 1000166, true)
    `
    const approvalId = await insertTransferApproval({
      sourceUserId,
      sourceSubjectLifecycleId: sourceLifecycle!.subject_lifecycle_id,
      destinationUserId,
      destinationMainCharacterId: destinationCharacterId,
    })
    const context = {
      intent: 'transfer' as const,
      approvalId,
      sourceUserId,
      sourceSubjectLifecycleId: sourceLifecycle!.subject_lifecycle_id,
      userId: destinationUserId,
      characterId,
    }

    await oauthStateStore.storeOAuthState('transfer-state', context)
    const [stored] = await connection<
      {
        state_hash: string
        transfer_approval_id: string
        transfer_source_user_id: string
        transfer_source_subject_lifecycle_id: string
      }[]
    >`
      select state_hash, transfer_approval_id, transfer_source_user_id,
        transfer_source_subject_lifecycle_id
      from oauth_states
      where intent = 'transfer'
    `

    expect(stored).toEqual({
      state_hash: hashState('transfer-state'),
      transfer_approval_id: approvalId,
      transfer_source_user_id: sourceUserId,
      transfer_source_subject_lifecycle_id: sourceLifecycle!.subject_lifecycle_id,
    })
    await expect(oauthStateStore.consumeOAuthState('transfer-state')).resolves.toEqual(context)
    await expect(oauthStateStore.consumeOAuthState('transfer-state')).resolves.toBeNull()
  })

  test('enforces immutable terminal approvals and append-only independent audit', async () => {
    const sourceUserId = await insertOwnedCharacter()
    const [sourceLifecycle] = await connection<{ subject_lifecycle_id: string }[]>`
      insert into platform_subject_lifecycles (subject_kind, subject_id, character_id)
      values ('character', ${String(characterId)}, ${characterId})
      returning subject_lifecycle_id
    `
    const destinationUserId = randomUUID()
    const destinationCharacterId = 2_112_625_428
    await connection`insert into users (id) values (${destinationUserId})`
    await connection`
      insert into characters (character_id, user_id, name, corporation_id, is_main)
      values (${destinationCharacterId}, ${destinationUserId}, 'Destination Pilot', 1000166, true)
    `
    const approvalId = await insertTransferApproval({
      sourceUserId,
      sourceSubjectLifecycleId: sourceLifecycle!.subject_lifecycle_id,
      destinationUserId,
      destinationMainCharacterId: destinationCharacterId,
    })
    const administratorId = randomUUID()
    const auditId = randomUUID()
    await connection`
      insert into character_transfer_audit (
        audit_id, approval_id, action, approved_by_administrator_id,
        action_administrator_id, character_id, source_user_id,
        source_subject_lifecycle_id, destination_user_id, reason, outcome
      ) values (
        ${auditId}, ${approvalId}, 'created', ${administratorId}, ${administratorId},
        ${characterId}, ${sourceUserId}, ${sourceLifecycle!.subject_lifecycle_id},
        ${destinationUserId}, 'Repair split account', 'created'
      )
    `

    await expect(
      connection`
        update character_transfer_approvals
        set reason = 'Changed reason'
        where approval_id = ${approvalId}
      `,
    ).rejects.toThrow('character transfer approval bindings are immutable')
    await expect(
      connection`update character_transfer_audit set reason = 'Changed' where audit_id = ${auditId}`,
    ).rejects.toThrow('character transfer audit is append-only')

    await connection`delete from users where id = ${sourceUserId}`
    const [retainedApproval] = await connection<{ source_user_id: string }[]>`
      select source_user_id from character_transfer_approvals where approval_id = ${approvalId}
    `
    const [retainedAudit] = await connection<{ source_user_id: string }[]>`
      select source_user_id from character_transfer_audit where audit_id = ${auditId}
    `
    expect(retainedApproval?.source_user_id).toBe(sourceUserId)
    expect(retainedAudit?.source_user_id).toBe(sourceUserId)
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

async function insertTransferApproval(input: {
  sourceUserId: string
  sourceSubjectLifecycleId: string
  destinationUserId: string
  destinationMainCharacterId: number
}) {
  const approvalId = randomUUID()
  await connection`
    insert into character_transfer_approvals (
      approval_id, link_secret_hash, character_id, character_name, source_user_id,
      source_subject_lifecycle_id, source_character_count, destination_user_id,
      destination_main_character_id, destination_main_character_name,
      approved_by_administrator_id, reason, created_at, expires_at
    ) values (
      ${approvalId}, ${'d'.repeat(64)}, ${characterId}, 'OAuth Pilot', ${input.sourceUserId},
      ${input.sourceSubjectLifecycleId}, 1, ${input.destinationUserId},
      ${input.destinationMainCharacterId}, 'Destination Pilot', ${randomUUID()},
      'Repair split account', now(), now() + interval '15 minutes'
    )
  `
  return approvalId
}
