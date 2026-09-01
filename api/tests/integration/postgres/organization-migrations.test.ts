import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { loadMigrations, runMigrations } from '../../../src/db/migration-runner.js'

let container: StartedTestContainer
let connection: postgres.Sql
const databasePassword = randomUUID()
const adminId = randomUUID()
const userId = randomUUID()
const characterId = 1_404_328_063
const encryptedTokens = 'v1.encrypted-token-envelope'
const scopes = ['esi-location.read_location.v1', 'esi-skills.read_skills.v1']

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
  connection = postgres(
    `postgres://eve_space:${databasePassword}@${container.getHost()}:${container.getMappedPort(5432)}/eve_space`,
    { onnotice: () => {} },
  )
  await waitForDatabase()

  const migrations = await loadMigrations()
  const organizationMigrationIndex = migrations.findIndex(
    ({ name }) => name === '021_organization_policy.sql',
  )
  if (organizationMigrationIndex < 0) throw new Error('Organization policy migration is missing')
  await runMigrations(connection, migrations.slice(0, organizationMigrationIndex))
  await seedLegacyDeployment()
  await runMigrations(connection, migrations.slice(organizationMigrationIndex))
})

afterAll(async () => {
  await connection?.end()
  await container?.stop()
})

describe('organization foundation migration', () => {
  test('preserves existing character and token data while initializing a locked organization epoch', async () => {
    const [settings] = await connection<
      {
        organization_version: string
        strict_remediation_duration_seconds: number
        stale_evidence_grace_duration_seconds: number
        required_registration_scopes: string[]
        registration_policy_version: string
      }[]
    >`
      select
        organization_version,
        strict_remediation_duration_seconds,
        stale_evidence_grace_duration_seconds,
        required_registration_scopes,
        registration_policy_version
      from deployment_settings
      where id = 1
    `
    const [epoch] = await connection<
      { organization_version: string; organization_type: string; organization_id: string }[]
    >`
      select organization_version, organization_type, organization_id
      from organization_epochs
      where deployment_id = 1
    `
    const [character] = await connection<
      { character_id: string; user_id: string; corporation_id: string }[]
    >`
      select character_id, user_id, corporation_id from characters where character_id = ${characterId}
    `
    const [token] = await connection<
      { encrypted_tokens: string; scopes: string[]; token_version: number }[]
    >`
      select encrypted_tokens, scopes, token_version from eve_tokens where character_id = ${characterId}
    `
    const [ownerGrants] = await connection<{ count: number }[]>`
      select count(*)::integer as count
      from organization_role_grants
      where role = 'organization_owner' and revoked_at is null
    `

    expect(settings).toEqual({
      organization_version: '1',
      strict_remediation_duration_seconds: 0,
      stale_evidence_grace_duration_seconds: 3600,
      required_registration_scopes: [],
      registration_policy_version: '1',
    })
    expect(epoch).toEqual({
      organization_version: '1',
      organization_type: 'corporation',
      organization_id: '98000001',
    })
    expect(character).toEqual({
      character_id: String(characterId),
      user_id: userId,
      corporation_id: '98000001',
    })
    expect(token).toEqual({ encrypted_tokens: encryptedTokens, scopes, token_version: 7 })
    expect(ownerGrants?.count).toBe(0)
  })

  test('rejects foreign references that mix organization versions', async () => {
    await connection`
      insert into organization_epochs (
        deployment_id,
        organization_version,
        organization_type,
        organization_id,
        organization_name,
        organization_ticker
      ) values (1, 2, 'corporation', 98000002, 'Future Corporation', 'NEXT')
    `

    await expect(
      connection`
        insert into organization_corporation_sources (
          deployment_id,
          organization_version,
          corporation_id,
          character_id,
          evidence_character_id,
          registered_by_user_id
        ) values (1, 2, 98000001, ${characterId}, ${characterId}, ${userId})
      `,
    ).rejects.toMatchObject({
      code: '23503',
      constraint_name: 'organization_corporation_sources_managed_corporation_fkey',
    })

    const [bundle] = await connection<{ bundle_id: string }[]>`
      insert into organization_permission_bundles (
        deployment_id,
        organization_version,
        name,
        created_by_user_id
      ) values (1, 1, 'Current bundle', ${userId})
      returning bundle_id
    `
    const [group] = await connection<{ group_id: string }[]>`
      insert into organization_groups (
        deployment_id,
        organization_version,
        name,
        created_by_user_id
      ) values (1, 2, 'Future group', ${userId})
      returning group_id
    `
    await expect(
      connection`
        insert into organization_group_permission_bundles (
          group_id,
          bundle_id,
          deployment_id,
          organization_version
        ) values (${group!.group_id}, ${bundle!.bundle_id}, 1, 2)
      `,
    ).rejects.toMatchObject({
      code: '23503',
      constraint_name: 'organization_group_permission_bundles_bundle_fkey',
    })
    await expect(
      connection`
        insert into organization_groups (
          deployment_id,
          organization_version,
          name,
          management_mode,
          compliance_source,
          created_by_user_id
        ) values (1, 1, 'Unsupported source', 'compliance', 'module.untrusted', ${userId})
      `,
    ).rejects.toMatchObject({
      code: '23514',
      constraint_name: 'organization_groups_management_check',
    })

    await expect(
      connection`
        insert into organization_member_blocks (
          deployment_id,
          organization_version,
          user_id,
          blocked_by_user_id,
          reason,
          unblocked_at
        ) values (1, 2, ${userId}, ${userId}, 'Invalid partial unblock.', now())
      `,
    ).rejects.toMatchObject({
      code: '23514',
      constraint_name: 'organization_member_blocks_unblock_check',
    })
  })
})

async function seedLegacyDeployment() {
  await connection`
    insert into deployment_admins (id, email, password_hash)
    values (${adminId}, 'owner@example.com', 'legacy-password-hash')
  `
  await connection`
    insert into deployment_settings (
      id,
      owner_admin_id,
      organization_type,
      organization_id,
      organization_name,
      organization_ticker
    ) values (1, ${adminId}, 'corporation', 98000001, 'Legacy Corporation', 'OLD')
  `
  await connection`insert into users (id) values (${userId})`
  await connection`
    insert into characters (character_id, user_id, name, corporation_id, is_main)
    values (${characterId}, ${userId}, 'Legacy Pilot', 98000001, true)
  `
  await connection`
    insert into eve_tokens (
      character_id,
      encrypted_tokens,
      access_token_expires_at,
      scopes,
      token_version
    ) values (
      ${characterId},
      ${encryptedTokens},
      now() + interval '20 minutes',
      ${connection.json(scopes)},
      7
    )
  `
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
