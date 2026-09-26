import { drizzle } from 'drizzle-orm/postgres-js'
import type { PlatformInstalledModuleSectionDefinition } from '@eve-space/platform-module-contract/installed'
import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract/resources'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { loadMigrations, runMigrations } from '../../../src/db/migration-runner.js'
import * as schema from '../../../src/db/schema.js'
import { findCharacterTokenForLifecycle } from '../../../src/auth/character-token-store.js'
import {
  loadPlatformCollectionState,
  upsertPlatformCollectionState,
} from '../../../src/platform/collection-state-store.js'
import { repairPlatformCollectionState } from '../../../src/platform/collection-state-repair.js'
import {
  getInstalledResourceCollectionStatus,
  recordInstalledResourceCollectionSuccess,
} from '../../../src/platform/collection-status.js'
import {
  resolveInstalledResourceEligibility,
  selectDueInstalledResources,
} from '../../../src/platform/resource-eligibility.js'
import { guardInstalledResourceExecution } from '../../../src/platform/resource-execution-guard.js'
import { coreResources } from '../../../src/platform/core-resources.js'
import { materializeCoreResourceObservation } from '../../../src/platform/core-resource-materialization.js'
import { applyInstalledResourceObservation } from '../../../src/platform/resource-refresh.js'
import {
  reconcileInstalledModuleSections,
  setInstalledModuleEnabled,
  setInstalledModuleSectionEnabled,
} from '../../../src/platform/module-settings.js'

let container: StartedTestContainer
let databaseUrl: string
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
})

afterAll(async () => {
  await container?.stop()
})

beforeEach(async () => {
  const connection = postgres(databaseUrl)
  try {
    await connection.unsafe('drop schema public cascade; create schema public;').simple()
    await runMigrations(connection)
  } finally {
    await connection.end()
  }
})

const assertNoModuleCommit = async (
  connection: postgres.Sql,
  observation: Parameters<typeof applyInstalledResourceObservation>[0],
) => {
  await applyInstalledResourceObservation(observation, { connection })
  const [state] = await connection<{ count: number }[]>`
    select count(*)::integer as count from platform_collection_state
    where module_id = ${observation.identity.moduleId}
      and resource_id = ${observation.identity.resourceId}
  `
  expect(state?.count).toBe(0)
}

const verifyPlannerSkipsDeniedPrefix = async (
  connection: postgres.Sql,
  jobsResource: PlatformInstalledResourceDescriptor,
) => {
  const roleDenied = Array.from({ length: 64 }, (_, index) => ({
    ...jobsResource,
    resourceId: `a-role-${String(index).padStart(3, '0')}`,
  }))
  const scopeDenied = Array.from({ length: 64 }, (_, index) => ({
    ...jobsResource,
    resourceId: `b-scope-${String(index).padStart(3, '0')}`,
    operationId: 'corporation-members',
    dependentOperationIds: ['organization-activity-project-list'],
  }))
  const authorizedAfterDenied = {
    ...jobsResource,
    resourceId: 'z-authorized-after-denied',
    operationId: 'corporation-members',
    dependentOperationIds: [],
  }
  const resources = [...roleDenied, ...scopeDenied, authorizedAfterDenied]
  const first = await selectDueInstalledResources({ connection, limit: 1, resources })
  const next = await selectDueInstalledResources({ connection, limit: 2, resources })
  for (const selected of [first, next]) {
    expect(selected.map(({ identity }) => identity.resourceId)).toEqual([
      authorizedAfterDenied.resourceId,
    ])
  }
}

