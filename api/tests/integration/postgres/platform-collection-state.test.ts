import { drizzle } from 'drizzle-orm/postgres-js'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { runMigrations } from '../../../src/db/migration-runner.js'
import * as schema from '../../../src/db/schema.js'
import { findCharacterTokenForLifecycle } from '../../../src/auth/store.js'
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

describe('platform collection state PostgreSQL persistence', () => {
  test('creates the constrained composite identity and deterministic due index', async () => {
    const connection = postgres(databaseUrl)
    try {
      const constraints = await connection<{ conname: string }[]>`
        select conname
        from pg_constraint
        where conrelid = 'platform_collection_state'::regclass
        order by conname
      `
      expect(constraints.map(({ conname }) => conname)).toEqual(
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
      expect(indexes.map(({ indexname }) => indexname)).toEqual(
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
        subjectKind: 'character' as const,
        subjectLifecycleId: lifecycleId,
        subjectId: String(characterId),
      }
      const first = await upsertPlatformCollectionState(
        {
          ...identity,
          nextEligibleAt: new Date('2026-08-26T12:00:00Z'),
          authorizationGeneration: 2,
          validatedAt,
          lastFailureClass: null,
        },
        database,
      )
      expect(first.validatedAt).toEqual(validatedAt)

      const updated = await upsertPlatformCollectionState(
        {
          ...identity,
          nextEligibleAt: null,
          authorizationGeneration: 3,
          validatedAt,
          lastFailureClass: 'authorization-required',
        },
        database,
      )
      expect(updated).toMatchObject({
        authorizationGeneration: 3,
        lastFailureClass: 'authorization-required',
        nextEligibleAt: null,
        validatedAt,
      })
      expect(updated.createdAt).toEqual(first.createdAt)

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
      expect(detachedCounts).toEqual({ collection_states: 0, lifecycles: 0, module_records: 0 })

      const replacementLifecycleId = await createCharacterLifecycle(connection, characterId)
      expect(replacementLifecycleId).not.toBe(lifecycleId)
      await expect(
        upsertPlatformCollectionState(
          {
            ...identity,
            nextEligibleAt: null,
            authorizationGeneration: 3,
            validatedAt,
            lastFailureClass: null,
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
            subjectLifecycleId: replacementLifecycleId,
            nextEligibleAt: null,
            authorizationGeneration: 0,
            validatedAt: null,
            lastFailureClass: null,
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
      moduleId: 'member-audit',
      resourceId: 'character-skills',
      subjectKind: 'character',
      operationId: 'skills',
      materializationIntervalSeconds: 900,
      eligibility: { kind: 'current-owned-character' },
      implementation: {},
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
        subjectKind: 'character' as const,
        subjectLifecycleId: lifecycleId,
        subjectId: String(characterId),
      }
      const eligibilityOptions = { connection, resources: [resource] }

      await expect(
        resolveInstalledResourceEligibility(identity, eligibilityOptions),
      ).resolves.toMatchObject({ status: 'eligible', due: true, authorizationGeneration: 1 })

      await connection`
        update eve_tokens set scopes = '[]'::jsonb, token_version = 2
        where character_id = ${characterId}
      `
      await expect(
        resolveInstalledResourceEligibility(identity, eligibilityOptions),
      ).resolves.toMatchObject({
        status: 'authorization-required',
        authorizationGeneration: 2,
        requiredScope,
      })
      await repairPlatformCollectionState({ connection, resources: [resource], characterId })
      await expect(loadPlatformCollectionState(identity, database)).resolves.toMatchObject({
        authorizationGeneration: 2,
        nextEligibleAt: null,
        validatedAt: null,
        lastFailureClass: 'authorization-required',
      })

      await connection`
        update eve_tokens
        set scopes = ${JSON.stringify([requiredScope])}::jsonb, token_version = 3
        where character_id = ${characterId}
      `
      await expect(
        resolveInstalledResourceEligibility(identity, eligibilityOptions),
      ).resolves.toMatchObject({ status: 'eligible', due: true, authorizationGeneration: 3 })
      await repairPlatformCollectionState({ connection, resources: [resource], characterId })
      await expect(loadPlatformCollectionState(identity, database)).resolves.toMatchObject({
        authorizationGeneration: 3,
        lastFailureClass: null,
      })
      const convergedRepairState = await loadPlatformCollectionState(identity, database)
      await repairPlatformCollectionState({ connection, resources: [resource], characterId })
      await expect(loadPlatformCollectionState(identity, database)).resolves.toEqual(
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
        validatedAt: new Date(validatedAt),
        nextEligibleAt: new Date('2026-08-26T10:15:00.000Z'),
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
      ).resolves.toEqual({ status: 'obsolete' })
      await expect(loadPlatformCollectionState(identity, database)).resolves.toBeNull()
      const loadCharacterAuthorization = vi.fn()
      await expect(
        guardInstalledResourceExecution(identity, {
          resources: [resource],
          resolveEligibility: (candidate) =>
            resolveInstalledResourceEligibility(candidate, eligibilityOptions),
          loadCharacterAuthorization,
        }),
      ).resolves.toEqual({ outcome: 'noop', reason: 'obsolete' })
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
      ).resolves.toMatchObject({ tokenVersion: 0, scopes: [requiredScope] })
      await expect(
        resolveInstalledResourceEligibility(
          { ...identity, subjectLifecycleId: replacementLifecycleId },
          eligibilityOptions,
        ),
      ).resolves.toMatchObject({ status: 'eligible', due: true, authorizationGeneration: 0 })
    } finally {
      await connection.end()
    }
  })

  test('selects deterministic bounded due prefixes including absent state rows', async () => {
    const connection = postgres(databaseUrl)
    const requiredScope = 'esi-skills.read_skills.v1'
    const resource = {
      moduleId: 'member-audit',
      resourceId: 'character-skills',
      subjectKind: 'character',
      operationId: 'skills',
      materializationIntervalSeconds: 900,
      eligibility: { kind: 'current-owned-character' },
      implementation: {},
    } as const
    const disabledResource = { ...resource, moduleId: 'disabled-audit' }
    const characters = {
      never: { id: 1_404_328_061, lifecycle: '00000000-0000-4000-8000-000000000001' },
      generation: { id: 1_404_328_062, lifecycle: '00000000-0000-4000-8000-000000000002' },
      timed: { id: 1_404_328_063, lifecycle: '00000000-0000-4000-8000-000000000003' },
      future: { id: 1_404_328_064, lifecycle: '00000000-0000-4000-8000-000000000004' },
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
          next_eligible_at, authorization_generation, validated_at, last_failure_class
        ) values
          (
            ${resource.moduleId}, ${resource.resourceId}, 'character',
            ${characters.generation.lifecycle}, ${String(characters.generation.id)},
            '2026-08-27T00:00:00Z', 1, '2026-08-26T00:00:00Z', null
          ),
          (
            ${resource.moduleId}, ${resource.resourceId}, 'character',
            ${characters.timed.lifecycle}, ${String(characters.timed.id)},
            '2026-08-25T00:00:00Z', 1, '2026-08-24T00:00:00Z', null
          ),
          (
            ${resource.moduleId}, ${resource.resourceId}, 'character',
            ${characters.future.lifecycle}, ${String(characters.future.id)},
            '2026-08-27T00:00:00Z', 1, '2026-08-26T00:00:00Z', null
          ),
          (
            ${resource.moduleId}, ${resource.resourceId}, 'character',
            ${characters.unscoped.lifecycle}, ${String(characters.unscoped.id)},
            null, 1, null, 'authorization-required'
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
            subjectKind: 'character',
            subjectLifecycleId: character.lifecycle,
            subjectId: String(character.id),
          },
          options,
        )
        expect(classification).toMatchObject({
          status,
          dueReason,
          ...(due === null ? {} : { due }),
        })
      }

      await expect(selectDueInstalledResources({ ...options, limit: 10 })).resolves.toEqual(
        [characters.never, characters.generation, characters.timed].map((character) => ({
          identity: {
            moduleId: resource.moduleId,
            resourceId: resource.resourceId,
            subjectKind: 'character',
            subjectLifecycleId: character.lifecycle,
            subjectId: String(character.id),
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
            subjectKind: 'character',
            subjectLifecycleId: characters.never.lifecycle,
            subjectId: String(characters.never.id),
          },
          { resources: [resource], resolveEligibility },
        ),
      ).resolves.toMatchObject({ status: 'never-collected', validatedAt: null })
      await expect(
        getInstalledResourceCollectionStatus(
          {
            moduleId: resource.moduleId,
            resourceId: resource.resourceId,
            subjectKind: 'character',
            subjectLifecycleId: characters.timed.lifecycle,
            subjectId: String(characters.timed.id),
          },
          { resources: [resource], resolveEligibility },
        ),
      ).resolves.toMatchObject({ status: 'stale', validatedAt: '2026-08-24T00:00:00.000Z' })
      await expect(
        getInstalledResourceCollectionStatus(
          {
            moduleId: resource.moduleId,
            resourceId: resource.resourceId,
            subjectKind: 'character',
            subjectLifecycleId: characters.future.lifecycle,
            subjectId: String(characters.future.id),
          },
          { resources: [resource], resolveEligibility },
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
            subjectKind: 'character',
            subjectLifecycleId: characters.future.lifecycle,
            subjectId: String(characters.future.id),
          },
          {
            resources: [resource],
            resolveEligibility,
            loadCharacterAuthorization: loadAuthorization,
          },
        ),
      ).resolves.toEqual({ outcome: 'noop', reason: 'already-current' })
      expect(loadAuthorization).not.toHaveBeenCalled()
      await expect(selectDueInstalledResources({ ...options, limit: 2 })).resolves.toEqual([
        {
          identity: {
            moduleId: resource.moduleId,
            resourceId: resource.resourceId,
            subjectKind: 'character',
            subjectLifecycleId: characters.never.lifecycle,
            subjectId: String(characters.never.id),
          },
          operationId: 'skills',
        },
        {
          identity: {
            moduleId: resource.moduleId,
            resourceId: resource.resourceId,
            subjectKind: 'character',
            subjectLifecycleId: characters.generation.lifecycle,
            subjectId: String(characters.generation.id),
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

      await expect(selectDueInstalledResources({ ...options, limit: 2 })).resolves.toEqual([
        {
          identity: {
            moduleId: resource.moduleId,
            resourceId: resource.resourceId,
            subjectKind: 'character',
            subjectLifecycleId: characters.timed.lifecycle,
            subjectId: String(characters.timed.id),
          },
          operationId: 'skills',
        },
      ])
    } finally {
      await connection.end()
    }
  })

  test('selects public character resources without a token', async () => {
    const connection = postgres(databaseUrl)
    const resource = {
      moduleId: 'public-audit',
      resourceId: 'character-status',
      subjectKind: 'character',
      operationId: 'status',
      materializationIntervalSeconds: 900,
      eligibility: { kind: 'current-owned-character' },
      implementation: {},
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
      ).resolves.toEqual([
        {
          identity: {
            moduleId: resource.moduleId,
            resourceId: resource.resourceId,
            subjectKind: 'character',
            subjectLifecycleId: lifecycle,
            subjectId: String(characterId),
          },
          operationId: 'status',
        },
      ])
      // Derived queue state is disposable: without a state transition, another pass reconstructs it.
      await expect(
        selectDueInstalledResources({ connection, limit: 1, resources: [resource] }),
      ).resolves.toEqual([
        {
          identity: {
            moduleId: resource.moduleId,
            resourceId: resource.resourceId,
            subjectKind: 'character',
            subjectLifecycleId: lifecycle,
            subjectId: String(characterId),
          },
          operationId: 'status',
        },
      ])
    } finally {
      await connection.end()
    }
  })

  test('suppresses permanent failures and reactivates generation-bound state changes', async () => {
    const connection = postgres(databaseUrl)
    const resource = {
      moduleId: 'failure-audit',
      resourceId: 'character-skills',
      subjectKind: 'character',
      operationId: 'skills',
      materializationIntervalSeconds: 900,
      eligibility: { kind: 'current-owned-character' },
      implementation: {},
    } as const
    const characterId = 1_404_328_067
    const lifecycle = '00000000-0000-4000-8000-000000000007'
    const identity = {
      moduleId: resource.moduleId,
      resourceId: resource.resourceId,
      subjectKind: 'character' as const,
      subjectLifecycleId: lifecycle,
      subjectId: String(characterId),
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
          next_eligible_at, authorization_generation, validated_at, last_failure_class
        ) values (
          ${identity.moduleId}, ${identity.resourceId}, 'character', ${lifecycle},
          ${identity.subjectId}, null, 1, '2026-08-25T12:00:00Z', 'mapping-failed'
        )
      `

      await expect(
        resolveInstalledResourceEligibility(identity, { connection, resources: [resource] }),
      ).resolves.toMatchObject({
        status: 'suppressed',
        lastFailureClass: 'mapping-failed',
      })
      await expect(
        selectDueInstalledResources({ connection, limit: 1, resources: [resource] }),
      ).resolves.toEqual([])

      await connection`
        update eve_tokens set token_version = 2 where character_id = ${characterId}
      `
      await expect(
        resolveInstalledResourceEligibility(identity, { connection, resources: [resource] }),
      ).resolves.toMatchObject({
        status: 'eligible',
        due: true,
        dueReason: 'authorization-changed',
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
        resource_id: 'character-skills',
        subject_kind: 'character',
        operation_id: 'skills',
        required_scope: 'esi-skills.read_skills.v1',
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
        insert into characters (character_id, user_id, name, corporation_id, is_main)
        select 1500000000 + value, md5('plan-user-' || value::text)::uuid,
          'Plan Character ' || value::text, 98000001, true
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
              moduleId,
              resourceId: 'character-skills',
              subjectKind: 'character',
              operationId: 'skills',
              materializationIntervalSeconds: 900,
              eligibility: { kind: 'current-owned-character' },
              implementation: {},
            },
          ],
        }),
      ).resolves.toHaveLength(25)
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
          id, owner_admin_id, organization_type, organization_id,
          organization_name, organization_ticker, organization_version
        ) values (1, ${adminId}, 'alliance', 99000001, 'Managed Alliance', 'ALLY', 1)
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
        subjectKind: 'alliance' as const,
        subjectLifecycleId: firstLifecycleId,
        subjectId: '99000001',
      }

      await expect(
        selectDueInstalledResources({ connection, limit: 10, resources: [coreResources[0]] }),
      ).resolves.toEqual([{ identity: firstIdentity, operationId: 'alliance-corporations' }])

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
      ).resolves.toEqual({ status: 'obsolete' })
      await expect(
        selectDueInstalledResources({ connection, limit: 10, resources: [coreResources[0]] }),
      ).resolves.toEqual([
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
          id, owner_admin_id, organization_type, organization_id,
          organization_name, organization_ticker, organization_version
        ) values (1, ${adminId}, 'corporation', 98000001, 'Managed Corporation', 'CORP', 1)
      `
      await connection`
        insert into organization_managed_corporations (
          deployment_id, organization_version, corporation_id, first_observed_at, last_observed_at
        ) values (1, 1, 98000001, now(), now())
      `
      await connection`insert into users (id) values (${userId})`
      await connection`
        insert into characters (
          character_id, user_id, name, corporation_id, is_main,
          affiliation_resolution_state, affiliation_checked_at
        ) values (${characterId}, ${userId}, 'Source Pilot', 98000001, true, 'resolved', now())
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
          '["esi-corporations.read_corporation_membership.v1"]'::jsonb, 7
        )
      `
      await connection`
        insert into organization_corporation_sources (
          source_id, deployment_id, organization_version, corporation_id,
          character_id, evidence_character_id, registered_by_user_id
        ) values (${sourceId}, 1, 1, 98000001, ${characterId}, ${characterId}, ${userId})
      `
      await connection`
        insert into platform_subject_lifecycles (
          subject_lifecycle_id, subject_kind, subject_id, corporation_source_id
        ) values (${sourceLifecycleId}, 'corporation', '98000001', ${sourceId})
      `
      const identity = {
        moduleId: 'core',
        resourceId: 'corporation-roster',
        subjectKind: 'corporation' as const,
        subjectLifecycleId: sourceLifecycleId,
        subjectId: '98000001',
      }

      await expect(
        selectDueInstalledResources({ connection, limit: 10, resources: [coreResources[1]] }),
      ).resolves.toEqual([
        { identity, operationId: 'corporation-members', authorizationCharacterId: characterId },
      ])
      await expect(
        resolveInstalledResourceEligibility(identity, {
          connection,
          resources: [coreResources[1]],
        }),
      ).resolves.toMatchObject({
        status: 'eligible',
        authorizationGeneration: 7,
        authorizationCharacterId: characterId,
        authorizationCharacterLifecycleId: characterLifecycleId,
      })

      await database.transaction((transaction) =>
        materializeCoreResourceObservation(transaction, {
          resourceId: 'corporation-roster',
          subject: { kind: 'corporation', corporationId: 98000001, lifecycleId: sourceLifecycleId },
          data: [90_000_001, 90_000_002],
          validatedAt: new Date('2026-09-01T10:00:00Z'),
          authorizationGeneration: 7,
        }),
      )
      await database.transaction((transaction) =>
        materializeCoreResourceObservation(transaction, {
          resourceId: 'corporation-roster',
          subject: { kind: 'corporation', corporationId: 98000001, lifecycleId: sourceLifecycleId },
          data: [90_000_002],
          validatedAt: new Date('2026-09-01T11:00:00Z'),
          authorizationGeneration: 7,
        }),
      )
      await expect(connection<{ character_id: string }[]>`
        select character_id from organization_corporation_roster_observations order by character_id
      `).resolves.toEqual([{ character_id: '90000002' }])

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
        set scopes = '["esi-corporations.read_corporation_membership.v1"]'::jsonb
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
        update characters set affiliation_resolution_state = 'resolved'
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
          character_id, evidence_character_id, registered_by_user_id
        ) values (
          ${replacementSourceId}, 1, 1, 98000001, ${characterId}, ${characterId}, ${userId}
        )
      `
      await connection`
        insert into platform_subject_lifecycles (
          subject_lifecycle_id, subject_kind, subject_id, corporation_source_id
        ) values (${replacementLifecycleId}, 'corporation', '98000001', ${replacementSourceId})
      `
      await expect(
        resolveInstalledResourceEligibility(identity, {
          connection,
          resources: [coreResources[1]],
        }),
      ).resolves.toEqual({ status: 'obsolete' })
      await expect(
        selectDueInstalledResources({ connection, limit: 10, resources: [coreResources[1]] }),
      ).resolves.toEqual([
        {
          identity: { ...identity, subjectLifecycleId: replacementLifecycleId },
          operationId: 'corporation-members',
          authorizationCharacterId: characterId,
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
          id, owner_admin_id, organization_type, organization_id,
          organization_name, organization_ticker, organization_version
        ) values (1, ${adminId}, 'alliance', 99000001, 'Managed Alliance', 'ALLY', 1)
      `
      await connection`
        insert into platform_subject_lifecycles (
          subject_lifecycle_id, subject_kind, subject_id,
          organization_deployment_id, organization_version
        ) values (${lifecycleId}, 'alliance', '99000001', 1, 1)
      `

      await database.transaction((transaction) =>
        materializeCoreResourceObservation(transaction, {
          resourceId: 'managed-corporations',
          subject: { kind: 'alliance', allianceId: 99000001, lifecycleId },
          data: [98000001, 98000002],
          validatedAt: new Date('2026-09-01T10:00:00Z'),
          authorizationGeneration: null,
        }),
      )
      await database.transaction((transaction) =>
        materializeCoreResourceObservation(transaction, {
          resourceId: 'managed-corporations',
          subject: { kind: 'alliance', allianceId: 99000001, lifecycleId },
          data: [98000002],
          validatedAt: new Date('2026-09-01T11:00:00Z'),
          authorizationGeneration: null,
        }),
      )

      await expect(connection<{ corporation_id: string; is_current: boolean }[]>`
        select corporation_id, is_current
        from organization_managed_corporations
        order by corporation_id
      `).resolves.toEqual([
        { corporation_id: '98000001', is_current: false },
        { corporation_id: '98000002', is_current: true },
      ])
      await expect(connection<{ event_type: string; payload: unknown }[]>`
        select event_type, payload
        from domain_events
        order by event_sequence
      `).resolves.toEqual([
        {
          event_type: 'organization.managed-corporation-added',
          payload: { deploymentId: 1, organizationVersion: 1, corporationId: 98000001 },
        },
        {
          event_type: 'organization.managed-corporation-added',
          payload: { deploymentId: 1, organizationVersion: 1, corporationId: 98000002 },
        },
        {
          event_type: 'organization.managed-corporation-removed',
          payload: { deploymentId: 1, organizationVersion: 1, corporationId: 98000001 },
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
    insert into characters (character_id, user_id, name, corporation_id, is_main)
    values (${characterId}, ${userId}, 'Lifecycle Character', 98000001, true)
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
  if (!lifecycle) throw new Error('Failed to create test character lifecycle')
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
