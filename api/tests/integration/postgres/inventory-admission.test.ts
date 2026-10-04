import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '../../../src/db/migration-runner.js'
import { waitForDatabase } from './wait-for-database.js'
import * as schema from '../../../src/db/schema.js'
import type { CorporationInventoryScope } from '../../../src/organization/inventory-admission.js'

let container: StartedTestContainer
let connection: postgres.Sql
let database: ReturnType<typeof drizzle<typeof schema>>
let personal: typeof import('../../../src/auth/inventory-subject-store.js')
let corporation: typeof import('../../../src/organization/inventory-subject-store.js')
let sources: typeof import('../../../src/platform/inventory-source-admission.js')
let audit: typeof import('../../../src/platform/inventory-access-audit.js')
let browserCorporations: typeof import('../../../src/organization/inventory-corporations.js')
const owner = randomUUID()
const other = randomUUID()
const memberLifecycle = randomUUID()
const lifecycles = Array.from({ length: 5 }, () => randomUUID())
const assetsScope = 'esi-assets.read_assets.v1'

beforeAll(async () => {
  const password = randomUUID()
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
  await waitForDatabase(connection)
  await runMigrations(connection)
  database = drizzle(connection, { schema })
  vi.doMock('../../../src/db/client.js', () => ({ db: database, sql: connection }))
  personal = await import('../../../src/auth/inventory-subject-store.js')
  corporation = await import('../../../src/organization/inventory-subject-store.js')
  sources = await import('../../../src/platform/inventory-source-admission.js')
  audit = await import('../../../src/platform/inventory-access-audit.js')
  browserCorporations = await import('../../../src/organization/inventory-corporations.js')
  await connection`insert into users (id) values (${owner}), (${other})`
  await connection`insert into organization_epochs (deployment_id, organization_version, organization_type, organization_id, organization_name, organization_ticker)
    values (1, 1, 'corporation', 98, 'Corp', 'CORP')`
  await connection`insert into deployment_settings (id, organization_type, organization_id, organization_name, organization_ticker)
    values (1, 'corporation', 98, 'Corp', 'CORP')`
  await connection`insert into organization_managed_corporations (deployment_id, organization_version, corporation_id, first_observed_at, last_observed_at)
    values (1, 1, 98, now(), now())`
  await connection`insert into organization_managed_member_lifecycles (managed_member_lifecycle_id, deployment_id, organization_version, user_id)
    values (${memberLifecycle}, 1, 1, ${owner})`
  await connection`insert into deployment_modules (module_id, enabled) values ('member-audit', true) on conflict (module_id) do update set enabled = true`
  await connection`insert into deployment_module_sections (module_id, section_id, kind, enabled, declaration_revision, disclosure_version, activation_version)
    values ('member-audit', 'assets', 'sensitive-evidence', true, 1, 2, 3)
    on conflict (module_id, section_id) do update set enabled = true, disclosure_version = 2, activation_version = 3`
  for (let index = 0; index < 5; index += 1) {
    const affiliationDeadline = (
      index === 3 ? new Date(0) : new Date(Date.now() + 3600000)
    ).toISOString()
    await connection`insert into characters (character_id, user_id, owner_hash, name, corporation_id, is_main, affiliation_resolution_state, affiliation_checked_at, next_affiliation_check)
      values (${index + 1}, ${index === 4 ? other : owner}, 'owner-hash', ${`Pilot ${index + 1}`}, ${index === 2 ? 99 : 98}, ${index === 0 || index === 4}, 'resolved', now(), ${affiliationDeadline}::timestamptz)`
    await connection`insert into platform_subject_lifecycles (subject_lifecycle_id, subject_kind, subject_id, character_id)
      values (${lifecycles[index]!}, 'character', ${String(index + 1)}, ${index + 1})`
    await connection`insert into eve_tokens (character_id, encrypted_tokens, access_token_expires_at, scopes, token_version)
      values (${index + 1}, 'encrypted-fixture', now() + interval '1 hour', ${JSON.stringify(index === 1 ? [] : [assetsScope])}::jsonb, 7)`
  }
  await connection`insert into organization_character_exceptions (deployment_id, organization_version, user_id, character_id, approver_user_id, reason)
    values (1, 1, ${owner}, 3, ${other}, 'Approved external alt')`
}, 60_000)