describe('platform collection state PostgreSQL persistence', () => {
  test('backfills fresh existing managed accounts during the lifecycle migration', async () => {
    const connection = postgres(databaseUrl)
    const userId = randomUUID()
    const migrations = await loadMigrations()
    try {
      await connection.unsafe('drop schema public cascade; create schema public;').simple()
      await runMigrations(connection, migrations.slice(0, 3))
      await connection`
        insert into organization_epochs (
          deployment_id, organization_version, organization_type, organization_id,
          organization_name, organization_ticker
        ) values (1, 1, 'corporation', 98000001, 'Managed Corporation', 'CORP')
      `
      await connection`
        insert into deployment_settings (
          id, organization_type, organization_id,
          organization_name, organization_ticker, organization_version
        ) values (1, 'corporation', 98000001, 'Managed Corporation', 'CORP', 1)
      `
      await connection`insert into users (id) values (${userId})`
      await connection`
        insert into characters (
          character_id, user_id, name, corporation_id, is_main,
          affiliation_checked_at, next_affiliation_check, affiliation_resolution_state
        ) values (
          1404328069, ${userId}, 'Existing Pilot', 98000001, true,
          now(), now() + interval '1 hour', 'resolved'
        )
      `
      await connection`
        insert into organization_managed_corporations (
          deployment_id, organization_version, corporation_id, is_current,
          first_observed_at, last_observed_at
        ) values (1, 1, 98000001, true, now(), now())
      `

      await runMigrations(connection, migrations.slice(3, -1))

      await expect(
        connection<{ user_id: string; ended_at: Date | null }[]>`
        select user_id, ended_at from organization_managed_member_lifecycles
      `.then((rows) => [...rows]),
      ).resolves.toStrictEqual([{ ended_at: null, user_id: userId }])
    } finally {
      await connection.end()
    }
  })

  test('invalidates legacy authority rows before enforcing required provenance', async () => {
    const connection = postgres(databaseUrl)
    const userId = randomUUID()
    const lifecycleId = randomUUID()
    const sourceId = randomUUID()
    const characterId = 1_404_328_070
    const migrations = await loadMigrations()
    const upgradeIndex = migrations.findIndex(
      ({ name }) => name === '008_multi_character_authority_sources.sql',
    )
    try {
      await connection.unsafe('drop schema public cascade; create schema public;').simple()
      await runMigrations(connection, migrations.slice(0, upgradeIndex))
      await connection`insert into users (id) values (${userId})`
      await connection`
        insert into characters (character_id, user_id, name, corporation_id, is_main)
        values (${characterId}, ${userId}, 'Legacy Pilot', 98000001, true)
      `
      await connection`
        insert into eve_tokens (
          character_id, encrypted_tokens, access_token_expires_at, scopes, token_version
        ) values (
          ${characterId}, 'encrypted-legacy-token', now() + interval '1 hour',
          ${connection.json(['esi-corporations.read_corporation_membership.v1'])}, 4
        )
      `
      await connection`
        insert into platform_subject_lifecycles (
          subject_lifecycle_id, subject_kind, subject_id, character_id
        ) values (${lifecycleId}, 'character', ${String(characterId)}, ${characterId})
      `
      await connection`
        insert into organization_epochs (
          deployment_id, organization_version, organization_type, organization_id,
          organization_name, organization_ticker
        ) values (1, 1, 'corporation', 98000001, 'Legacy Corporation', 'OLD')
      `
      await connection`
        insert into organization_managed_corporations (
          deployment_id, organization_version, corporation_id,
          first_observed_at, last_observed_at
        ) values (1, 1, 98000001, now(), now())
      `
      const [grant] = await connection<{ grant_id: string }[]>`
        insert into organization_role_grants (
          deployment_id, organization_version, user_id, role, granted_by_user_id, reason
        ) values (1, 1, ${userId}, 'organization_owner', ${userId}, 'Legacy owner grant')
        returning grant_id
      `
      if (!grant) {
        throw new Error('Legacy owner grant fixture is missing')
      }
      await connection`
        insert into organization_authority_evidence (
          grant_id, deployment_id, organization_version, user_id, character_id,
          authority_corporation_id, observed_corporation_id, required_scope,
          director_role_present, status, verified_at, last_checked_at
        ) values (
          ${grant.grant_id}, 1, 1, ${userId}, ${characterId}, 98000001, 98000001,
          'esi-characters.read_corporation_roles.v1', true, 'fresh', now(), now()
        )
      `
      await connection`
        insert into organization_corporation_sources (
          source_id, deployment_id, organization_version, corporation_id, character_id,
          evidence_character_id, registered_by_user_id
        ) values (${sourceId}, 1, 1, 98000001, ${characterId}, ${characterId}, ${userId})
      `

      await runMigrations(connection, migrations.slice(upgradeIndex, upgradeIndex + 1))

      const [character] = await connection<{ unresolved: boolean }[]>`
        select owner_hash like 'legacy-unresolved:%' as unresolved
        from characters
        where character_id = ${characterId}
      `
      const [evidence] = await connection<
        {
          authorization_generation: number
          failure_class: string
          invalidation_outcome: string
          source_subject_lifecycle_id: string
          status: string
        }[]
      >`
        select authorization_generation, failure_class, invalidation_outcome,
          source_subject_lifecycle_id, status
        from organization_authority_evidence
        where grant_id = ${grant.grant_id}
      `
      const [source] = await connection<
        {
          authorization_generation: number
          failure_class: string
          invalidation_outcome: string
          source_subject_lifecycle_id: string
          source_user_id: string
          status: string
        }[]
      >`
        select authorization_generation, failure_class, invalidation_outcome,
          source_subject_lifecycle_id, source_user_id, status
        from organization_corporation_sources
        where source_id = ${sourceId}
      `

      expect(character).toStrictEqual({ unresolved: true })
      expect(evidence).toStrictEqual({
        authorization_generation: 4,
        failure_class: 'strict:authorization-missing',
        invalidation_outcome: 'authorization-missing',
        source_subject_lifecycle_id: lifecycleId,
        status: 'invalid',
      })
      expect(source).toStrictEqual({
        authorization_generation: 4,
        failure_class: 'strict:authorization-missing',
        invalidation_outcome: 'authorization-missing',
        source_subject_lifecycle_id: lifecycleId,
        source_user_id: userId,
        status: 'invalid',
      })
    } finally {
      await connection.end()
    }
  })

  test('reconciles disabled section defaults and advances only material disclosure policy', async () => {
    const connection = postgres(databaseUrl)
    const moduleId = 'section-policy-test'
    const definitions = [
      {
        defaultEnabled: false as const,
        id: 'overview',
        kind: 'workspace' as const,
        moduleId,
      },
      {
        defaultEnabled: false as const,
        disclosureRevision: 1,
        id: 'skills',
        kind: 'sensitive-evidence' as const,
        moduleId,
      },
    ] as const satisfies readonly PlatformInstalledModuleSectionDefinition[]
    try {
      await connection`
        insert into deployment_modules (module_id, enabled) values (${moduleId}, true)
      `
      await reconcileInstalledModuleSections(connection, definitions)
      await expect(
        connection`
          select section_id as "sectionId", enabled,
            disclosure_version as "disclosureVersion",
            activation_version as "activationVersion"
          from deployment_module_sections
          order by section_id
        `.then((rows) => [...rows]),
      ).resolves.toStrictEqual([
        { activationVersion: 0, disclosureVersion: 0, enabled: false, sectionId: 'overview' },
        { activationVersion: 0, disclosureVersion: 0, enabled: false, sectionId: 'skills' },
      ])

      await expect(
        setInstalledModuleSectionEnabled(moduleId, 'skills', true, connection, definitions),
      ).resolves.toMatchObject({ activationVersion: 1, disclosureVersion: 1 })
      await setInstalledModuleSectionEnabled(moduleId, 'skills', false, connection, definitions)
      await expect(
        setInstalledModuleSectionEnabled(moduleId, 'skills', true, connection, definitions),
      ).resolves.toMatchObject({ activationVersion: 2, disclosureVersion: 1 })

      const revisedDefinitions = [definitions[0]!, { ...definitions[1]!, disclosureRevision: 2 }]
      await reconcileInstalledModuleSections(connection, revisedDefinitions)
      await reconcileInstalledModuleSections(connection, revisedDefinitions)
      await expect(
        connection`
          select enabled, disclosure_version as "disclosureVersion",
            activation_version as "activationVersion"
          from deployment_module_sections
          where module_id = ${moduleId} and section_id = 'skills'
        `.then((rows) => [...rows]),
      ).resolves.toStrictEqual([{ activationVersion: 2, disclosureVersion: 2, enabled: true }])

      await expect(
        setInstalledModuleSectionEnabled(moduleId, 'overview', true, connection, definitions),
      ).resolves.toMatchObject({ activationVersion: 1, disclosureVersion: 0 })
      await setInstalledModuleEnabled(moduleId, false, connection, [
        { defaultEnabled: false, moduleId },
      ])
      await setInstalledModuleEnabled(moduleId, true, connection, [
        { defaultEnabled: false, moduleId },
      ])
      await expect(
        connection<{ section_id: string; activation_version: number }[]>`
        select section_id, activation_version
        from deployment_module_sections
        where module_id = ${moduleId}
        order by section_id
      `.then((rows) => [...rows]),
      ).resolves.toStrictEqual([
        { activation_version: 2, section_id: 'overview' },
        { activation_version: 3, section_id: 'skills' },
      ])
    } finally {
      await connection.end()
    }
  })

  test('creates the constrained composite identity and deterministic due index', async () => {
    const connection = postgres(databaseUrl)
    try {
      const constraints = await connection<{ conname: string }[]>`
        select conname
        from pg_constraint
        where conrelid = 'platform_collection_state'::regclass
        order by conname
      `
      expect(constraints.map(({ conname }) => conname)).toStrictEqual(
        expect.arrayContaining([
          'platform_collection_state_pkey',
          'platform_collection_state_module_id_fkey',
          'platform_collection_state_subject_lifecycle_fkey',
          'platform_collection_state_subject_kind_check',
          'platform_collection_state_authorization_generation_check',
          'platform_collection_state_last_failure_class_check',
        ]),
      )

      const indexes = await connection<{ indexname: string; indexdef: string }[]>`
        select indexname, indexdef
        from pg_indexes
        where schemaname = current_schema()
          and tablename = 'platform_collection_state'
      `
      expect(indexes.map(({ indexname }) => indexname)).toStrictEqual(
        expect.arrayContaining([
          'platform_collection_state_due_idx',
          'platform_collection_state_subject_lifecycle_idx',
        ]),
      )
      expect(
        indexes.find(({ indexname }) => indexname === 'platform_collection_state_due_idx')
          ?.indexdef,
      ).toContain(
        '(next_eligible_at, module_id, resource_id, subject_kind, subject_lifecycle_id, subject_id)',
      )
      expect(
        indexes.find(({ indexname }) => indexname === 'platform_collection_state_due_idx')
          ?.indexdef,
      ).toContain('WHERE (next_eligible_at IS NOT NULL)')

      await connection`insert into deployment_modules (module_id) values ('member-audit')`
      const lifecycleId = await createCharacterLifecycle(connection, 1_404_328_063)
      await expect(
        connection`
          insert into platform_collection_state (
            module_id, resource_id, subject_kind, subject_lifecycle_id, subject_id,
            authorization_generation, last_failure_class
          ) values (
            'member-audit', 'character-skills', 'character', ${lifecycleId}, '1404328063',
            -1, 'provider response: secret'
          )
        `,
      ).rejects.toMatchObject({
        constraint_name: expect.stringMatching(
          /^platform_collection_state_(authorization_generation|last_failure_class)_check$/,
        ),
      })
    } finally {
      await connection.end()
    }
  })

  test('retains disabled state but cascades detached lifecycle data before reattachment', async () => {
    const connection = postgres(databaseUrl)
    const database = drizzle(connection, { schema })
    const characterId = 1_404_328_063
    const validatedAt = new Date('2026-08-25T11:00:00Z')
    try {
      await connection`insert into deployment_modules (module_id, enabled) values ('member-audit', true)`
      const lifecycleId = await createCharacterLifecycle(connection, characterId)
      const identity = {
        moduleId: 'member-audit',
        resourceId: 'character-skills',
        subjectId: String(characterId),
        subjectKind: 'character' as const,
        subjectLifecycleId: lifecycleId,
      }
      const first = await upsertPlatformCollectionState(
        {
          ...identity,
          authorizationGeneration: 2,
          lastFailureClass: null,
          nextEligibleAt: new Date('2026-08-26T12:00:00Z'),
          validatedAt,
        },
        database,
      )
      expect(first.validatedAt).toStrictEqual(validatedAt)

      const updated = await upsertPlatformCollectionState(
        {
          ...identity,
          authorizationGeneration: 3,
          lastFailureClass: 'authorization-required',
          nextEligibleAt: null,
          validatedAt,
        },
        database,
      )
      expect(updated).toMatchObject({
        authorizationGeneration: 3,
        lastFailureClass: 'authorization-required',
        nextEligibleAt: null,
        validatedAt,
      })
      expect(updated.failureStartedAt).toBeInstanceOf(Date)
      expect(updated.createdAt).toStrictEqual(first.createdAt)

      const repeatedFailure = await upsertPlatformCollectionState(
        {
          ...identity,
          authorizationGeneration: 3,
          lastFailureClass: 'esi-unavailable',
          nextEligibleAt: new Date('2026-08-26T12:05:00Z'),
          validatedAt,
        },
        database,
      )
      expect(repeatedFailure.failureStartedAt).toStrictEqual(updated.failureStartedAt)

      await connection`create schema member_audit`
      await connection`
        create table member_audit.character_snapshots (
          subject_lifecycle_id uuid primary key
            references platform_subject_lifecycles(subject_lifecycle_id) on delete cascade,
          payload text not null
        )
      `
      await connection`
        insert into member_audit.character_snapshots (subject_lifecycle_id, payload)
        values (${lifecycleId}, 'private snapshot')
      `
      await connection`
        update deployment_modules set enabled = false where module_id = 'member-audit'
      `

      await expect(loadPlatformCollectionState(identity, database)).resolves.toMatchObject({
        subjectLifecycleId: lifecycleId,
        validatedAt,
      })
      await connection`delete from characters where character_id = ${characterId}`
      const [detachedCounts] = await connection<
        { collection_states: number; lifecycles: number; module_records: number }[]
      >`
        select
          (select count(*)::integer from platform_collection_state) as collection_states,
          (select count(*)::integer from platform_subject_lifecycles) as lifecycles,
          (select count(*)::integer from member_audit.character_snapshots) as module_records
      `
      expect(detachedCounts).toStrictEqual({
        collection_states: 0,
        lifecycles: 0,
        module_records: 0,
      })

      const replacementLifecycleId = await createCharacterLifecycle(connection, characterId)
      expect(replacementLifecycleId).not.toBe(lifecycleId)
      await expect(
        upsertPlatformCollectionState(
          {
            ...identity,
            authorizationGeneration: 3,
            lastFailureClass: null,
            nextEligibleAt: null,
            validatedAt,
          },
          database,
        ),
      ).rejects.toMatchObject({ cause: { code: '23503' } })
      await expect(
        connection`
          insert into member_audit.character_snapshots (subject_lifecycle_id, payload)
          values (${lifecycleId}, 'stale private snapshot')
        `,
      ).rejects.toMatchObject({ code: '23503' })
      await expect(
        upsertPlatformCollectionState(
          {
            ...identity,
            authorizationGeneration: 0,
            lastFailureClass: null,
            nextEligibleAt: null,
            subjectLifecycleId: replacementLifecycleId,
            validatedAt: null,
          },
          database,
        ),
      ).resolves.toMatchObject({ subjectLifecycleId: replacementLifecycleId })
    } finally {
      await connection.end()
    }
  })

  test('converges eligibility, authorization repair, freshness, and lifecycle replacement', async () => {
    const connection = postgres(databaseUrl)
    const database = drizzle(connection, { schema })
    const characterId = 1_404_328_063
    const requiredScope = 'esi-skills.read_skills.v1'
    const resource = {
      eligibility: { kind: 'current-owned-character' },
      implementation: {},
      materializationIntervalSeconds: 900,
      moduleId: 'member-audit',
      operationId: 'skills',
      resourceId: 'character-skills',
      subjectKind: 'character',
    } as const
    try {
      await connection`
        insert into deployment_modules (module_id, enabled) values (${resource.moduleId}, true)
      `
      const lifecycleId = await createCharacterLifecycle(connection, characterId)
      await connection`
        insert into eve_tokens (
          character_id, encrypted_tokens, access_token_expires_at, scopes, token_version
        ) values (
          ${characterId}, 'test ciphertext', now() + interval '1 hour',
          ${JSON.stringify([requiredScope])}::jsonb, 1
        )
      `
      const identity = {
        moduleId: resource.moduleId,
        resourceId: resource.resourceId,
        subjectId: String(characterId),
        subjectKind: 'character' as const,
        subjectLifecycleId: lifecycleId,
      }
      const eligibilityOptions = { connection, resources: [resource] }

      await expect(
        resolveInstalledResourceEligibility(identity, eligibilityOptions),
      ).resolves.toMatchObject({ authorizationGeneration: 1, due: true, status: 'eligible' })

      await connection`
        update eve_tokens set scopes = '[]'::jsonb, token_version = 2
        where character_id = ${characterId}
      `
      await expect(
        resolveInstalledResourceEligibility(identity, eligibilityOptions),
      ).resolves.toMatchObject({
        authorizationGeneration: 2,
        requiredScope,
        status: 'authorization-required',
      })
      await repairPlatformCollectionState({ characterId, connection, resources: [resource] })
      await expect(loadPlatformCollectionState(identity, database)).resolves.toMatchObject({
        authorizationGeneration: 2,
        lastFailureClass: 'authorization-required',
        nextEligibleAt: null,
        validatedAt: null,
      })

      await connection`
        update eve_tokens
        set scopes = ${JSON.stringify([requiredScope])}::jsonb, token_version = 3
        where character_id = ${characterId}
      `
      await expect(
        resolveInstalledResourceEligibility(identity, eligibilityOptions),
      ).resolves.toMatchObject({ authorizationGeneration: 3, due: true, status: 'eligible' })
      await repairPlatformCollectionState({ characterId, connection, resources: [resource] })
      await expect(loadPlatformCollectionState(identity, database)).resolves.toMatchObject({
        authorizationGeneration: 3,
        lastFailureClass: null,
      })
      const convergedRepairState = await loadPlatformCollectionState(identity, database)
      await repairPlatformCollectionState({ characterId, connection, resources: [resource] })
      await expect(loadPlatformCollectionState(identity, database)).resolves.toStrictEqual(
        convergedRepairState,
      )

      const validatedAt = '2026-08-26T10:00:00.000Z'
      const upsertState = (input: Parameters<typeof upsertPlatformCollectionState>[0]) =>
        upsertPlatformCollectionState(input, database)
      await recordInstalledResourceCollectionSuccess(identity, { validatedAt }, 3, {
        resources: [resource],
        upsertState,
      })
      await recordInstalledResourceCollectionSuccess(identity, { validatedAt }, 3, {
        resources: [resource],
        upsertState,
      })
      await expect(loadPlatformCollectionState(identity, database)).resolves.toMatchObject({
        nextEligibleAt: new Date('2026-08-26T10:15:00.000Z'),
        validatedAt: new Date(validatedAt),
      })

      await connection`
        update deployment_modules set enabled = false where module_id = ${resource.moduleId}
      `
      await expect(
        resolveInstalledResourceEligibility(identity, eligibilityOptions),
      ).resolves.toMatchObject({ status: 'disabled' })

      await connection`delete from characters where character_id = ${characterId}`
      await expect(
        resolveInstalledResourceEligibility(identity, eligibilityOptions),
      ).resolves.toStrictEqual({ status: 'obsolete' })
      await expect(loadPlatformCollectionState(identity, database)).resolves.toBeNull()
      const loadCharacterAuthorization = vi.fn()
      await expect(
        guardInstalledResourceExecution(identity, {
          loadCharacterCacheAuthorization: loadCharacterAuthorization,
          resolveEligibility: (candidate) =>
            resolveInstalledResourceEligibility(candidate, eligibilityOptions),
          resources: [resource],
        }),
      ).resolves.toStrictEqual({ outcome: 'noop', reason: 'obsolete' })
      expect(loadCharacterAuthorization).not.toHaveBeenCalled()

      await connection`
        update deployment_modules set enabled = true where module_id = ${resource.moduleId}
      `
      const replacementLifecycleId = await createCharacterLifecycle(connection, characterId)
      expect(replacementLifecycleId).not.toBe(lifecycleId)
      await connection`
        insert into eve_tokens (
          character_id, encrypted_tokens, access_token_expires_at, scopes, token_version
        ) values (
          ${characterId}, 'replacement ciphertext', now() + interval '1 hour',
          ${JSON.stringify([requiredScope])}::jsonb, 0
        )
      `
      await expect(
        findCharacterTokenForLifecycle(characterId, lifecycleId, database),
      ).resolves.toBeNull()
      await expect(
        findCharacterTokenForLifecycle(characterId, replacementLifecycleId, database),
      ).resolves.toMatchObject({ scopes: [requiredScope], tokenVersion: 0 })
      await expect(
        resolveInstalledResourceEligibility(
          { ...identity, subjectLifecycleId: replacementLifecycleId },
          eligibilityOptions,
        ),
      ).resolves.toMatchObject({ authorizationGeneration: 0, due: true, status: 'eligible' })
    } finally {
      await connection.end()
    }
  })

  test('enforces module and section state across classification, planning, status, and execution', async () => {
    const connection = postgres(databaseUrl)
    const characterId = 1_404_328_060
    const lifecycle = '00000000-0000-4000-8000-000000000010'
    const resource = {
      eligibility: { kind: 'current-owned-character' },
      implementation: {},
      materializationIntervalSeconds: 900,
      moduleId: 'member-audit',
      operationId: 'skills',
      resourceId: 'character-skills',
      sectionId: 'skills',
      subjectKind: 'character',
    } as const
    const identity = {
      moduleId: resource.moduleId,
      resourceId: resource.resourceId,
      subjectId: String(characterId),
      subjectKind: resource.subjectKind,
      subjectLifecycleId: lifecycle,
    }
    try {
      await connection`
        insert into deployment_modules (module_id, enabled) values (${resource.moduleId}, true)
      `
      await connection`
        insert into deployment_module_sections (
          module_id, section_id, kind, enabled, declaration_revision, disclosure_version
        ) values
          (${resource.moduleId}, 'skills', 'sensitive-evidence', false, 1, 1),
          (${resource.moduleId}, 'assets', 'sensitive-evidence', true, 1, 1)
      `
      await createCharacterLifecycle(connection, characterId, lifecycle)
      await connection`
        insert into eve_tokens (
          character_id, encrypted_tokens, access_token_expires_at, scopes, token_version
        ) values (
          ${characterId}, 'test ciphertext', now() + interval '1 hour',
          ${connection.json(['esi-skills.read_skills.v1'])}, 1
        )
      `
      const eligibilityOptions = { connection, resources: [resource] }
      const resolveEligibility = () =>
        resolveInstalledResourceEligibility(identity, eligibilityOptions)

      await expect(resolveEligibility()).resolves.toMatchObject({ status: 'disabled' })
      await expect(
        selectDueInstalledResources({ ...eligibilityOptions, limit: 10 }),
      ).resolves.toStrictEqual([])
      await expect(
        getInstalledResourceCollectionStatus(identity, {
          resolveEligibility,
          resources: [resource],
        }),
      ).resolves.toMatchObject({ status: 'unavailable' })
      const loadAuthorization = vi.fn()
      await expect(
        guardInstalledResourceExecution(identity, {
          loadCharacterCacheAuthorization: loadAuthorization,
          resolveEligibility,
          resources: [resource],
        }),
      ).resolves.toStrictEqual({ outcome: 'noop', reason: 'disabled' })
      expect(loadAuthorization).not.toHaveBeenCalled()

      await connection`
        update deployment_module_sections set enabled = true
        where module_id = ${resource.moduleId} and section_id = ${resource.sectionId}
      `
      await expect(resolveEligibility()).resolves.toMatchObject({
        due: true,
        status: 'eligible',
      })

      await connection`
        update deployment_modules set enabled = false where module_id = ${resource.moduleId}
      `
      await expect(resolveEligibility()).resolves.toMatchObject({ status: 'disabled' })
    } finally {
      await connection.end()
    }
  })

  test('selects deterministic bounded due prefixes including absent state rows', async () => {
    const connection = postgres(databaseUrl)
    const requiredScope = 'esi-skills.read_skills.v1'
    const resource = {
      eligibility: { kind: 'current-owned-character' },
      implementation: {},
      materializationIntervalSeconds: 900,
      moduleId: 'member-audit',
      operationId: 'skills',
      resourceId: 'character-skills',
      subjectKind: 'character',
    } as const
    const disabledResource = { ...resource, moduleId: 'disabled-audit' }
    const characters = {
      future: { id: 1_404_328_064, lifecycle: '00000000-0000-4000-8000-000000000004' },
      generation: { id: 1_404_328_062, lifecycle: '00000000-0000-4000-8000-000000000002' },
      never: { id: 1_404_328_061, lifecycle: '00000000-0000-4000-8000-000000000001' },
      timed: { id: 1_404_328_063, lifecycle: '00000000-0000-4000-8000-000000000003' },
      unscoped: { id: 1_404_328_065, lifecycle: '00000000-0000-4000-8000-000000000005' },
    } as const
    try {
      await connection`
        insert into deployment_modules (module_id, enabled)
        values (${resource.moduleId}, true), (${disabledResource.moduleId}, false)
      `
      for (const [kind, character] of Object.entries(characters)) {
        await createCharacterLifecycle(connection, character.id, character.lifecycle)
        await connection`
          insert into eve_tokens (
            character_id, encrypted_tokens, access_token_expires_at, scopes, token_version
          ) values (
            ${character.id}, 'test ciphertext', now() + interval '1 hour',
            ${connection.json(kind === 'unscoped' ? [] : [requiredScope])},
            ${kind === 'generation' ? 2 : 1}
          )
        `
      }
      await connection`
        insert into platform_collection_state (
          module_id, resource_id, subject_kind, subject_lifecycle_id, subject_id,
          next_eligible_at, authorization_generation, validated_at, last_failure_class,
          failure_started_at
        ) values
          (
            ${resource.moduleId}, ${resource.resourceId}, 'character',
            ${characters.generation.lifecycle}, ${String(characters.generation.id)},
            '2026-08-27T00:00:00Z', 1, '2026-08-26T00:00:00Z', null, null
          ),
          (
            ${resource.moduleId}, ${resource.resourceId}, 'character',
            ${characters.timed.lifecycle}, ${String(characters.timed.id)},
            '2026-08-25T00:00:00Z', 1, '2026-08-24T00:00:00Z', null, null
          ),
          (
            ${resource.moduleId}, ${resource.resourceId}, 'character',
            ${characters.future.lifecycle}, ${String(characters.future.id)},
            '2026-08-27T00:00:00Z', 1, '2026-08-26T00:00:00Z', null, null
          ),
          (
            ${resource.moduleId}, ${resource.resourceId}, 'character',
            ${characters.unscoped.lifecycle}, ${String(characters.unscoped.id)},
            null, 1, null, 'authorization-required', '2026-08-25T00:00:00Z'
          )
      `

      const options = {
        connection,
        now: new Date('2026-08-26T12:00:00Z'),
        resources: [resource, disabledResource],
      }
      const expectedClassifications = [
        [characters.never, 'eligible', 'never-collected', true],
        [characters.generation, 'eligible', 'authorization-changed', true],
        [characters.timed, 'eligible', 'elapsed', true],
        [characters.future, 'eligible', 'future', false],
        [characters.unscoped, 'authorization-required', null, null],
      ] as const
      for (const [character, status, dueReason, due] of expectedClassifications) {
        const classification = await resolveInstalledResourceEligibility(
          {
            moduleId: resource.moduleId,
            resourceId: resource.resourceId,
            subjectId: String(character.id),
            subjectKind: 'character',
            subjectLifecycleId: character.lifecycle,
          },
          options,
        )
        expect(classification).toMatchObject({
          dueReason,
          status,
          ...(!(due === null) && { due }),
        })
      }

      await expect(selectDueInstalledResources({ ...options, limit: 10 })).resolves.toStrictEqual(
        [characters.never, characters.generation, characters.timed].map((character) => ({
          identity: {
            moduleId: resource.moduleId,
            resourceId: resource.resourceId,
            subjectId: String(character.id),
            subjectKind: 'character',
            subjectLifecycleId: character.lifecycle,
          },
          operationId: 'skills',
        })),
      )

      const resolveEligibility = (
        candidate: Parameters<typeof resolveInstalledResourceEligibility>[0],
      ) => resolveInstalledResourceEligibility(candidate, options)
      await expect(
        getInstalledResourceCollectionStatus(
          {
            moduleId: resource.moduleId,
            resourceId: resource.resourceId,
            subjectId: String(characters.never.id),
            subjectKind: 'character',
            subjectLifecycleId: characters.never.lifecycle,
          },
          { resolveEligibility, resources: [resource] },
        ),
      ).resolves.toMatchObject({ status: 'never-collected', validatedAt: null })
      await expect(
        getInstalledResourceCollectionStatus(
          {
            moduleId: resource.moduleId,
            resourceId: resource.resourceId,
            subjectId: String(characters.timed.id),
            subjectKind: 'character',
            subjectLifecycleId: characters.timed.lifecycle,
          },
          { resolveEligibility, resources: [resource] },
        ),
      ).resolves.toMatchObject({ status: 'stale', validatedAt: '2026-08-24T00:00:00.000Z' })
      await expect(
        getInstalledResourceCollectionStatus(
          {
            moduleId: resource.moduleId,
            resourceId: resource.resourceId,
            subjectId: String(characters.future.id),
            subjectKind: 'character',
            subjectLifecycleId: characters.future.lifecycle,
          },
          { resolveEligibility, resources: [resource] },
        ),
      ).resolves.toMatchObject({ status: 'current', validatedAt: '2026-08-26T00:00:00.000Z' })

      const loadAuthorization = vi
        .fn()
        .mockResolvedValue({ accessToken: 'private', tokenVersion: 1 })
      await expect(
        guardInstalledResourceExecution(
          {
            moduleId: resource.moduleId,
            resourceId: resource.resourceId,
            subjectId: String(characters.future.id),
            subjectKind: 'character',
            subjectLifecycleId: characters.future.lifecycle,
          },
          {
            loadCharacterCacheAuthorization: loadAuthorization,
            resolveEligibility,
            resources: [resource],
          },
        ),
      ).resolves.toStrictEqual({ outcome: 'noop', reason: 'already-current' })
      expect(loadAuthorization).not.toHaveBeenCalled()
      await expect(selectDueInstalledResources({ ...options, limit: 2 })).resolves.toStrictEqual([
        {
          identity: {
            moduleId: resource.moduleId,
            resourceId: resource.resourceId,
            subjectId: String(characters.never.id),
            subjectKind: 'character',
            subjectLifecycleId: characters.never.lifecycle,
          },
          operationId: 'skills',
        },
        {
          identity: {
            moduleId: resource.moduleId,
            resourceId: resource.resourceId,
            subjectId: String(characters.generation.id),
            subjectKind: 'character',
            subjectLifecycleId: characters.generation.lifecycle,
          },
          operationId: 'skills',
        },
      ])

      await connection`
        insert into platform_collection_state (
          module_id, resource_id, subject_kind, subject_lifecycle_id, subject_id,
          next_eligible_at, authorization_generation
        ) values (
          ${resource.moduleId}, ${resource.resourceId}, 'character',
          ${characters.never.lifecycle}, ${String(characters.never.id)},
          '2026-08-27T00:00:00Z', 1
        )
      `
      await connection`
        update platform_collection_state
        set authorization_generation = 2
        where subject_lifecycle_id = ${characters.generation.lifecycle}
      `

      await expect(selectDueInstalledResources({ ...options, limit: 2 })).resolves.toStrictEqual([
        {
          identity: {
            moduleId: resource.moduleId,
            resourceId: resource.resourceId,
            subjectId: String(characters.timed.id),
            subjectKind: 'character',
            subjectLifecycleId: characters.timed.lifecycle,
          },
          operationId: 'skills',
        },
      ])
    } finally {
      await connection.end()
    }
  })
})

