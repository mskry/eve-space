import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { runMigrations } from '../../../src/db/migration-runner.js'
import { waitForDatabase } from './wait-for-database.js'

let container: StartedTestContainer
let connection: postgres.Sql
const databasePassword = randomUUID()
const adminId = randomUUID()
const userId = randomUUID()
const sourceId = randomUUID()
const characterSubjectLifecycleId = randomUUID()
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
  await waitForDatabase(connection)

  await runMigrations(connection)
  await seedCurrentDeployment()
})

afterAll(async () => {
  await connection?.end()
  await container?.stop()
})

describe('organization foundation migration', () => {
  test('supports publisher-bound module permissions while retaining unattributed legacy rows', async () => {
    const [bundle] = await connection<{ bundle_id: string }[]>`
      insert into organization_permission_bundles (
        deployment_id, organization_version, name, created_by_user_id
      ) values (1, 1, 'Migration ownership', ${userId})
      returning bundle_id
    `
    if (!bundle) {
      throw new Error('Permission bundle fixture is missing')
    }

    await connection`
      insert into organization_permission_bundle_entries (
        bundle_id, deployment_id, organization_version, permission_type, permission_key
      ) values (${bundle.bundle_id}, 1, 1, 'module', 'legacy.permission')
    `
    await connection`
      insert into organization_permission_bundle_entries (
        bundle_id, deployment_id, organization_version, permission_type, permission_key,
        publisher_package, module_id
      ) values
        (${bundle.bundle_id}, 1, 1, 'module', 'alpha.view', '@example/alpha-manifest', 'alpha'),
        (${bundle.bundle_id}, 1, 1, 'module', 'alpha.view', '@replacement/alpha-manifest', 'alpha')
    `

    const rows = await connection<
      { permission_key: string; publisher_package: string | null; module_id: string | null }[]
    >`
      select permission_key, publisher_package, module_id
      from organization_permission_bundle_entries
      where bundle_id = ${bundle.bundle_id}
      order by permission_key, publisher_package nulls first
    `
    expect([...rows]).toStrictEqual([
      {
        module_id: 'alpha',
        permission_key: 'alpha.view',
        publisher_package: '@example/alpha-manifest',
      },
      {
        module_id: 'alpha',
        permission_key: 'alpha.view',
        publisher_package: '@replacement/alpha-manifest',
      },
      { module_id: null, permission_key: 'legacy.permission', publisher_package: null },
    ])
    await expect(
      connection`
        insert into organization_permission_bundle_entries (
          bundle_id, deployment_id, organization_version, permission_type, permission_key,
          publisher_package, module_id
        ) values (${bundle.bundle_id}, 1, 1, 'service', 'discord.access', '@example/service', 'alpha')
      `,
    ).rejects.toMatchObject({
      code: '23514',
      constraint_name: 'organization_permission_bundle_entries_ownership_check',
    })
  })

  test('supports character and token data within a locked organization epoch', async () => {
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
    const [installation] = await connection<{ owner_admin_id: string | null }[]>`
      select owner_admin_id from deployment_installation_settings where id = 1
    `
    const [settingsOwnerColumn] = await connection<{ present: boolean }[]>`
      select exists(
        select 1 from information_schema.columns
        where table_name = 'deployment_settings' and column_name = 'owner_admin_id'
      ) as present
    `

    expect(settings).toStrictEqual({
      organization_version: '1',
      registration_policy_version: '1',
      required_registration_scopes: [],
      stale_evidence_grace_duration_seconds: 3600,
      strict_remediation_duration_seconds: 0,
    })
    expect(epoch).toStrictEqual({
      organization_id: '98000001',
      organization_type: 'corporation',
      organization_version: '1',
    })
    expect(character).toStrictEqual({
      character_id: String(characterId),
      corporation_id: '98000001',
      user_id: userId,
    })
    expect(token).toStrictEqual({ encrypted_tokens: encryptedTokens, scopes, token_version: 7 })
    expect(ownerGrants?.count).toBe(0)
    expect(installation?.owner_admin_id).toBe(adminId)
    expect(settingsOwnerColumn?.present).toBe(false)
  })

  test('requires roster observations to identify a valid authorization generation', async () => {
    await expect(
      connection`
        insert into organization_corporation_roster_observations (
          deployment_id,
          organization_version,
          corporation_id,
          character_id,
          source_id,
          observed_at
        ) values (1, 1, 98000001, 90000001, ${sourceId}, now())
      `,
    ).rejects.toMatchObject({ code: '23502', column_name: 'authorization_generation' })
    await expect(
      connection`
        insert into organization_corporation_roster_observations (
          deployment_id,
          organization_version,
          corporation_id,
          character_id,
          source_id,
          authorization_generation,
          observed_at
        ) values (1, 1, 98000001, 90000001, ${sourceId}, -1, now())
      `,
    ).rejects.toMatchObject({
      code: '23514',
      constraint_name: 'organization_corporation_roster_authorization_generation_check',
    })
  })

  test('requires complete authority provenance and coherent freshness deadlines', async () => {
    const nullability = await connection<{ table_name: string; column_name: string }[]>`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
        and (
           (table_name = 'organization_authority_evidence'
             and column_name = 'director_role_present')
           or (table_name = 'organization_corporation_sources'
             and column_name = 'director_role_present')
        )
        and is_nullable = 'NO'
      order by table_name, column_name
    `
    expect([...nullability]).toStrictEqual([
      {
        column_name: 'director_role_present',
        table_name: 'organization_authority_evidence',
      },
      {
        column_name: 'director_role_present',
        table_name: 'organization_corporation_sources',
      },
    ])

    await expect(
      connection`
        insert into organization_derived_authority_sources (
          deployment_id,
          organization_version,
          user_id,
          character_id,
          source_subject_lifecycle_id,
          authority_corporation_id,
          observed_corporation_id,
          authorization_generation,
          required_scope,
          role_evidence_revision,
          director_role_present,
          observed_at,
          fresh_until,
          status
        ) values (
          1, 1, ${userId}, ${characterId}, ${characterSubjectLifecycleId}, 98000001,
          98000001, 7, 'esi-characters.read_corporation_roles.v1', 'deadline-test', true,
          now(), now(), 'fresh'
        )
      `,
    ).rejects.toMatchObject({
      code: '23514',
      constraint_name: 'organization_derived_authority_sources_deadline_check',
    })

    await expect(
      connection`
        insert into organization_authority_evidence (
          grant_id, deployment_id, organization_version, user_id, character_id
        ) values (${randomUUID()}, 1, 1, ${userId}, ${characterId})
      `,
    ).rejects.toMatchObject({
      code: '23514',
      constraint_name: 'authority_source_character_lifecycle_check',
    })

    await expect(
      connection`
        insert into organization_derived_authority_sources (
          deployment_id,
          organization_version,
          user_id,
          character_id,
          source_subject_lifecycle_id,
          authority_corporation_id,
          observed_corporation_id,
          authorization_generation,
          required_scope,
          role_evidence_revision,
          director_role_present,
          observed_at,
          fresh_until,
          status
        ) values (
          1, 1, ${userId}, ${characterId}, ${randomUUID()}, 98000001,
          98000001, 7, 'esi-characters.read_corporation_roles.v1', 'invalid-lifecycle', true,
          now(), now() + interval '1 hour', 'fresh'
        )
      `,
    ).rejects.toMatchObject({
      code: '23514',
      constraint_name: 'authority_source_character_lifecycle_check',
    })

    await expect(
      connection`
        insert into organization_derived_authority_sources (
          deployment_id,
          organization_version,
          user_id,
          character_id,
          source_subject_lifecycle_id,
          authority_corporation_id,
          observed_corporation_id,
          authorization_generation,
          required_scope,
          role_evidence_revision,
          director_role_present,
          observed_at,
          fresh_until,
          status,
          failure_class,
          invalidated_at
        ) values (
          1, 1, ${userId}, ${characterId}, ${characterSubjectLifecycleId}, 98000001,
          98000001, 7, 'esi-characters.read_corporation_roles.v1', 'missing-outcome', false,
          now(), now() + interval '1 hour', 'invalid', 'strict:not-director', now()
        )
      `,
    ).rejects.toMatchObject({
      code: '23514',
      constraint_name: 'organization_derived_authority_sources_state_check',
    })
  })

  test('retains historical derived-source attribution while enforcing one current lifecycle source', async () => {
    const insertDerivedSource = (roleEvidenceRevision: string) =>
      connection<{ source_id: string }[]>`
        insert into organization_derived_authority_sources (
          deployment_id,
          organization_version,
          user_id,
          character_id,
          source_subject_lifecycle_id,
          authority_corporation_id,
          observed_corporation_id,
          authorization_generation,
          required_scope,
          role_evidence_revision,
          director_role_present,
          observed_at,
          fresh_until,
          status
        ) values (
          1,
          1,
          ${userId},
          ${characterId},
          ${characterSubjectLifecycleId},
          98000001,
          98000001,
          7,
          'esi-characters.read_corporation_roles.v1',
          ${roleEvidenceRevision},
          true,
          now(),
          now() + interval '1 hour',
          'fresh'
        )
        returning source_id
      `
    const revision = 'roles-observed-at-2026-09-21T00:00:00.000Z'
    const [source] = await insertDerivedSource(revision)
    if (!source) {
      throw new Error('Derived authority source fixture is missing')
    }

    await expect(insertDerivedSource(revision)).rejects.toMatchObject({ code: '23505' })

    await connection`
      update organization_derived_authority_sources
      set status = 'invalid',
          failure_class = 'strict:source-replaced',
          invalidated_at = now(),
          invalidation_outcome = 'source-replaced'
      where source_id = ${source.source_id}
    `
    await expect(insertDerivedSource(revision)).rejects.toMatchObject({
      code: '23505',
      constraint_name: 'organization_derived_authority_sources_lifecycle_key',
    })
    const [replacement] = await insertDerivedSource('roles-observed-at-2026-09-21T01:00:00.000Z')
    expect(replacement?.source_id).toBeDefined()
    await expect(
      insertDerivedSource('roles-observed-at-2026-09-21T02:00:00.000Z'),
    ).rejects.toMatchObject({ code: '23505' })
    const [history] = await connection<{ current_count: number; historical_count: number }[]>`
      select
        count(*) filter (where invalidated_at is null)::integer as current_count,
        count(*) filter (where invalidated_at is not null)::integer as historical_count
      from organization_derived_authority_sources
      where user_id = ${userId} and source_subject_lifecycle_id = ${characterSubjectLifecycleId}
    `
    expect(history).toStrictEqual({ current_count: 1, historical_count: 1 })
  })

  test('retains immutable corporation-source attribution after its live character is deleted', async () => {
    const historicalUserId = randomUUID()
    const historicalCharacterId = characterId + 1
    const historicalLifecycleId = randomUUID()
    const historicalSourceId = randomUUID()
    await connection`insert into users (id) values (${historicalUserId})`
    await connection`
      insert into characters (character_id, user_id, owner_hash, name, corporation_id, is_main)
      values (
        ${historicalCharacterId}, ${historicalUserId}, 'historical-owner', 'Historical Pilot',
        98000001, true
      )
    `
    await connection`
      insert into platform_subject_lifecycles (
        subject_lifecycle_id, subject_kind, subject_id, character_id
      ) values (
        ${historicalLifecycleId}, 'character', ${String(historicalCharacterId)},
        ${historicalCharacterId}
      )
    `
    await connection`
      insert into organization_corporation_sources (
        source_id, deployment_id, organization_version, corporation_id, character_id,
        evidence_character_id, source_user_id, source_subject_lifecycle_id,
        authorization_generation, role_evidence_revision, observed_corporation_id,
        required_scope, director_role_present, observed_at, fresh_until, status,
        failure_class, invalidated_at, invalidation_outcome, registered_by_user_id,
        revoked_at, revoked_by_user_id, revocation_reason
      ) values (
        ${historicalSourceId}, 1, 1, 98000001, ${historicalCharacterId},
        ${historicalCharacterId}, ${historicalUserId}, ${historicalLifecycleId}, 3,
        'historical-role-evidence', 98000001,
        'esi-corporations.read_corporation_membership.v1', true,
        now() - interval '2 hours', now() - interval '1 hour', 'invalid',
        'strict:source-replaced', now(), 'source-replaced', ${userId}, now(), ${userId},
        'Explicitly replaced before character deletion.'
      )
    `

    await connection`delete from characters where character_id = ${historicalCharacterId}`

    const [historical] = await connection<
      { character_id: string | null; evidence_character_id: string; source_user_id: string }[]
    >`
      select character_id, evidence_character_id, source_user_id
      from organization_corporation_sources
      where source_id = ${historicalSourceId}
    `
    expect(historical).toStrictEqual({
      character_id: null,
      evidence_character_id: String(historicalCharacterId),
      source_user_id: historicalUserId,
    })
  })

  test('stores roster collection state for the current source lifecycle', async () => {
    const [source] = await connection<{ source_id: string }[]>`
      select source_id
      from organization_corporation_sources
      where deployment_id = 1 and organization_version = 1 and corporation_id = 98000001
      limit 1
    `
    if (!source) {
      throw new Error('Corporation source fixture is missing')
    }
    const [lifecycle] = await connection<{ subject_lifecycle_id: string }[]>`
      insert into platform_subject_lifecycles (
        subject_kind,
        subject_id,
        corporation_source_id
      ) values ('corporation', '98000001', ${source.source_id})
      on conflict (corporation_source_id) do update set subject_id = excluded.subject_id
      returning subject_lifecycle_id
    `
    if (!lifecycle) {
      throw new Error('Corporation lifecycle fixture is missing')
    }
    await connection`
      insert into platform_collection_state (
        module_id,
        resource_id,
        subject_kind,
        subject_lifecycle_id,
        subject_id,
        next_eligible_at,
        authorization_generation,
        validated_at
      ) values (
        'core',
        'corporation-roster',
        'corporation',
        ${lifecycle.subject_lifecycle_id},
        '98000001',
        now() + interval '1 hour',
        7,
        now()
      )
    `
    const [state] = await connection<{ count: number }[]>`
      select count(*)::integer as count
      from platform_collection_state
      where module_id = 'core'
        and resource_id = 'corporation-roster'
        and subject_kind = 'corporation'
    `
    expect(state?.count).toBe(1)
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
          source_user_id,
          source_subject_lifecycle_id,
          authorization_generation,
          role_evidence_revision,
          observed_corporation_id,
          required_scope,
          director_role_present,
          observed_at,
          fresh_until,
          status,
          registered_by_user_id
        ) values (
          1, 2, 98000001, ${characterId}, ${characterId}, ${userId},
          ${characterSubjectLifecycleId}, 7, 'foreign-version-evidence', 98000001,
          'esi-corporations.read_corporation_membership.v1', true, now(),
          now() + interval '1 hour', 'fresh', ${userId}
        )
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

  test('requires every compliant projection to carry an explicit access-validity boundary', async () => {
    await expect(
      connection`
        insert into organization_account_compliance (
          deployment_id, organization_version, user_id, state, evidence_freshness, evidence_at
        ) values (1, 1, ${userId}, 'compliant', 'fresh', now())
      `,
    ).rejects.toMatchObject({
      code: '23514',
      constraint_name: 'organization_account_compliance_access_validity_check',
    })

    await expect(
      connection`
        insert into organization_account_compliance (
          deployment_id, organization_version, user_id, state, evidence_freshness,
          evidence_at, access_valid_until, established_compliant_at
        ) values (1, 1, ${userId}, 'compliant', 'fresh', now(), now() + interval '1 hour', now())
      `,
    ).resolves.toBeDefined()

    const reviewUserId = randomUUID()
    await connection`insert into users (id) values (${reviewUserId})`
    await expect(
      connection`
        insert into organization_account_compliance (
          deployment_id, organization_version, user_id, state, evidence_freshness,
          evidence_at, review_deadline, access_valid_until, established_compliant_at
        ) values (
          1, 1, ${reviewUserId}, 'review_required', 'fresh', now(),
          now() + interval '1 hour', now() + interval '1 hour', now()
        )
      `,
    ).resolves.toBeDefined()
  })

  test('keeps rule-managed assignments source-bound without changing manual groups', async () => {
    const [before] = await connection<{ count: number }[]>`
      select count(*)::integer as count from organization_group_assignments
      where assignment_source = 'rule'
    `
    expect(before?.count).toBe(0)

    await expect(
      connection`
        insert into organization_groups (
          deployment_id, organization_version, name, management_mode, restricted, created_by_user_id
        ) values (1, 1, 'Rule without definition', 'rule', true, ${userId})
      `,
    ).rejects.toMatchObject({ code: 'P0001' })

    const [group] = await connection.begin(async (transaction) => {
      const [created] = await transaction<{ group_id: string }[]>`
        insert into organization_groups (
          deployment_id, organization_version, name, management_mode, restricted, created_by_user_id
        ) values (1, 1, 'Reviewed director group', 'rule', true, ${userId})
        returning group_id
      `
      await transaction`
        insert into organization_group_rules (
          group_id, deployment_id, organization_version, revision,
          condition_kind, enabled, updated_by_user_id
        ) values (${created!.group_id}, 1, 1, 1, 'director-audience', true, ${userId})
      `
      await transaction`
        insert into organization_group_rule_revisions (
          group_id, deployment_id, organization_version, revision,
          condition_kind, enabled, bundle_ids, changed_by_user_id
        ) values (${created!.group_id}, 1, 1, 1, 'director-audience', true,
          ${[randomUUID()]}, ${userId})
      `
      return [created]
    })

    await expect(
      connection`
        insert into organization_group_assignments (
          deployment_id, organization_version, group_id, user_id,
          assignment_source, assigned_actor_type, assigned_by_user_id, reason
        ) values (1, 1, ${group!.group_id}, ${userId}, 'manual', 'user', ${userId}, 'Bypass rule')
      `,
    ).rejects.toMatchObject({ code: 'P0001' })

    const [assignment] = await connection<{ assignment_id: string }[]>`
      insert into organization_group_assignments (
        deployment_id, organization_version, group_id, user_id, assignment_source,
        assigned_actor_type, rule_revision, expires_at, reason
      ) values (
        1, 1, ${group!.group_id}, ${userId}, 'rule', 'system', 1,
        now() + interval '1 hour', 'Current rule evidence'
      ) returning assignment_id
    `
    await connection`
      insert into organization_group_rule_attestations (
        assignment_id, source_kind, source_id, valid_until
      ) values (${assignment!.assignment_id}, 'explicit-director', ${randomUUID()},
        now() + interval '1 hour')
    `
    const anotherUserId = randomUUID()
    await connection`insert into users (id) values (${anotherUserId})`
    await expect(
      connection`
        insert into organization_group_assignments (
          deployment_id, organization_version, group_id, user_id, assignment_source,
          assigned_actor_type, rule_revision, expires_at, reason
        ) values (
          1, 1, ${group!.group_id}, ${anotherUserId}, 'rule', 'system', 2,
          now() + interval '1 hour', 'Unknown revision'
        )
      `,
    ).rejects.toMatchObject({ code: '23503' })

    await expect(
      connection`
        update organization_group_rules set revision = 2 where group_id = ${group!.group_id}
      `,
    ).rejects.toMatchObject({ code: 'P0001' })
    await expect(
      connection`
        update organization_group_rule_revisions set enabled = false
        where group_id = ${group!.group_id}
      `,
    ).rejects.toMatchObject({ code: 'P0001' })
    await expect(
      connection`
        update organization_groups set management_mode = 'manual'
        where group_id = ${group!.group_id}
      `,
    ).rejects.toMatchObject({ code: 'P0001' })
    await expect(
      connection`
        insert into organization_group_rule_attestations (
          assignment_id, source_kind, source_id, valid_until
        ) values (${assignment!.assignment_id}, 'corporation-role', ${randomUUID()},
          now() + interval '1 hour')
      `,
    ).rejects.toMatchObject({
      code: '23514',
      constraint_name: 'organization_group_rule_attestations_binding_check',
    })

    const [stored] = await connection<{ count: number }[]>`
      select count(*)::integer as count from organization_group_assignments
      where group_id = ${group!.group_id} and assignment_source = 'rule'
    `
    expect(stored?.count).toBe(1)
  })

  test('rolls back a rule decision if its safe evidence cannot be audited', async () => {
    const auditId = randomUUID()
    const groupId = randomUUID()
    await expect(
      connection.begin(async (transaction) => {
        await transaction`
          insert into organization_audit_events (
            audit_id, actor_id, actor_type, event_type, organization_version,
            outcome, policy_version, reason, subject_id, subject_type,
            group_id, rule_revision, resulting_permissions
          ) values (
            ${auditId}, ${userId}, 'user', 'group-rule.created', 1,
            'transitioned', 1, 'Reviewed owner rule', ${groupId}, 'group',
            ${groupId}, 1, ARRAY['member.read']::text[]
          )
        `
        await transaction`
          insert into organization_rule_audit_sources (
            audit_id, source_kind, source_id, role_revision
          ) values (${auditId}, 'corporation-role', ${randomUUID()}, NULL)
        `
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint_name: 'organization_rule_audit_sources_revision_check',
    })
    const [result] = await connection<{ count: number }[]>`
      select count(*)::integer as count from organization_audit_events where audit_id = ${auditId}
    `
    expect(result?.count).toBe(0)
  })
})

async function seedCurrentDeployment() {
  await connection`
    insert into deployment_admins (id, email, password_hash)
    values (${adminId}, 'owner@example.com', 'password-hash')
  `
  await connection`
    update deployment_installation_settings set owner_admin_id = ${adminId} where id = 1
  `
  await connection`insert into users (id) values (${userId})`
  await connection`
    insert into characters (character_id, user_id, owner_hash, name, corporation_id, is_main)
    values (${characterId}, ${userId}, 'current-owner', 'Current Pilot', 98000001, true)
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
  await connection`
    insert into platform_subject_lifecycles (
      subject_lifecycle_id,
      subject_kind,
      subject_id,
      character_id
    ) values (${characterSubjectLifecycleId}, 'character', ${String(characterId)}, ${characterId})
  `
  await connection`
    insert into organization_epochs (
      deployment_id,
      organization_version,
      organization_type,
      organization_id,
      organization_name,
      organization_ticker
    ) values (1, 1, 'corporation', 98000001, 'Current Corporation', 'CURR')
  `
  await connection`
    insert into deployment_settings (
      id,
      organization_type,
      organization_id,
      organization_name,
      organization_ticker
    ) values (1, 'corporation', 98000001, 'Current Corporation', 'CURR')
  `
  await connection`
    insert into organization_managed_corporations (
      deployment_id,
      organization_version,
      corporation_id,
      first_observed_at,
      last_observed_at
    ) values (1, 1, 98000001, now(), now())
  `
  await connection`
    insert into organization_corporation_sources (
      source_id,
      deployment_id,
      organization_version,
      corporation_id,
      character_id,
      evidence_character_id,
      source_user_id,
      source_subject_lifecycle_id,
      authorization_generation,
      role_evidence_revision,
      observed_corporation_id,
      required_scope,
      director_role_present,
      observed_at,
      fresh_until,
      status,
      registered_by_user_id
    ) values (
      ${sourceId}, 1, 1, 98000001, ${characterId}, ${characterId}, ${userId},
      ${characterSubjectLifecycleId}, 7, 'seed-role-evidence-v1', 98000001,
      'esi-corporations.read_corporation_membership.v1', true, now(),
      now() + interval '1 hour', 'fresh', ${userId}
    )
  `
}