afterAll(async () => {
  await connection?.end()
  await container?.stop()
})

const currentScope = async (): Promise<CorporationInventoryScope> => ({
  actorUserId: owner,
  corporationId: 98,
  selection: undefined,
  viewerFingerprint: 'viewer',
  policyVersion: 1,
  declaration: {
    moduleId: 'trading',
    publisherPackage: '@eve-space/trading-manifest',
    audience: 'hr',
    requiredPermission: 'trading.inventory.corporation.read',
    additionalRequiredPermissions: ['member-audit.assets.read'],
  },
  organization: {
    organizationVersion: 1,
    audience: 'hr',
    requiredPermission: 'trading.inventory.corporation.read',
    additionalRequiredPermissions: ['member-audit.assets.read'],
    entitlementScope: 'all',
  },
  subjects: (await corporation.resolveCorporationInventorySubjects({
    organizationVersion: 1,
    corporationId: 98,
    selection: undefined,
    maximum: 250,
  }))!,
})

describe('inventory admission storage boundaries', () => {
  it('lists only current-version corporations within the finite browser selector bound', async () => {
    await connection`insert into organization_managed_corporations (deployment_id, organization_version, corporation_id, first_observed_at, last_observed_at, is_current, removed_at)
      values (1, 1, 999, now(), now(), false, now())`
    expect(await browserCorporations.listInventoryCorporations(1)).toEqual([98])
    expect(await browserCorporations.listInventoryCorporations(2)).toBeNull()
    await connection`insert into organization_managed_corporations (deployment_id, organization_version, corporation_id, first_observed_at, last_observed_at)
      select 1, 1, id, now(), now() from generate_series(1000,1248) id`
    try {
      expect(await browserCorporations.listInventoryCorporations(1)).toHaveLength(250)
      await connection`insert into organization_managed_corporations (deployment_id, organization_version, corporation_id, first_observed_at, last_observed_at)
        values (1, 1, 1249, now(), now())`
      expect(await browserCorporations.listInventoryCorporations(1)).toBeNull()
    } finally {
      await connection`delete from organization_managed_corporations where corporation_id between 999 and 1249`
    }
  })
  it('batches ownership and current lifecycles without organization gates, and preserves an explicit empty set', async () => {
    expect(
      (await personal.loadPersonalInventorySubjects(owner, undefined, 20)).map(
        (row) => row.characterId,
      ),
    ).toEqual([1, 2, 3, 4])
    expect(await personal.loadPersonalInventorySubjects(owner, [], 20)).toEqual([])
    expect(await personal.loadPersonalInventorySubjects(owner, [5, 999], 20)).toEqual([])
    expect(
      (await personal.loadPersonalInventorySubjects(owner, [1, 3], 20)).map(
        (row) => row.characterId,
      ),
    ).toEqual([1, 3])
  })

  it('limits corporation coverage to current managed lifecycles and affiliation without filtering target blocks', async () => {
    await connection`insert into organization_member_blocks (deployment_id, organization_version, user_id, reason, blocked_by_user_id)
      values (1, 1, ${owner}, 'Target block fixture', ${other})`
    const scope = await currentScope()
    expect(scope.subjects.map((row) => row.characterId)).toEqual([1, 2])
    expect(
      await corporation.resolveCorporationInventorySubjects({
        organizationVersion: 1,
        corporationId: 99,
        selection: undefined,
        maximum: 250,
      }),
    ).toBeNull()
    expect(
      await corporation.resolveCorporationInventorySubjects({
        organizationVersion: 2,
        corporationId: 98,
        selection: undefined,
        maximum: 250,
      }),
    ).toBeNull()
    expect(
      await corporation.resolveCorporationInventorySubjects({
        organizationVersion: 1,
        corporationId: 98,
        selection: [3],
        maximum: 250,
      }),
    ).toEqual([])
  })

  it('uses the existing disclosure and scope classifier before granting any evidence subjects', async () => {
    const scope = await currentScope()
    const initial = await sources.loadCorporationInventorySourceSubjects(scope)
    expect(initial.map((row) => row.evidenceReadable)).toEqual([false, false])
    await connection`insert into character_reviewer_disclosure_acceptances (character_id, module_id, section_id, authorization_generation, disclosure_version)
      values (1, 'member-audit', 'assets', 7, 2), (2, 'member-audit', 'assets', 7, 2)`
    const admitted = await sources.loadCorporationInventorySourceSubjects(scope)
    expect(admitted.map((row) => row.evidenceReadable)).toEqual([true, false])
    expect(admitted[0]).toMatchObject({
      disclosureRevision: 2,
      sectionActivationRevision: 3,
      authorizationGeneration: 7,
      memberLifecycle,
    })
    expect(admitted[0]?.collection).toMatchObject({
      state: 'never-collected',
      validatedAt: null,
      freshUntil: null,
    })
    const observedAt = new Date().toISOString()
    await connection`insert into platform_collection_state (
      module_id, resource_id, subject_kind, subject_lifecycle_id, subject_id,
      authorization_generation, organization_deployment_id, organization_version,
      target_user_id, managed_member_lifecycle_id, section_id, disclosure_version,
      section_activation_version, validated_at, next_eligible_at
    ) values ('member-audit', 'assets', 'character', ${lifecycles[0]!}, '1', 7, 1, 1,
      ${owner}, ${memberLifecycle}, 'assets', 2, 3, ${observedAt}, now() + interval '1 hour')`
    const collected = await sources.loadCorporationInventorySourceSubjects(scope)
    expect(collected[0]?.collection).toMatchObject({
      state: 'current',
      validatedAt: observedAt,
      freshUntil: new Date(Date.parse(observedAt) + 3_600_000).toISOString(),
    })
    await connection`update platform_collection_state set last_failure_class = 'esi-unavailable', failure_started_at = now() where module_id = 'member-audit' and resource_id = 'assets'`
    expect(
      (await sources.loadCorporationInventorySourceSubjects(scope))[0]?.collection,
    ).toMatchObject({
      state: 'stale',
      lastFailureClass: 'esi-unavailable',
      validatedAt: observedAt,
    })
    await connection`update deployment_module_sections set disclosure_version = 3 where module_id = 'member-audit' and section_id = 'assets'`
    expect(
      (await sources.loadCorporationInventorySourceSubjects(scope)).every(
        (row) => !row.evidenceReadable,
      ),
    ).toBe(true)
    await connection`update deployment_module_sections set disclosure_version = 2 where module_id = 'member-audit' and section_id = 'assets'`
  })

  it('persists bounded content-free decisions atomically and refuses mutation and lost audit storage', async () => {
    const scope = await currentScope()
    const admitted = await sources.loadCorporationInventorySourceSubjects(scope)
    const subjects = admitted.map((row) => ({
      userId: row.userId,
      characterId: row.characterId,
      characterLifecycle: row.characterLifecycle,
      memberLifecycle: row.memberLifecycle,
      authorizationGeneration: row.authorizationGeneration,
      disclosureRevision: row.disclosureRevision,
      sectionActivationRevision: row.sectionActivationRevision,
      evidenceReadable: row.evidenceReadable,
    }))
    await audit.recordInventoryAccessDecision({
      actorUserId: owner,
      corporationId: 98,
      accessKind: 'aggregate',
      decision: 'allowed',
      reason: 'authorized',
      subjects,
      expectedOrganizationVersion: 1,
      expectedPolicyVersion: 1,
    })
    await audit.recordInventoryAccessDecision({
      actorUserId: owner,
      corporationId: null,
      accessKind: 'holders',
      decision: 'denied',
      reason: 'scope-denied',
      subjects: [],
    })
    const rows =
      await connection`select corporation_id, access_kind, decision, subjects from organization_inventory_access_audit order by occurred_at`
    expect(rows).toHaveLength(2)
    expect(rows[0]!.subjects).toEqual(subjects)
    expect(rows[1]).toMatchObject({ corporation_id: null, decision: 'denied', subjects: [] })
    await expect(
      connection`update organization_inventory_access_audit set decision = 'denied'`,
    ).rejects.toThrow('organization audit events are append-only')
    await expect(connection`delete from organization_inventory_access_audit`).rejects.toThrow(
      'organization audit events are append-only',
    )
    await connection`alter table organization_inventory_access_audit rename to inventory_audit_unavailable`
    await expect(
      audit.recordInventoryAccessDecision({
        actorUserId: owner,
        corporationId: null,
        accessKind: 'aggregate',
        decision: 'denied',
        reason: 'scope-denied',
        subjects: [],
      }),
    ).rejects.toThrow('organization_inventory_access_audit')
    await connection`alter table inventory_audit_unavailable rename to organization_inventory_access_audit`
  })

  it('refuses alliance subjects while the current managed-corporation snapshot is unavailable', async () => {
    await connection`update deployment_settings set organization_type = 'alliance' where id = 1`
    expect(
      await corporation.resolveCorporationInventorySubjects({
        organizationVersion: 1,
        corporationId: 98,
        selection: undefined,
        maximum: 250,
      }),
    ).toBeNull()
  })

  it('selects either current alliance corporation independently and refuses departed corporations', async () => {
    const allianceLifecycle = randomUUID()
    await connection`insert into organization_epochs (deployment_id, organization_version, organization_type, organization_id, organization_name, organization_ticker)
      values (1, 2, 'alliance', 100, 'Alliance', 'ALLY')`
    await connection`update deployment_settings set organization_version = 2, organization_type = 'alliance', organization_id = 100 where id = 1`
    await connection`insert into organization_managed_corporations (deployment_id, organization_version, corporation_id, first_observed_at, last_observed_at)
      values (1, 2, 98, now(), now()), (1, 2, 99, now(), now())`
    await connection`insert into organization_managed_member_lifecycles (deployment_id, organization_version, user_id)
      values (1, 2, ${owner})`
    await connection`insert into platform_subject_lifecycles (subject_lifecycle_id, subject_kind, subject_id, organization_deployment_id, organization_version)
      values (${allianceLifecycle}, 'alliance', '100', 1, 2)`
    await connection`insert into platform_collection_state (module_id, resource_id, subject_kind, subject_lifecycle_id, subject_id, validated_at, next_eligible_at)
      values ('core', 'managed-corporations', 'alliance', ${allianceLifecycle}, '100', now(), now() + interval '1 hour')`

    expect(await browserCorporations.listInventoryCorporations(2)).toEqual([98, 99])
    const selected = { organizationVersion: 2, selection: undefined, maximum: 250 }
    const first = await corporation.resolveCorporationInventorySubjects({
      ...selected,
      corporationId: 98,
    })
    const second = await corporation.resolveCorporationInventorySubjects({
      ...selected,
      corporationId: 99,
    })
    expect(first?.map((subject) => subject.characterId)).toEqual([1, 2])
    expect(second?.map((subject) => subject.characterId)).toEqual([3])

    await connection`update organization_managed_corporations set is_current = false, removed_at = now() where organization_version = 2 and corporation_id = 99`
    expect(await browserCorporations.listInventoryCorporations(2)).toEqual([98])
    expect(
      await corporation.resolveCorporationInventorySubjects({ ...selected, corporationId: 99 }),
    ).toBeNull()
  })
})