describe('platform resource authority PostgreSQL persistence', () => {
  test('selects public character resources without a token', async () => {
    const connection = postgres(databaseUrl)
    const resource = {
      eligibility: { kind: 'current-owned-character' },
      implementation: {},
      materializationIntervalSeconds: 900,
      moduleId: 'public-audit',
      operationId: 'status',
      resourceId: 'character-status',
      subjectKind: 'character',
    } as const
    try {
      await connection`
        insert into deployment_modules (module_id, enabled) values (${resource.moduleId}, true)
      `
      const characterId = 1_404_328_066
      const lifecycle = '00000000-0000-4000-8000-000000000006'
      await createCharacterLifecycle(connection, characterId, lifecycle)

      await expect(
        selectDueInstalledResources({ connection, limit: 1, resources: [resource] }),
      ).resolves.toStrictEqual([
        {
          identity: {
            moduleId: resource.moduleId,
            resourceId: resource.resourceId,
            subjectId: String(characterId),
            subjectKind: 'character',
            subjectLifecycleId: lifecycle,
          },
          operationId: 'status',
        },
      ])
      // Derived queue state is disposable: without a state transition, another pass reconstructs it.
      await expect(
        selectDueInstalledResources({ connection, limit: 1, resources: [resource] }),
      ).resolves.toStrictEqual([
        {
          identity: {
            moduleId: resource.moduleId,
            resourceId: resource.resourceId,
            subjectId: String(characterId),
            subjectKind: 'character',
            subjectLifecycleId: lifecycle,
          },
          operationId: 'status',
        },
      ])
    } finally {
      await connection.end()
    }
  })

  test('binds managed-member eligibility and state to current account authority', async () => {
    const connection = postgres(databaseUrl)
    const userId = randomUUID()
    const memberLifecycleId = randomUUID()
    const characterLifecycleId = randomUUID()
    const characterId = 1_404_328_068
    const resource = {
      eligibility: { kind: 'current-managed-member-character' },
      implementation: {},
      materializationIntervalSeconds: 900,
      moduleId: 'member-audit',
      operationId: 'skills',
      resourceId: 'trained-skills',
      sectionId: 'skills',
      subjectKind: 'character',
    } as PlatformInstalledResourceDescriptor
    const identity = {
      moduleId: resource.moduleId,
      resourceId: resource.resourceId,
      subjectId: String(characterId),
      subjectKind: 'character' as const,
      subjectLifecycleId: characterLifecycleId,
    }
    try {
      await connection`
        insert into organization_epochs (
          deployment_id, organization_version, organization_type, organization_id,
          organization_name, organization_ticker
        ) values (1, 1, 'corporation', 98000001, 'Managed Corporation', 'CORP')
      `
      await connection`
        insert into deployment_settings (
          id, organization_type, organization_id,
          organization_name, organization_ticker, organization_version
        ) values (1, 'corporation', 98000001, 'Managed Corporation', 'CORP', 1)
      `
      await connection`insert into users (id) values (${userId})`
      await connection`
        insert into characters (
          character_id, user_id, owner_hash, name, corporation_id, is_main,
          affiliation_checked_at, next_affiliation_check, affiliation_resolution_state
        ) values (
          ${characterId}, ${userId}, 'managed-owner', 'Managed Pilot', 98000001, true,
          '2026-09-01T11:00:00Z', '2026-09-01T13:00:00Z', 'resolved'
        )
      `
      await connection`
        insert into platform_subject_lifecycles (
          subject_lifecycle_id, subject_kind, subject_id, character_id
        ) values (${characterLifecycleId}, 'character', ${String(characterId)}, ${characterId})
      `
      await connection`
        insert into organization_managed_corporations (
          deployment_id, organization_version, corporation_id, is_current,
          first_observed_at, last_observed_at
        ) values (1, 1, 98000001, true, '2026-09-01T11:00:00Z', '2026-09-01T11:00:00Z')
      `
      await connection`
        insert into organization_managed_member_lifecycles (
          managed_member_lifecycle_id, deployment_id, organization_version, user_id, started_at
        ) values (${memberLifecycleId}, 1, 1, ${userId}, '2026-09-01T11:00:00Z')
      `
      await connection`
        insert into deployment_modules (module_id, enabled) values (${resource.moduleId}, true)
      `
      await connection`
        insert into deployment_module_sections (
          module_id, section_id, kind, enabled, declaration_revision,
          disclosure_version, activation_version
        ) values (${resource.moduleId}, 'skills', 'sensitive-evidence', true, 1, 1, 1)
      `
      await connection`
        insert into eve_tokens (
          character_id, encrypted_tokens, access_token_expires_at, scopes, token_version
        ) values (
          ${characterId}, 'test ciphertext', now() + interval '1 hour',
          '["esi-skills.read_skills.v1"]'::jsonb, 3
        )
      `
      await connection`
        insert into character_reviewer_disclosure_acceptances (
          character_id, module_id, section_id, disclosure_version, authorization_generation
        ) values (${characterId}, ${resource.moduleId}, 'skills', 1, 3)
      `

      const externalCharacterId = 1_404_328_070
      const externalLifecycleId = randomUUID()
      await connection`
        insert into characters (
          character_id, user_id, owner_hash, name, corporation_id, is_main,
          affiliation_checked_at, next_affiliation_check, affiliation_resolution_state
        ) values (
          ${externalCharacterId}, ${userId}, 'external-owner', 'External Pilot', 98000002, false,
          '2026-09-01T11:00:00Z', '2026-09-01T13:00:00Z', 'resolved'
        )
      `
      await connection`
        insert into platform_subject_lifecycles (
          subject_lifecycle_id, subject_kind, subject_id, character_id
        ) values (
          ${externalLifecycleId}, 'character', ${String(externalCharacterId)}, ${externalCharacterId}
        )
      `
      await connection`
        insert into eve_tokens (
          character_id, encrypted_tokens, access_token_expires_at, scopes, token_version
        ) values (
          ${externalCharacterId}, 'external ciphertext', now() + interval '1 hour',
          '["esi-skills.read_skills.v1"]'::jsonb, 3
        )
      `
      await connection`
        insert into character_reviewer_disclosure_acceptances (
          character_id, module_id, section_id, disclosure_version, authorization_generation
        ) values (${externalCharacterId}, ${resource.moduleId}, 'skills', 1, 3)
      `
      await connection`
        insert into organization_character_exceptions (
          deployment_id, organization_version, user_id, character_id,
          approver_user_id, reason
        ) values (1, 1, ${userId}, ${externalCharacterId}, ${userId}, 'Approved external pilot')
      `

      const now = new Date('2026-09-01T12:00:00Z')
      const eligible = await resolveInstalledResourceEligibility(identity, {
        connection,
        now,
        resources: [resource],
      })
      expect(eligible).toMatchObject({
        authorizationGeneration: 3,
        due: true,
        dueReason: 'never-collected',
        managedAuthority: {
          disclosureVersion: 1,
          managedMemberLifecycleId: memberLifecycleId,
          organizationDeploymentId: 1,
          organizationVersion: 1,
          sectionActivationVersion: 1,
          sectionId: 'skills',
          targetUserId: userId,
        },
        status: 'eligible',
      })
      const due = await selectDueInstalledResources({
        connection,
        limit: 10,
        now,
        resources: [resource],
      })
      expect(due).toHaveLength(2)
      expect(due).toStrictEqual(
        expect.arrayContaining([
          { identity, operationId: 'skills' },
          {
            identity: {
              ...identity,
              subjectId: String(externalCharacterId),
              subjectLifecycleId: externalLifecycleId,
            },
            operationId: 'skills',
          },
        ]),
      )
      await expect(
        resolveInstalledResourceEligibility(
          {
            ...identity,
            subjectId: String(externalCharacterId),
            subjectLifecycleId: externalLifecycleId,
          },
          { connection, now, resources: [resource] },
        ),
      ).resolves.toMatchObject({
        managedAuthority: { managedMemberLifecycleId: memberLifecycleId, targetUserId: userId },
        status: 'eligible',
      })
      if (eligible.status !== 'eligible' || !eligible.managedAuthority) {
        throw new Error('Managed resource did not resolve its authority')
      }
      await upsertPlatformCollectionState(
        {
          ...identity,
          ...eligible.managedAuthority,
          authorizationGeneration: eligible.authorizationGeneration,
          lastFailureClass: null,
          nextEligibleAt: new Date('2026-09-01T12:15:00Z'),
          validatedAt: now,
        },
        drizzle(connection, { schema }),
      )
      await expect(
        resolveInstalledResourceEligibility(identity, { connection, now, resources: [resource] }),
      ).resolves.toMatchObject({ due: false, dueReason: 'future', status: 'eligible' })

      await connection`
        update eve_tokens set token_version = 4 where character_id = ${characterId}
      `
      await connection`
        update character_reviewer_disclosure_acceptances
        set authorization_generation = 4
        where character_id = ${characterId}
          and module_id = ${resource.moduleId}
          and section_id = 'skills'
      `
      await expect(
        resolveInstalledResourceEligibility(identity, { connection, now, resources: [resource] }),
      ).resolves.toMatchObject({
        authorizationGeneration: 4,
        due: true,
        dueReason: 'never-collected',
        status: 'eligible',
        validatedAt: null,
      })

      await connection`
        update organization_managed_member_lifecycles
        set ended_at = '2026-09-01T12:05:00Z'
        where managed_member_lifecycle_id = ${memberLifecycleId}
      `
      await expect(
        resolveInstalledResourceEligibility(identity, { connection, now, resources: [resource] }),
      ).resolves.toStrictEqual({ status: 'obsolete' })

      const replacementLifecycleId = randomUUID()
      await connection`
        insert into organization_managed_member_lifecycles (
          managed_member_lifecycle_id, deployment_id, organization_version, user_id,
          started_at
        ) values (${replacementLifecycleId}, 1, 1, ${userId}, '2026-09-01T12:05:00Z')
      `
      await expect(
        resolveInstalledResourceEligibility(identity, { connection, now, resources: [resource] }),
      ).resolves.toMatchObject({
        due: true,
        dueReason: 'never-collected',
        managedAuthority: { managedMemberLifecycleId: replacementLifecycleId },
        status: 'eligible',
      })

      await connection`
        update deployment_module_sections
        set disclosure_version = 2
        where module_id = ${resource.moduleId} and section_id = 'skills'
      `
      await expect(
        resolveInstalledResourceEligibility(identity, { connection, now, resources: [resource] }),
      ).resolves.toMatchObject({ status: 'authorization-required' })
    } finally {
      await connection.end()
    }
  })

  test('suppresses permanent failures and reactivates generation-bound state changes', async () => {
    const connection = postgres(databaseUrl)
    const resource = {
      eligibility: { kind: 'current-owned-character' },
      implementation: {},
      materializationIntervalSeconds: 900,
      moduleId: 'failure-audit',
      operationId: 'skills',
      resourceId: 'character-skills',
      subjectKind: 'character',
    } as const
    const characterId = 1_404_328_067
    const lifecycle = '00000000-0000-4000-8000-000000000007'
    const identity = {
      moduleId: resource.moduleId,
      resourceId: resource.resourceId,
      subjectId: String(characterId),
      subjectKind: 'character' as const,
      subjectLifecycleId: lifecycle,
    }
    try {
      await connection`
        insert into deployment_modules (module_id, enabled) values (${resource.moduleId}, true)
      `
      await createCharacterLifecycle(connection, characterId, lifecycle)
      await connection`
        insert into eve_tokens (
          character_id, encrypted_tokens, access_token_expires_at, scopes, token_version
        ) values (
          ${characterId}, 'test ciphertext', now() + interval '1 hour',
          '["esi-skills.read_skills.v1"]'::jsonb, 1
        )
      `
      await connection`
        insert into platform_collection_state (
          module_id, resource_id, subject_kind, subject_lifecycle_id, subject_id,
          next_eligible_at, authorization_generation, validated_at, last_failure_class,
          failure_started_at
        ) values (
          ${identity.moduleId}, ${identity.resourceId}, 'character', ${lifecycle},
          ${identity.subjectId}, null, 1, '2026-08-25T12:00:00Z', 'mapping-failed',
          '2026-08-25T13:00:00Z'
        )
      `

      await expect(
        resolveInstalledResourceEligibility(identity, { connection, resources: [resource] }),
      ).resolves.toMatchObject({
        lastFailureClass: 'mapping-failed',
        status: 'suppressed',
      })
      await expect(
        selectDueInstalledResources({ connection, limit: 1, resources: [resource] }),
      ).resolves.toStrictEqual([])

      await connection`
        update eve_tokens set token_version = 2 where character_id = ${characterId}
      `
      await expect(
        resolveInstalledResourceEligibility(identity, { connection, resources: [resource] }),
      ).resolves.toMatchObject({
        due: true,
        dueReason: 'authorization-changed',
        status: 'eligible',
      })
    } finally {
      await connection.end()
    }
  })

  test('keeps realistic classifier planning bounded without making an index semantic', async () => {
    const connection = postgres(databaseUrl)
    const moduleId = 'plan-audit'
    const resources = JSON.stringify([
      {
        module_id: moduleId,
        operation_id: 'skills',
        required_scope: 'esi-skills.read_skills.v1',
        resource_id: 'character-skills',
        subject_kind: 'character',
      },
    ])
    try {
      await connection`insert into deployment_modules (module_id, enabled) values (${moduleId}, true)`
      await connection`
        insert into users (id)
        select md5('plan-user-' || value::text)::uuid
        from generate_series(1, 250) value
      `
      await connection`
        insert into characters (character_id, user_id, owner_hash, name, corporation_id, is_main)
        select 1500000000 + value, md5('plan-user-' || value::text)::uuid,
          'plan-owner-' || value::text, 'Plan Character ' || value::text, 98000001, true
        from generate_series(1, 250) value
      `
      await connection`
        insert into platform_subject_lifecycles (
          subject_lifecycle_id, subject_kind, subject_id, character_id
        )
        select ('40000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid, 'character',
          (1500000000 + value)::text, 1500000000 + value
        from generate_series(1, 250) value
      `
      await connection`
        insert into eve_tokens (
          character_id, encrypted_tokens, access_token_expires_at, scopes, token_version
        )
        select 1500000000 + value, 'test ciphertext', now() + interval '1 hour',
          '["esi-skills.read_skills.v1"]'::jsonb, 1
        from generate_series(1, 250) value
      `
      await connection`
        insert into platform_collection_state (
          module_id, resource_id, subject_kind, subject_lifecycle_id, subject_id,
          next_eligible_at, authorization_generation, validated_at
        )
        select ${moduleId}, 'character-skills', 'character',
          ('40000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
          (1500000000 + value)::text,
          case
            when value % 4 = 0 then null
            when value % 4 = 1 then '2026-08-25T00:00:00Z'::timestamptz
            else '2026-08-27T00:00:00Z'::timestamptz
          end,
          case when value % 7 = 0 then 0 else 1 end,
          '2026-08-24T00:00:00Z'::timestamptz
        from generate_series(1, 225) value
      `

      const [explained] = await connection<{ 'QUERY PLAN': unknown }[]>`
        explain (analyze, format json)
        select module_id, resource_id, subject_lifecycle_id, subject_id
        from platform_classify_resources(
          ${resources}::text::jsonb,
          '2026-08-26T12:00:00Z'::timestamptz
        )
        where eligibility_status = 'eligible' and due_reason <> 'future'
        order by scheduling_key, module_id, resource_id, subject_kind,
          subject_lifecycle_id, subject_id
        limit 25
      `
      expect(explained?.['QUERY PLAN']).toBeDefined()
      expect(JSON.stringify(explained?.['QUERY PLAN'])).toContain('Actual Rows')
      await expect(
        selectDueInstalledResources({
          connection,
          limit: 25,
          now: new Date('2026-08-26T12:00:00Z'),
          resources: [
            {
              eligibility: { kind: 'current-owned-character' },
              implementation: {},
              materializationIntervalSeconds: 900,
              moduleId,
              operationId: 'skills',
              resourceId: 'character-skills',
              subjectKind: 'character',
            },
          ],
        }),
      ).resolves.toHaveLength(25)
    } finally {
      await connection.end()
    }
  })

  test('versions public deployment resources independently of alliance coverage', async () => {
    const resource = {
      ...coreResources[0],
      eligibility: { kind: 'current-deployment' },
      subjectKind: 'deployment',
    } as const
    const connection = postgres(databaseUrl)
    const adminId = randomUUID()
    const firstLifecycleId = randomUUID()
    const secondLifecycleId = randomUUID()
    try {
      await connection`
        insert into deployment_admins (id, email, password_hash)
        values (${adminId}, 'alliance-owner@example.com', 'hash')
      `
      await connection`
        insert into organization_epochs (
          deployment_id, organization_version, organization_type, organization_id,
          organization_name, organization_ticker
        ) values (1, 1, 'alliance', 99000001, 'Managed Alliance', 'ALLY')
      `
      await connection`
        insert into deployment_settings (
          id, organization_type, organization_id,
          organization_name, organization_ticker, organization_version
        ) values (1, 'alliance', 99000001, 'Managed Alliance', 'ALLY', 1)
      `
      await connection`
        insert into platform_subject_lifecycles (
          subject_lifecycle_id, subject_kind, subject_id,
          organization_deployment_id, organization_version
        ) values (${firstLifecycleId}, 'deployment', '1', 1, 1)
      `
      const firstIdentity = {
        moduleId: 'core',
        resourceId: 'managed-corporations',
        subjectId: '1',
        subjectKind: 'deployment' as const,
        subjectLifecycleId: firstLifecycleId,
      }

      await expect(
        selectDueInstalledResources({ connection, limit: 10, resources: [resource] }),
      ).resolves.toStrictEqual([{ identity: firstIdentity, operationId: 'alliance-corporations' }])

      await connection.begin(async (transaction) => {
        await transaction`
          insert into organization_epochs (
            deployment_id, organization_version, organization_type, organization_id,
            organization_name, organization_ticker
          ) values (1, 2, 'alliance', 99000001, 'Managed Alliance', 'ALLY')
        `
        await transaction`
          update organization_epochs
          set superseded_at = clock_timestamp()
          where deployment_id = 1 and organization_version = 1
        `
        await transaction`
          update deployment_settings set organization_version = 2 where id = 1
        `
        await transaction`
          insert into platform_subject_lifecycles (
            subject_lifecycle_id, subject_kind, subject_id,
            organization_deployment_id, organization_version
          ) values (${secondLifecycleId}, 'deployment', '1', 1, 2)
        `
      })

      await expect(
        resolveInstalledResourceEligibility(firstIdentity, {
          connection,
          resources: [resource],
        }),
      ).resolves.toStrictEqual({ status: 'obsolete' })
      await expect(
        selectDueInstalledResources({ connection, limit: 10, resources: [resource] }),
      ).resolves.toStrictEqual([
        {
          identity: { ...firstIdentity, subjectLifecycleId: secondLifecycleId },
          operationId: 'alliance-corporations',
        },
      ])
    } finally {
      await connection.end()
    }
  })

  test('versions alliance resource lifecycles and makes superseded work obsolete', async () => {
    const connection = postgres(databaseUrl)
    const adminId = randomUUID()
    const firstLifecycleId = randomUUID()
    const secondLifecycleId = randomUUID()
    try {
      await connection`
        insert into deployment_admins (id, email, password_hash)
        values (${adminId}, 'alliance-owner@example.com', 'hash')
      `
      await connection`
        insert into organization_epochs (
          deployment_id, organization_version, organization_type, organization_id,
          organization_name, organization_ticker
        ) values (1, 1, 'alliance', 99000001, 'Managed Alliance', 'ALLY')
      `
      await connection`
        insert into deployment_settings (
          id, organization_type, organization_id,
          organization_name, organization_ticker, organization_version
        ) values (1, 'alliance', 99000001, 'Managed Alliance', 'ALLY', 1)
      `
      await connection`
        insert into platform_subject_lifecycles (
          subject_lifecycle_id, subject_kind, subject_id,
          organization_deployment_id, organization_version
        ) values (${firstLifecycleId}, 'alliance', '99000001', 1, 1)
      `
      const firstIdentity = {
        moduleId: 'core',
        resourceId: 'managed-corporations',
        subjectId: '99000001',
        subjectKind: 'alliance' as const,
        subjectLifecycleId: firstLifecycleId,
      }

      await expect(
        selectDueInstalledResources({ connection, limit: 10, resources: [coreResources[0]] }),
      ).resolves.toStrictEqual([{ identity: firstIdentity, operationId: 'alliance-corporations' }])

      await connection.begin(async (transaction) => {
        await transaction`
          insert into organization_epochs (
            deployment_id, organization_version, organization_type, organization_id,
            organization_name, organization_ticker
          ) values (1, 2, 'alliance', 99000001, 'Managed Alliance', 'ALLY')
        `
        await transaction`
          update organization_epochs
          set superseded_at = clock_timestamp()
          where deployment_id = 1 and organization_version = 1
        `
        await transaction`
          update deployment_settings set organization_version = 2 where id = 1
        `
        await transaction`
          insert into platform_subject_lifecycles (
            subject_lifecycle_id, subject_kind, subject_id,
            organization_deployment_id, organization_version
          ) values (${secondLifecycleId}, 'alliance', '99000001', 1, 2)
        `
      })

      await expect(
        resolveInstalledResourceEligibility(firstIdentity, {
          connection,
          resources: [coreResources[0]],
        }),
      ).resolves.toStrictEqual({ status: 'obsolete' })
      await expect(
        selectDueInstalledResources({ connection, limit: 10, resources: [coreResources[0]] }),
      ).resolves.toStrictEqual([
        {
          identity: { ...firstIdentity, subjectLifecycleId: secondLifecycleId },
          operationId: 'alliance-corporations',
        },
      ])
    } finally {
      await connection.end()
    }
  })

  test('binds corporation collection to one active source and replaces full roster snapshots', async () => {
    const connection = postgres(databaseUrl)
    const database = drizzle(connection, { schema })
    const adminId = randomUUID()
    const userId = randomUUID()
    const characterId = 1_404_328_080
    const sourceId = randomUUID()
    const replacementSourceId = randomUUID()
    const sourceLifecycleId = randomUUID()
    const replacementLifecycleId = randomUUID()
    try {
      await connection`
        insert into deployment_admins (id, email, password_hash)
        values (${adminId}, 'corporation-owner@example.com', 'hash')
      `
      await connection`
        insert into organization_epochs (
          deployment_id, organization_version, organization_type, organization_id,
          organization_name, organization_ticker
        ) values (1, 1, 'corporation', 98000001, 'Managed Corporation', 'CORP')
      `
      await connection`
        insert into deployment_settings (
          id, organization_type, organization_id,
          organization_name, organization_ticker, organization_version
        ) values (1, 'corporation', 98000001, 'Managed Corporation', 'CORP', 1)
      `
      await connection`
        insert into organization_managed_corporations (
          deployment_id, organization_version, corporation_id, first_observed_at, last_observed_at
        ) values (1, 1, 98000001, now(), now())
      `
      await connection`insert into users (id) values (${userId})`
      await connection`
        insert into characters (
          character_id, user_id, owner_hash, name, corporation_id, is_main,
          affiliation_resolution_state, affiliation_checked_at, next_affiliation_check
        ) values (
          ${characterId}, ${userId}, 'source-owner', 'Source Pilot', 98000001, true,
          'resolved', now(), now() + interval '1 hour'
        )
      `
      const characterLifecycleId = await connection<{ subject_lifecycle_id: string }[]>`
        insert into platform_subject_lifecycles (subject_kind, subject_id, character_id)
        values ('character', ${String(characterId)}, ${characterId})
        returning subject_lifecycle_id
      `.then(([row]) => row!.subject_lifecycle_id)
      await connection`
        insert into eve_tokens (
          character_id, encrypted_tokens, access_token_expires_at, scopes, token_version
        ) values (
          ${characterId}, 'test ciphertext', now() + interval '1 hour',
          '[
            "esi-characters.read_corporation_roles.v1",
            "esi-corporations.read_corporation_membership.v1"
          ]'::jsonb, 7
        )
      `
      const roleRevision = await seedCurrentDirectorObservation(connection, {
        authorizationGeneration: 7,
        characterId,
        subjectLifecycleId: characterLifecycleId,
        userId,
      })
      await connection`
        insert into organization_corporation_sources (
          source_id, deployment_id, organization_version, corporation_id,
          character_id, evidence_character_id, source_user_id, source_subject_lifecycle_id,
          authorization_generation, role_evidence_revision, affiliation_period_revision,
          observed_corporation_id, required_scope, director_role_present, observed_at,
          fresh_until, status, registered_by_user_id
        ) values (
          ${sourceId}, 1, 1, 98000001, ${characterId}, ${characterId}, ${userId},
          ${characterLifecycleId}, 7, ${roleRevision},
          (select affiliation_period_revision from characters where character_id = ${characterId}),
          98000001, 'esi-corporations.read_corporation_membership.v1', true, now(),
          now() + interval '1 hour', 'fresh', ${userId}
        )
      `
      await connection`
        insert into platform_subject_lifecycles (
          subject_lifecycle_id, subject_kind, subject_id, corporation_source_id
        ) values (${sourceLifecycleId}, 'corporation', '98000001', ${sourceId})
      `
      const identity = {
        moduleId: 'core',
        resourceId: 'corporation-roster',
        subjectId: '98000001',
        subjectKind: 'corporation' as const,
        subjectLifecycleId: sourceLifecycleId,
      }

      await expect(
        selectDueInstalledResources({ connection, limit: 10, resources: [coreResources[1]] }),
      ).resolves.toStrictEqual([
        { authorizationCharacterId: characterId, identity, operationId: 'corporation-members' },
      ])
      await expect(
        resolveInstalledResourceEligibility(identity, {
          connection,
          resources: [coreResources[1]],
        }),
      ).resolves.toMatchObject({
        authorizationCharacterId: characterId,
        authorizationCharacterLifecycleId: characterLifecycleId,
        authorizationGeneration: 7,
        status: 'eligible',
      })

      const jobsScope = 'esi-corporations.read_freelance_jobs.v1'
      const jobsResource = {
        ...coreResources[1],
        resourceId: 'corporation-role-jobs',
        operationId: 'organization-activity-corporation-jobs',
        dependentOperationIds: [],
      } as const satisfies PlatformInstalledResourceDescriptor
      const jobsIdentity = { ...identity, resourceId: jobsResource.resourceId }
      await connection`
        update eve_tokens set scopes = ${JSON.stringify([
          'esi-characters.read_corporation_roles.v1',
          'esi-corporations.read_corporation_membership.v1',
          jobsScope,
        ])}::jsonb
        where character_id = ${characterId}
      `
      await connection`
        update character_corporation_role_contents set roles = '{Director,Project_Manager}'
        where observation_id in (
          select observation_id from character_corporation_role_observations
          where character_id = ${characterId}
        )
      `
      await expect(
        resolveInstalledResourceEligibility(jobsIdentity, {
          connection,
          resources: [jobsResource],
        }),
      ).resolves.toMatchObject({ status: 'eligible' })
      await expect(
        selectDueInstalledResources({
          connection,
          limit: 10,
          resources: [jobsResource],
        }),
      ).resolves.toEqual([expect.objectContaining({ identity: jobsIdentity })])
      const secondJobs = { ...jobsResource, resourceId: 'corporation-role-jobs-2' }
      const ordered = await selectDueInstalledResources({
        connection,
        limit: 2,
        resources: [secondJobs, jobsResource],
      })
      expect(ordered.map(({ identity: dueIdentity }) => dueIdentity.resourceId)).toEqual([
        jobsResource.resourceId,
        secondJobs.resourceId,
      ])
      expect(
        (
          await selectDueInstalledResources({
            connection,
            limit: 1,
            resources: [secondJobs, jobsResource],
          })
        ).map(({ identity: dueIdentity }) => dueIdentity.resourceId),
      ).toEqual([jobsResource.resourceId])
      await connection.begin(async (transaction) => {
        await expect(
          resolveInstalledResourceEligibility(jobsIdentity, {
            connection: transaction,
            lockAuthority: true,
            resources: [jobsResource],
          }),
        ).resolves.toMatchObject({ status: 'eligible' })
      })
      await connection`
        insert into deployment_modules (module_id, enabled)
        values ('organization-activity', true)
        on conflict (module_id) do update set enabled = excluded.enabled
      `
      const moduleResource = { ...jobsResource, moduleId: 'organization-activity' }
      const moduleIdentity = { ...jobsIdentity, moduleId: moduleResource.moduleId }
      const admitted = await resolveInstalledResourceEligibility(moduleIdentity, {
        connection,
        resources: [moduleResource],
      })
      expect(admitted.status).toBe('eligible')
      if (admitted.status !== 'eligible' || !admitted.corporationAuthorityFence) {
        throw new Error('Current corporation authority fence is missing')
      }
      const observation = {
        authorizationCharacterId: characterId,
        authorizationCharacterLifecycleId: characterLifecycleId,
        authorizationGeneration: 7,
        corporationAuthorityFence: admitted.corporationAuthorityFence,
        data: { snapshots: [] },
        identity: moduleIdentity,
        managedAuthority: null,
        organizationVersion: 1,
        outcome: 'complete' as const,
        resource: moduleResource,
        subject: {
          kind: 'corporation' as const,
          corporationId: 98_000_001,
          lifecycleId: sourceLifecycleId,
        },
        validatedAt: new Date().toISOString(),
      }
      await connection.begin(async (transaction) => {
        const [updated] = await transaction<{ role_revision: string }[]>`
          update character_corporation_role_observations
          set role_revision = gen_random_uuid()
          where character_id = ${characterId}
          returning role_revision
        `
        await transaction`
          update organization_corporation_sources
          set role_evidence_revision = ${updated!.role_revision}
          where source_id = ${sourceId}
        `
      })
      await applyInstalledResourceObservation(observation, { connection })
      const [uncommitted] = await connection<{ count: number }[]>`
        select count(*)::integer as count from platform_collection_state
        where module_id = 'organization-activity' and resource_id = ${moduleResource.resourceId}
      `
      expect(uncommitted?.count).toBe(0)
      const revalidated = await resolveInstalledResourceEligibility(moduleIdentity, {
        connection,
        resources: [moduleResource],
      })
      if (revalidated.status !== 'eligible' || !revalidated.corporationAuthorityFence) {
        throw new Error('Revalidated corporation authority fence is missing')
      }
      const currentObservation = {
        ...observation,
        corporationAuthorityFence: revalidated.corporationAuthorityFence,
      }
      await connection`
        update character_corporation_role_contents set roles = '{Director}'
        where observation_id in (
          select observation_id from character_corporation_role_observations
          where character_id = ${characterId}
        )
      `
      await expect(
        resolveInstalledResourceEligibility(jobsIdentity, {
          connection,
          resources: [jobsResource],
        }),
      ).resolves.toMatchObject({
        status: 'authorization-required',
        authorizationReason: 'role-unsatisfied',
      })
      await connection.begin(async (transaction) => {
        await expect(
          resolveInstalledResourceEligibility(jobsIdentity, {
            connection: transaction,
            lockAuthority: true,
            resources: [jobsResource],
          }),
        ).resolves.toMatchObject({
          status: 'authorization-required',
          authorizationReason: 'role-unsatisfied',
        })
      })
      await expect(
        guardInstalledResourceExecution(jobsIdentity, {
          resources: [jobsResource],
          resolveEligibility: (currentIdentity, options) =>
            resolveInstalledResourceEligibility(currentIdentity, {
              connection,
              resources: options?.resources,
              signal: options?.signal,
            }),
        }),
      ).resolves.toMatchObject({ outcome: 'noop', reason: 'authorization-required' })
      await expect(
        selectDueInstalledResources({
          connection,
          limit: 10,
          resources: [jobsResource],
        }),
      ).resolves.toEqual([])
      await verifyPlannerSkipsDeniedPrefix(connection, jobsResource)
      await assertNoModuleCommit(connection, currentObservation)
      await connection`
        update character_corporation_role_contents set roles = '{Director,Project_Manager}'
        where observation_id in (
          select observation_id from character_corporation_role_observations
          where character_id = ${characterId}
        )
      `
      await connection`
        update eve_tokens set scopes = ${JSON.stringify([
          'esi-characters.read_corporation_roles.v1',
          'esi-corporations.read_corporation_membership.v1',
        ])}::jsonb where character_id = ${characterId}
      `
      await assertNoModuleCommit(connection, currentObservation)
      await connection`
        update eve_tokens set scopes = ${JSON.stringify([
          'esi-characters.read_corporation_roles.v1',
          'esi-corporations.read_corporation_membership.v1',
          jobsScope,
        ])}::jsonb, token_version = 8 where character_id = ${characterId}
      `
      await assertNoModuleCommit(connection, currentObservation)
      await connection`update eve_tokens set token_version = 7 where character_id = ${characterId}`

      await database.transaction((transaction) =>
        materializeCoreResourceObservation(transaction, {
          authorizationGeneration: 7,
          data: [90_000_001, 90_000_002],
          resourceId: 'corporation-roster',
          subject: {
            corporationId: 98_000_001,
            kind: 'corporation',
            lifecycleId: sourceLifecycleId,
          },
          validatedAt: new Date('2026-09-01T10:00:00Z'),
        }),
      )
      await database.transaction((transaction) =>
        materializeCoreResourceObservation(transaction, {
          authorizationGeneration: 7,
          data: [90_000_002],
          resourceId: 'corporation-roster',
          subject: {
            corporationId: 98_000_001,
            kind: 'corporation',
            lifecycleId: sourceLifecycleId,
          },
          validatedAt: new Date('2026-09-01T11:00:00Z'),
        }),
      )
      await expect(
        connection<{ character_id: string }[]>`
        select character_id from organization_corporation_roster_observations order by character_id
      `.then((rows) => [...rows]),
      ).resolves.toStrictEqual([{ character_id: '90000002' }])

      await connection`
        update eve_tokens set scopes = '[]'::jsonb where character_id = ${characterId}
      `
      await expect(
        resolveInstalledResourceEligibility(identity, {
          connection,
          resources: [coreResources[1]],
        }),
      ).resolves.toMatchObject({ status: 'authorization-required' })
      await connection`
        update eve_tokens
        set scopes = '[
          "esi-characters.read_corporation_roles.v1",
          "esi-corporations.read_corporation_membership.v1"
        ]'::jsonb
        where character_id = ${characterId}
      `
      await connection`
        update characters set affiliation_resolution_state = 'pending'
        where character_id = ${characterId}
      `
      await expect(
        resolveInstalledResourceEligibility(identity, {
          connection,
          resources: [coreResources[1]],
        }),
      ).resolves.toMatchObject({ status: 'authorization-required' })
      await connection`
        update characters
        set affiliation_resolution_state = 'resolved',
            next_affiliation_check = now() - interval '1 second'
        where character_id = ${characterId}
      `
      await expect(
        resolveInstalledResourceEligibility(identity, {
          connection,
          resources: [coreResources[1]],
        }),
      ).resolves.toMatchObject({ status: 'authorization-required' })
      await expect(
        selectDueInstalledResources({ connection, limit: 10, resources: [coreResources[1]] }),
      ).resolves.toStrictEqual([])
      await connection`
        update characters set next_affiliation_check = now() + interval '1 hour'
        where character_id = ${characterId}
      `

      await connection`
        update organization_corporation_sources
        set revoked_at = now(), revoked_by_user_id = ${userId}, revocation_reason = 'Replacement'
        where source_id = ${sourceId}
      `
      await connection`
        insert into organization_corporation_sources (
          source_id, deployment_id, organization_version, corporation_id,
          character_id, evidence_character_id, source_user_id, source_subject_lifecycle_id,
          authorization_generation, role_evidence_revision, observed_corporation_id,
          required_scope, director_role_present, observed_at, fresh_until, status,
          registered_by_user_id
        ) values (
          ${replacementSourceId}, 1, 1, 98000001, ${characterId}, ${characterId}, ${userId},
          ${characterLifecycleId}, 7, 'roles-2', 98000001,
          'esi-corporations.read_corporation_membership.v1', true, now(),
          now() + interval '1 hour', 'fresh', ${userId}
        )
      `
      await connection`
        insert into platform_subject_lifecycles (
          subject_lifecycle_id, subject_kind, subject_id, corporation_source_id
        ) values (${replacementLifecycleId}, 'corporation', '98000001', ${replacementSourceId})
      `
      await assertNoModuleCommit(connection, currentObservation)
      await expect(
        resolveInstalledResourceEligibility(identity, {
          connection,
          resources: [coreResources[1]],
        }),
      ).resolves.toStrictEqual({ status: 'obsolete' })
      await expect(
        selectDueInstalledResources({ connection, limit: 10, resources: [coreResources[1]] }),
      ).resolves.toStrictEqual([
        {
          authorizationCharacterId: characterId,
          identity: { ...identity, subjectLifecycleId: replacementLifecycleId },
          operationId: 'corporation-members',
        },
      ])
    } finally {
      await connection.end()
    }
  })

  test('materializes alliance departures with stable secret-free domain events', async () => {
    const connection = postgres(databaseUrl)
    const database = drizzle(connection, { schema })
    const adminId = randomUUID()
    const lifecycleId = randomUUID()
    try {
      await connection`
        insert into deployment_admins (id, email, password_hash)
        values (${adminId}, 'event-owner@example.com', 'hash')
      `
      await connection`
        insert into organization_epochs (
          deployment_id, organization_version, organization_type, organization_id,
          organization_name, organization_ticker
        ) values (1, 1, 'alliance', 99000001, 'Managed Alliance', 'ALLY')
      `
      await connection`
        insert into deployment_settings (
          id, organization_type, organization_id,
          organization_name, organization_ticker, organization_version
        ) values (1, 'alliance', 99000001, 'Managed Alliance', 'ALLY', 1)
      `
      await connection`
        insert into platform_subject_lifecycles (
          subject_lifecycle_id, subject_kind, subject_id,
          organization_deployment_id, organization_version
        ) values (${lifecycleId}, 'alliance', '99000001', 1, 1)
      `

      await database.transaction((transaction) =>
        materializeCoreResourceObservation(transaction, {
          authorizationGeneration: null,
          data: [98_000_001, 98_000_002],
          resourceId: 'managed-corporations',
          subject: { allianceId: 99_000_001, kind: 'alliance', lifecycleId },
          validatedAt: new Date('2026-09-01T10:00:00Z'),
        }),
      )
      await database.transaction((transaction) =>
        materializeCoreResourceObservation(transaction, {
          authorizationGeneration: null,
          data: [98_000_002],
          resourceId: 'managed-corporations',
          subject: { allianceId: 99_000_001, kind: 'alliance', lifecycleId },
          validatedAt: new Date('2026-09-01T11:00:00Z'),
        }),
      )

      await expect(
        connection<{ corporation_id: string; is_current: boolean }[]>`
        select corporation_id, is_current
        from organization_managed_corporations
        order by corporation_id
      `.then((rows) => [...rows]),
      ).resolves.toStrictEqual([
        { corporation_id: '98000001', is_current: false },
        { corporation_id: '98000002', is_current: true },
      ])
      await expect(
        connection<{ event_type: string; payload: unknown }[]>`
        select event_type, payload
        from domain_events
        order by event_sequence
      `.then((rows) => [...rows]),
      ).resolves.toStrictEqual([
        {
          event_type: 'organization.managed-corporation-added',
          payload: { corporationId: 98_000_001, deploymentId: 1, organizationVersion: 1 },
        },
        {
          event_type: 'organization.managed-corporation-added',
          payload: { corporationId: 98_000_002, deploymentId: 1, organizationVersion: 1 },
        },
        {
          event_type: 'organization.managed-corporation-removed',
          payload: { corporationId: 98_000_001, deploymentId: 1, organizationVersion: 1 },
        },
      ])
    } finally {
      await connection.end()
    }
  })
})

async function createCharacterLifecycle(
  connection: postgres.Sql,
  characterId: number,
  subjectLifecycleId?: string,
) {
  const userId = randomUUID()
  await connection`insert into users (id) values (${userId})`
  await connection`
    insert into characters (character_id, user_id, owner_hash, name, corporation_id, is_main)
    values (${characterId}, ${userId}, ${`owner-${characterId}`}, 'Lifecycle Character', 98000001, true)
  `
  const [lifecycle] = subjectLifecycleId
    ? await connection<{ subject_lifecycle_id: string }[]>`
        insert into platform_subject_lifecycles (
          subject_lifecycle_id, subject_kind, subject_id, character_id
        ) values (${subjectLifecycleId}, 'character', ${String(characterId)}, ${characterId})
        returning subject_lifecycle_id
      `
    : await connection<{ subject_lifecycle_id: string }[]>`
        insert into platform_subject_lifecycles (subject_kind, subject_id, character_id)
        values ('character', ${String(characterId)}, ${characterId})
        returning subject_lifecycle_id
      `
  if (!lifecycle) {
    throw new Error('Failed to create test character lifecycle')
  }
  return lifecycle.subject_lifecycle_id
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

async function seedCurrentDirectorObservation(
  connection: postgres.Sql,
  input: {
    readonly characterId: number
    readonly userId: string
    readonly subjectLifecycleId: string
    readonly authorizationGeneration: number
  },
) {
  return connection.begin(async (transaction) => {
    const [observation] = await transaction<{ observation_id: string; role_revision: string }[]>`
      insert into character_corporation_role_observations (
        organization_version, user_id, character_id, source_subject_lifecycle_id,
        affiliation_period_revision, authority_corporation_id, authorization_generation,
        required_scope, role_revision, status, validated_at, esi_fresh_until, fresh_until,
        next_refresh_at, last_checked_at, last_applied_observation_sequence
      )
      select 1, ${input.userId}, ${input.characterId}, ${input.subjectLifecycleId},
        character.affiliation_period_revision, character.corporation_id,
        ${input.authorizationGeneration}, 'esi-characters.read_corporation_roles.v1',
        gen_random_uuid(), 'fresh', now(), now() + interval '1 hour',
        now() + interval '1 hour', now() + interval '1 hour', now(),
        nextval('character_corporation_role_observation_sequence')
      from characters character
      where character.character_id = ${input.characterId}
      returning observation_id, role_revision
    `
    if (!observation) {
      throw new Error('Role observation fixture is missing')
    }
    await transaction`
      insert into character_corporation_role_contents (
        observation_id, roles, roles_at_base, roles_at_hq, roles_at_other
      ) values (${observation.observation_id}, '{Director}', '{}', '{}', '{}')
    `
    return observation.role_revision
  })
}
