import { createHash, randomUUID } from 'node:crypto'
import { definePlatformPersistenceOperation } from '@eve-space/platform-module-server'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { z } from 'zod'
import {
  migrationLockId,
  moduleMigrationLockKey,
  moduleMigrationLockNamespace,
} from '../../../src/db/locks.js'
import { loadMigrations, runMigrations } from '../../../src/db/migration-runner.js'
import { runModuleMigrationSets } from '../../../src/db/module-migration-runner.js'
import { ModuleMigrationValidationError } from '../../../src/db/module-migration-validation.js'
import { persistenceContractFingerprintFor } from '../../../src/db/module-persistence-attestation.js'
import { canonicalizePersistenceRoutineSql } from '../../../src/db/module-persistence-routine.js'
import { ModulePersistenceRoutineProvisioningError } from '../../../src/db/module-persistence-routine-provisioner.js'
import {
  createStandaloneModulePersistenceOperationInvoker,
  createTransactionScopedModulePersistenceOperationInvoker,
} from '../../../src/db/module-persistence-operation-transaction.js'
import { runStartupMigrations } from '../../../src/db/startup-migrations.js'
import {
  loadModuleRuntimeState,
  saveInstalledShellNavigationOrder,
  setInstalledModuleEnabled,
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
  Object.assign(process.env, {
    DATABASE_URL: databaseUrl,
    EVE_CLIENT_ID: 'test-client',
    EVE_CLIENT_SECRET: 'test-secret',
    TOKEN_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  })
})

afterAll(async () => {
  await container.stop()
})

beforeEach(async () => {
  const connection = postgres(databaseUrl)
  try {
    await connection
      .unsafe(
        `
          drop schema if exists eve_module_alpha cascade;
          drop schema if exists eve_module_beta cascade;
          drop schema if exists eve_module_delta cascade;
          drop schema if exists eve_module_empty_module cascade;
          drop schema if exists eve_module_gamma cascade;
          drop schema if exists eve_module_organization_activity cascade;
          drop schema public cascade;
          create schema public;
        `,
      )
      .simple()
  } finally {
    await connection.end()
  }
})

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

async function loadAlphaMigrationSql({ name }: { name: string }) {
  return name === 'alpha-001-initial.sql'
    ? 'create table alpha_values (id integer primary key);'
    : 'alter table alpha_values add column value text;'
}

async function loadIsolationMigrationSql({ moduleId }: { moduleId: string }) {
  return `
    create table ${moduleId}_records (
      id integer generated always as identity primary key,
      value text not null
    );

    create table ${moduleId}_migration_identity (role_name text not null);
    insert into ${moduleId}_migration_identity (role_name) values (current_user);
  `
}

function declaredReadRoutineSql() {
  return `
    create table routine_records (id bigint generated always as identity primary key);
    ${declaredReadFunctionSql()}
  `
}

function declaredReadFunctionSql() {
  return `
    create function eve_module_alpha.persist_read_snapshot(input jsonb)
    returns jsonb
    language sql
    stable
    parallel unsafe
    return input
  `
}

async function persistenceRoutineDescriptor(migration: string, sql: string) {
  const canonical = await canonicalizePersistenceRoutineSql({
    moduleId: 'alpha',
    operationId: 'read-snapshot',
    revision: 1,
    mode: 'read',
    sql,
  })
  return {
    moduleId: 'alpha',
    operationId: 'read-snapshot',
    revision: 1,
    mode: 'read' as const,
    migration,
    schemaName: canonical.identity.schemaName,
    routineName: canonical.identity.routineName,
    definitionFingerprint: canonical.definitionFingerprint,
  }
}

async function installAlphaPersistence(connection: postgres.Sql) {
  const migrationName = 'alpha-020-read-snapshot.sql'
  const sql = declaredReadRoutineSql()
  const operation = await persistenceRoutineDescriptor(migrationName, sql)
  const options = {
    installed: [{ moduleId: 'alpha', name: migrationName }],
    persistenceOperations: [operation],
    loadModuleSql: async () => sql,
  } as const
  await runStartupMigrations(connection, options)
  return { migrationName, operation, options }
}

async function waitForBackendLock(connection: postgres.Sql, pid: number) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const [activity] = await connection<{ wait_event_type: string | null }[]>`
      select wait_event_type from pg_stat_activity where pid = ${pid}
    `
    if (activity?.wait_event_type === 'Lock') return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Module migration did not reach the expected lock')
}

function runtimePersistenceMigrationSql() {
  return `
    create table routine_records (
      id bigint generated always as identity primary key,
      value text not null
    );

    create function eve_module_alpha.persist_read_records(input jsonb)
    returns jsonb
    language sql
    stable
    parallel unsafe
    return jsonb_build_object(
      'count'::text,
      (select count(*) from routine_records)
    );

    create function eve_module_alpha.persist_write_record(input jsonb)
    returns jsonb
    language sql
    volatile
    parallel unsafe
    begin atomic
      insert into routine_records (value) values ('must roll back'::text);
      select jsonb_build_object('unexpected'::text, true);
    end;
  `
}

async function runtimePersistenceOperations(migration: string, sql: string) {
  const definitions = [
    definePlatformPersistenceOperation({
      id: 'read-records',
      method: 'readRecords',
      revision: 1,
      mode: 'read',
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ count: z.number().int().nonnegative() }).strict(),
      maximumInputBytes: 64,
      maximumOutputBytes: 64,
    }),
    definePlatformPersistenceOperation({
      id: 'write-record',
      method: 'writeRecord',
      revision: 1,
      mode: 'write',
      inputSchema: z.object({ value: z.string().min(1).max(100) }).strict(),
      outputSchema: z.object({ applied: z.literal(true) }).strict(),
      maximumInputBytes: 256,
      maximumOutputBytes: 64,
    }),
  ] as const
  return Promise.all(
    definitions.map(async (definition) => {
      const canonical = await canonicalizePersistenceRoutineSql({
        moduleId: 'alpha',
        operationId: definition.id,
        revision: definition.revision,
        mode: definition.mode,
        sql,
      })
      return {
        moduleId: 'alpha',
        operationId: definition.id,
        method: definition.method,
        revision: definition.revision,
        mode: definition.mode,
        migration,
        schemaName: canonical.identity.schemaName,
        routineName: canonical.identity.routineName,
        definitionFingerprint: canonical.definitionFingerprint,
        definition,
        grants: {
          routes: [],
          activityProviders: [],
          resourceProjections: [],
          resourceMaterializations: [],
        },
      }
    }),
  )
}

describe('multi-process safety', () => {
  test('refuses worker readiness until its expected migration is applied', async () => {
    const connection = postgres(databaseUrl)
    const { checkWorkerReadiness, expectedWorkerMigration } =
      await import('../../../src/worker/readiness.js')

    try {
      await expect(checkWorkerReadiness(connection)).resolves.toEqual({
        healthy: false,
        reason: `Missing migration core/${expectedWorkerMigration}`,
        missing: { module: 'core', name: expectedWorkerMigration },
      })
    } finally {
      await connection.end()
    }
  })

  test('serializes concurrent migration runners and records every migration once', async () => {
    const first = postgres(databaseUrl)
    const second = postgres(databaseUrl)
    const inspector = postgres(databaseUrl)

    try {
      await Promise.all([runMigrations(first), runMigrations(second)])

      const migrations = await loadMigrations()
      const applied = await inspector<{ module: string; name: string; contentSha256: string }[]>`
        select module, name, content_sha256 as "contentSha256"
        from schema_migrations
        order by applied_at, name
      `
      expect(applied.map((migration) => migration.name)).toEqual(
        migrations.map((migration) => migration.name),
      )
      expect(new Set(applied.map((migration) => migration.module))).toEqual(new Set(['core']))
      expect(applied.map(({ name, contentSha256 }) => ({ name, sha256: contentSha256 }))).toEqual(
        migrations.map(({ name, sha256 }) => ({ name, sha256 })),
      )

      const { checkWorkerReadiness, expectedWorkerMigration } =
        await import('../../../src/worker/readiness.js')
      const persistenceRequirement = {
        contractFingerprint: persistenceContractFingerprintFor([], []),
        operations: [],
      }
      await runStartupMigrations(inspector, {
        installed: [],
        moduleIds: [],
        persistenceOperations: [],
        persistenceContractFingerprint: persistenceRequirement.contractFingerprint,
      })
      const [beforeReadiness] = await inspector<{ attested_at: Date; reconciled_at: Date }[]>`
        select
          max(attested_at) as attested_at,
          (select reconciled_at from module_persistence_contract) as reconciled_at
        from module_persistence_operation_attestations
      `
      await expect(
        checkWorkerReadiness(
          inspector,
          [{ module: 'core', name: expectedWorkerMigration }],
          [],
          persistenceRequirement,
        ),
      ).resolves.toEqual({ healthy: true })
      const [afterReadiness] = await inspector<{ attested_at: Date; reconciled_at: Date }[]>`
        select
          max(attested_at) as attested_at,
          (select reconciled_at from module_persistence_contract) as reconciled_at
        from module_persistence_operation_attestations
      `
      expect(afterReadiness).toEqual(beforeReadiness)
    } finally {
      await Promise.all([first.end(), second.end(), inspector.end()])
    }
  })

  test('matches the reviewed normalized core schema baseline', async () => {
    const connection = postgres(databaseUrl)

    try {
      await runMigrations(connection)
      await expect(loadNormalizedPublicSchema(connection)).resolves.toMatchFileSnapshot(
        './snapshots/core-schema.txt',
      )
    } finally {
      await connection.end()
    }
  })

  test('keeps a completed baseline idempotent', async () => {
    const connection = postgres(databaseUrl)
    const migrations = await loadMigrations()
    const baseline = migrations.find(({ name }) => name === '001_baseline.sql')

    expect(baseline).toBeDefined()

    try {
      await runMigrations(connection, [baseline!])
      await runMigrations(connection)

      const [result] = await connection<
        { functionExists: boolean; usesValidationFunction: boolean; appliedMigrations: string[] }[]
      >`
        select
          to_regprocedure('is_valid_module_id(text)') is not null as "functionExists",
          (
            select pg_get_constraintdef(oid) like '%is_valid_module_id%'
            from pg_constraint
            where conname = 'deployment_modules_module_id_check'
          ) as "usesValidationFunction",
          (
            select array_agg(name order by applied_at, name)
            from schema_migrations
            where module = 'core'
          ) as "appliedMigrations"
      `

      expect(result).toEqual({
        functionExists: true,
        usesValidationFunction: true,
        appliedMigrations: migrations.map(({ name }) => name),
      })
      const missingIdentities = await connection<{ count: number }[]>`
        select count(*)::integer as count
        from schema_migrations
        where module = 'core' and content_sha256 is null
      `
      expect(missingIdentities[0]?.count).toBe(0)
    } finally {
      await connection.end()
    }
  })

  test('rejects non-prefix, unknown, missing, and changed core identities before pending work', async () => {
    const connection = postgres(databaseUrl)
    const migrations = await loadMigrations()

    try {
      await runMigrations(connection)
      const first = migrations[0]!

      await connection`
        update schema_migrations
        set content_sha256 = ${'0'.repeat(64)}
        where module = 'core' and name = ${first.name}
      `
      await expect(runMigrations(connection)).rejects.toThrow(
        `content identity mismatch): ${first.name}`,
      )

      await connection`
        update schema_migrations
        set content_sha256 = ${first.sha256}
        where module = 'core' and name = ${first.name}
      `
      await connection`
        update schema_migrations
        set content_sha256 = null
        where module = 'core' and name = ${first.name}
      `
      await expect(runMigrations(connection)).rejects.toThrow(
        `missing content identity): ${first.name}`,
      )

      await connection`
        update schema_migrations
        set content_sha256 = ${first.sha256}
        where module = 'core' and name = ${first.name}
      `
      await connection`
        insert into schema_migrations (module, name, content_sha256)
        values ('core', '999_unknown.sql', ${'0'.repeat(64)})
      `
      await expect(runMigrations(connection)).rejects.toThrow('unknown migration): 999_unknown.sql')
    } finally {
      await connection.end()
    }
  })

  test('rejects a retired clean-install ledger before running baseline SQL', async () => {
    const connection = postgres(databaseUrl)

    try {
      await connection`
        create table schema_migrations (
          module text not null default 'core',
          name text not null,
          content_sha256 text,
          applied_at timestamptz not null default now(),
          constraint schema_migrations_pkey primary key (module, name)
        )
      `
      await connection`
        insert into schema_migrations (module, name, content_sha256)
        values ('core', '001_retired.sql', ${'0'.repeat(64)})
      `

      await expect(runMigrations(connection)).rejects.toThrow('unknown migration): 001_retired.sql')
      const [state] = await connection<{ usersExists: boolean }[]>`
        select to_regclass('users') is not null as "usersExists"
      `
      expect(state?.usersExists).toBe(false)
    } finally {
      await connection.end()
    }
  })

  test('qualifies core migration reads and writes by owner', async () => {
    const connection = postgres(databaseUrl)
    const migration = {
      name: 'test_qualified_core.sql',
      sql: 'create table qualified_core_migration_probe (id integer);',
    }

    try {
      await runMigrations(connection)
      await connection`alter table schema_migrations alter column module drop default`
      await connection`
        insert into schema_migrations (module, name)
        values ('alpha', ${migration.name})
      `

      await runMigrations(connection, [migration])

      const [table] = await connection<{ exists: boolean }[]>`
        select to_regclass('qualified_core_migration_probe') is not null as exists
      `
      const owners = await connection<{ module: string }[]>`
        select module
        from schema_migrations
        where name = ${migration.name}
        order by module
      `
      expect(table?.exists).toBe(true)
      expect(owners.map(({ module }) => module)).toEqual(['alpha', 'core'])
    } finally {
      await connection.end()
    }
  })

  test('bounds core character and SDE reference reads without exposing tables to modules', async () => {
    const connection = postgres(databaseUrl)
    const ownerId = '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c'
    const otherId = '91e244f4-0149-4309-b4a6-b5ad0f55785a'
    const characterId = 90_000_001

    try {
      await runMigrations(connection)
      await connection`insert into users (id) values (${ownerId}), (${otherId})`
      await connection`
        insert into characters (
          character_id,
          user_id,
          name,
          corporation_id,
          alliance_id,
          affiliation_checked_at,
          affiliation_resolution_state,
          is_main
        ) values (
          ${characterId},
          ${ownerId},
          'Bound Character',
          98_000_001,
          99_000_001,
          '2026-08-25T12:00:00Z',
          'resolved',
          true
        )
      `
      const [lifecycle] = await connection<{ subject_lifecycle_id: string }[]>`
        insert into platform_subject_lifecycles (subject_kind, subject_id, character_id)
        values ('character', ${String(characterId)}, ${characterId})
        returning subject_lifecycle_id
      `
      if (!lifecycle) throw new Error('Failed to create test character lifecycle')
      await connection`
        insert into sde_groups (group_id, category_id, name, published)
        values (18, 4, 'Mineral', true), (19, 4, 'Hidden Group', false)
      `
      await connection`
        insert into sde_types (type_id, group_id, name, published)
        values
          (34, 18, 'Tritanium', true),
          (35, 18, 'Hidden Type', false),
          (36, 19, 'Type In Hidden Group', true),
          (37, 18, 'Isogen', true)
      `
      await connection`
        insert into sde_builds (build_number, release_date, ingested_at, ingest_version)
        values (1234, '2026-08-25T11:00:00Z', '2026-08-25T12:00:00Z', 2)
      `
      await connection`update sde_projection_state set active_build_number = 1234`

      const { createOwnedCharacterCoreReads } =
        await import('../../../src/platform/core-read-capabilities.js')
      const { loadPublishedTypeGroupsProduct } =
        await import('../../../src/core-data/published-type-groups-adapter.js')
      const ownedReads = createOwnedCharacterCoreReads({
        userId: ownerId,
        characterId,
        subjectLifecycleId: lifecycle.subject_lifecycle_id,
      })
      const nonOwnerReads = createOwnedCharacterCoreReads({
        userId: otherId,
        characterId,
        subjectLifecycleId: lifecycle.subject_lifecycle_id,
      })
      await expect(ownedReads.loadAffiliation()).resolves.toEqual({
        characterId,
        corporationId: 98_000_001,
        allianceId: 99_000_001,
        checkedAt: '2026-08-25T12:00:00.000Z',
        resolutionState: 'resolved',
      })
      await expect(nonOwnerReads.loadAffiliation()).resolves.toBeNull()
      await expect(
        loadPublishedTypeGroupsProduct({ typeIds: [37, 36, 35, 34] }, connection),
      ).resolves.toMatchObject({
        rows: [
          { typeId: 34, typeName: 'Tritanium', groupId: 18, groupName: 'Mineral' },
          { typeId: 37, typeName: 'Isogen', groupId: 18, groupName: 'Mineral' },
        ],
        complete: true,
      })

      await connection`delete from characters where character_id = ${characterId}`
      await expect(ownedReads.loadAffiliation()).resolves.toBeNull()
    } finally {
      await connection.end()
    }
  })

  test('applies installed module migrations exactly once during concurrent startup', async () => {
    const first = postgres(databaseUrl)
    const second = postgres(databaseUrl)
    const inspector = postgres(databaseUrl)
    const installed = [
      { moduleId: 'alpha', name: 'alpha-001-initial.sql' },
      { moduleId: 'alpha', name: 'alpha-002-value.sql' },
    ] as const

    try {
      await Promise.all([
        runStartupMigrations(first, { installed, loadModuleSql: loadAlphaMigrationSql }),
        runStartupMigrations(second, { installed, loadModuleSql: loadAlphaMigrationSql }),
      ])

      const applied = await inspector<{ module: string; name: string }[]>`
        select module, name
        from schema_migrations
        where module = 'alpha'
        order by name
      `
      const [column] = await inspector<{ exists: boolean }[]>`
        select exists (
          select 1
          from information_schema.columns
          where table_schema = 'eve_module_alpha'
            and table_name = 'alpha_values'
            and column_name = 'value'
        ) as exists
      `
      expect(applied).toEqual([
        { module: 'alpha', name: 'alpha-001-initial.sql' },
        { module: 'alpha', name: 'alpha-002-value.sql' },
      ])
      expect(column?.exists).toBe(true)
    } finally {
      await Promise.all([first.end(), second.end(), inspector.end()])
    }
  })

  test('fails startup and rolls back only the failing module migration', async () => {
    const connection = postgres(databaseUrl)
    const installed = [
      { moduleId: 'alpha', name: 'alpha-001-initial.sql' },
      { moduleId: 'alpha', name: 'alpha-002-failing.sql' },
      { moduleId: 'alpha', name: 'alpha-003-never-runs.sql' },
    ] as const
    const sqlByName = new Map([
      ['alpha-001-initial.sql', 'create table alpha_first (id integer);'],
      [
        'alpha-002-failing.sql',
        'create table alpha_rollback_probe (id integer); select missing_module_function();',
      ],
      ['alpha-003-never-runs.sql', 'create table alpha_never_runs (id integer);'],
    ])

    try {
      await expect(
        runStartupMigrations(connection, {
          installed,
          loadModuleSql: async ({ name }) => sqlByName.get(name)!,
        }),
      ).rejects.toThrow('missing_module_function')

      const [state] = await connection<
        { first_exists: boolean; probe_exists: boolean; last_exists: boolean }[]
      >`
        select
          to_regclass('eve_module_alpha.alpha_first') is not null as first_exists,
          to_regclass('eve_module_alpha.alpha_rollback_probe') is not null as probe_exists,
          to_regclass('eve_module_alpha.alpha_never_runs') is not null as last_exists
      `
      const applied = await connection<{ name: string }[]>`
        select name from schema_migrations where module = 'alpha' order by name
      `
      expect(state).toEqual({
        first_exists: true,
        probe_exists: false,
        last_exists: false,
      })
      expect(applied).toEqual([{ name: 'alpha-001-initial.sql' }])
    } finally {
      await connection.end()
    }
  })

  test('preflights every module before applying any migration in the startup set', async () => {
    const connection = postgres(databaseUrl)
    const installed = [
      { moduleId: 'alpha', name: 'alpha-001-initial.sql' },
      { moduleId: 'beta', name: 'beta-001-concurrent.sql' },
    ] as const
    const sqlByName = new Map([
      ['alpha-001-initial.sql', 'create table alpha_first (id integer);'],
      ['beta-001-concurrent.sql', 'create index concurrently beta_idx on beta_first (id);'],
    ])

    try {
      const failure = await runStartupMigrations(connection, {
        installed,
        loadModuleSql: async ({ name }) => sqlByName.get(name)!,
      }).catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(ModuleMigrationValidationError)
      expect(failure).toMatchObject({
        moduleId: 'beta',
        migrationName: 'beta-001-concurrent.sql',
        category: 'prohibited-operation',
      })
      expect(String(failure)).not.toContain(sqlByName.get('beta-001-concurrent.sql'))

      const [state] = await connection<
        {
          alpha_schema_exists: boolean
          beta_schema_exists: boolean
          applied: number
          provisioned: number
        }[]
      >`
        select
          to_regnamespace('eve_module_alpha') is not null as alpha_schema_exists,
          to_regnamespace('eve_module_beta') is not null as beta_schema_exists,
          (
            select count(*)::integer from schema_migrations where module in ('alpha', 'beta')
          ) as applied,
          (
            select count(*)::integer
            from module_schema_provisioning
            where module_id in ('alpha', 'beta')
          ) as provisioned
      `
      expect(state).toEqual({
        alpha_schema_exists: false,
        beta_schema_exists: false,
        applied: 0,
        provisioned: 0,
      })
    } finally {
      await connection.end()
    }
  })

  test('rejects migration authority escapes without changing targets or the ledger', async () => {
    const connection = postgres(databaseUrl)
    const userId = '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c'
    const prohibited = [
      ['core schema write', `delete from public.users where id = '${userId}'`, 'cross-schema'],
      ['cross-module DDL', 'drop table eve_module_beta.beta_records', 'cross-schema'],
      ['privilege change', 'grant select on alpha_policy_probe to public', 'prohibited-operation'],
      ['role change', 'alter role eve_module_beta_runtime login', 'prohibited-operation'],
      ['alternate role', 'set role eve_module_beta_runtime', 'prohibited-operation'],
      ['role reset', 'reset role', 'prohibited-operation'],
      ['session authorization', 'set session authorization eve_space', 'prohibited-operation'],
      ['extension operation', 'create extension hstore', 'prohibited-operation'],
      ['deployment schema', 'create schema escaped_module_schema', 'prohibited-operation'],
      [
        'large object creation',
        "select lo_from_bytea(0, decode('00', 'hex'))",
        'prohibited-operation',
      ],
    ] as const

    try {
      await runStartupMigrations(connection, {
        installed: [{ moduleId: 'beta', name: 'beta-010-records.sql' }],
        loadModuleSql: loadIsolationMigrationSql,
      })
      await connection`insert into users (id) values (${userId})`

      for (const [name, operation, category] of prohibited) {
        await expect(
          runModuleMigrationSets(connection, [
            {
              moduleId: 'alpha',
              migrations: [
                {
                  name: `alpha-${name.replaceAll(' ', '-')}.sql`,
                  sql: `create table alpha_policy_probe (id integer); ${operation};`,
                },
              ],
            },
          ]),
        ).rejects.toMatchObject({ category })
      }

      const [state] = await connection<
        {
          alpha_applied: number
          alpha_schema_exists: boolean
          beta_login: boolean
          beta_table_exists: boolean
          escaped_schema_exists: boolean
          extension_exists: boolean
          user_exists: boolean
        }[]
      >`
        select
          (select count(*)::integer from schema_migrations where module = 'alpha')
            as alpha_applied,
          to_regnamespace('eve_module_alpha') is not null as alpha_schema_exists,
          (select rolcanlogin from pg_roles where rolname = 'eve_module_beta_runtime')
            as beta_login,
          to_regclass('eve_module_beta.beta_records') is not null as beta_table_exists,
          to_regnamespace('escaped_module_schema') is not null as escaped_schema_exists,
          exists (select 1 from pg_extension where extname = 'hstore') as extension_exists,
          exists (select 1 from users where id = ${userId}) as user_exists
      `
      expect(state).toEqual({
        alpha_applied: 0,
        alpha_schema_exists: false,
        beta_login: false,
        beta_table_exists: true,
        escaped_schema_exists: false,
        extension_exists: false,
        user_exists: true,
      })
    } finally {
      await connection.end()
    }
  })

  test('finalizes declared persistence routine authority before recording its migration', async () => {
    const connection = postgres(databaseUrl)
    const migrationName = 'alpha-020-read-snapshot.sql'
    const sql = declaredReadRoutineSql()
    const operation = await persistenceRoutineDescriptor(migrationName, sql)

    try {
      await runStartupMigrations(connection, {
        installed: [{ moduleId: 'alpha', name: migrationName }],
        persistenceOperations: [operation],
        loadModuleSql: async () => sql,
      })
      const [metadata] = await connection<
        {
          direct_table_access: boolean
          direct_sequence_access: boolean
          owner: string
          parallel: string
          public_execute: boolean
          runtime_execute: boolean
          security_definer: boolean
          settings: string[] | null
          volatility: string
        }[]
      >`
        select
          pg_get_userbyid(routine.proowner) as owner,
          routine.prosecdef as security_definer,
          routine.provolatile as volatility,
          routine.proparallel as parallel,
          routine.proconfig as settings,
          exists (
            select 1
            from aclexplode(coalesce(routine.proacl, acldefault('f', routine.proowner))) privilege
            where privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
          ) as public_execute,
          has_function_privilege(
            'eve_module_alpha_runtime',
            routine.oid,
            'EXECUTE'
          ) as runtime_execute,
          has_table_privilege(
            'eve_module_alpha_runtime',
            'eve_module_alpha.routine_records',
            'SELECT, INSERT, UPDATE, DELETE'
          ) as direct_table_access,
          has_sequence_privilege(
            'eve_module_alpha_runtime',
            'eve_module_alpha.routine_records_id_seq',
            'USAGE'
          ) as direct_sequence_access
        from pg_proc routine
        join pg_namespace namespace on namespace.oid = routine.pronamespace
        where namespace.nspname = 'eve_module_alpha'
          and routine.proname = 'persist_read_snapshot'
      `
      const [invocation] = await connection.begin(async (transaction) => {
        await transaction`set local role eve_module_alpha_runtime`
        return transaction<{ result: { marker: string } }[]>`
          select eve_module_alpha.persist_read_snapshot('{"marker":"kept"}'::jsonb) as result
        `
      })
      const [attestation] = await connection<
        { definition_fingerprint: string; migration_name: string; mode: string; revision: number }[]
      >`
        select definition_fingerprint, migration_name, mode, revision
        from module_persistence_operation_attestations
        where module_id = 'alpha' and operation_id = 'read-snapshot'
      `

      expect(metadata).toEqual({
        direct_table_access: false,
        direct_sequence_access: false,
        owner: 'eve_module_alpha_migrate',
        parallel: 'u',
        public_execute: false,
        runtime_execute: true,
        security_definer: true,
        settings: ['search_path=pg_catalog, eve_module_alpha, pg_temp'],
        volatility: 's',
      })
      expect(invocation?.result).toEqual({ marker: 'kept' })
      expect(attestation).toEqual({
        definition_fingerprint: operation.definitionFingerprint,
        migration_name: migrationName,
        mode: 'read',
        revision: 1,
      })

      await connection`
        grant execute on function eve_module_alpha.persist_read_snapshot(jsonb) to public
      `
      await expect(
        runStartupMigrations(connection, {
          installed: [{ moduleId: 'alpha', name: migrationName }],
          persistenceOperations: [operation],
          loadModuleSql: async () => sql,
        }),
      ).rejects.toMatchObject({
        moduleId: 'alpha',
        operationId: 'read-snapshot',
        failure: 'grants',
      })
    } finally {
      await connection.end()
    }
  })

  test('rejects changed persistence definitions before startup reconciliation', async () => {
    const connection = postgres(databaseUrl)

    try {
      const { operation, options } = await installAlphaPersistence(connection)
      await connection.begin(async (transaction) => {
        await transaction`set local role eve_module_alpha_migrate`
        await transaction.unsafe(`
          create or replace function eve_module_alpha.persist_read_snapshot(input jsonb)
          returns jsonb
          language sql
          stable
          parallel unsafe
          security definer
          set search_path to pg_catalog, eve_module_alpha, pg_temp
          return jsonb_build_object('changed'::text, true)
        `)
      })

      await expect(runStartupMigrations(connection, options)).rejects.toMatchObject({
        moduleId: 'alpha',
        operationId: operation.operationId,
        failure: 'definition',
      })
    } finally {
      await connection.end()
    }
  })

  test('rejects changed persistence owners and fixed settings', async () => {
    const connection = postgres(databaseUrl)

    try {
      const { operation, options } = await installAlphaPersistence(connection)
      await connection`
        alter function eve_module_alpha.persist_read_snapshot(jsonb) owner to eve_space
      `
      await expect(runStartupMigrations(connection, options)).rejects.toMatchObject({
        moduleId: 'alpha',
        operationId: operation.operationId,
        failure: 'metadata',
      })

      await connection`
        alter function eve_module_alpha.persist_read_snapshot(jsonb)
        owner to eve_module_alpha_migrate
      `
      await connection`
        alter function eve_module_alpha.persist_read_snapshot(jsonb)
        set search_path to pg_catalog, pg_temp
      `
      await expect(runStartupMigrations(connection, options)).rejects.toMatchObject({
        moduleId: 'alpha',
        operationId: operation.operationId,
        failure: 'metadata',
      })
    } finally {
      await connection.end()
    }
  })

  test('rejects changed persistence signatures and extra routines', async () => {
    const connection = postgres(databaseUrl)

    try {
      const { operation, options } = await installAlphaPersistence(connection)
      await connection.begin(async (transaction) => {
        await transaction`set local role eve_module_alpha_migrate`
        await transaction`drop function eve_module_alpha.persist_read_snapshot(jsonb)`
        await transaction.unsafe(`
          create function eve_module_alpha.persist_read_snapshot(input text)
          returns jsonb
          language sql
          stable
          parallel unsafe
          return '{}'::jsonb
        `)
      })
      await expect(runStartupMigrations(connection, options)).rejects.toMatchObject({
        moduleId: 'alpha',
        operationId: operation.operationId,
        failure: 'signature',
      })

      await connection.begin(async (transaction) => {
        await transaction`set local role eve_module_alpha_migrate`
        await transaction`drop function eve_module_alpha.persist_read_snapshot(text)`
        await transaction.unsafe(declaredReadFunctionSql()).simple()
        await transaction.unsafe(`
          create function eve_module_alpha.persist_extra(input jsonb)
          returns jsonb
          language sql
          stable
          parallel unsafe
          return input
        `)
      })
      await expect(runStartupMigrations(connection, options)).rejects.toMatchObject({
        failure: 'inventory',
      })
    } finally {
      await connection.end()
    }
  })

  test('rejects stale persistence attestations at API startup', async () => {
    const connection = postgres(databaseUrl)

    try {
      const { operation, options } = await installAlphaPersistence(connection)
      await connection`
        update module_persistence_operation_attestations
        set revision = revision + 1
        where module_id = 'alpha' and operation_id = 'read-snapshot'
      `

      await expect(runStartupMigrations(connection, options)).rejects.toMatchObject({
        moduleId: 'alpha',
        operationId: operation.operationId,
        failure: 'metadata',
      })
    } finally {
      await connection.end()
    }
  })

  test('ignores retained persistence state from statically uninstalled modules', async () => {
    const connection = postgres(databaseUrl)

    try {
      const { migrationName } = await installAlphaPersistence(connection)
      const contractFingerprint = persistenceContractFingerprintFor([], [])

      await expect(
        runStartupMigrations(connection, {
          installed: [],
          moduleIds: [],
          persistenceOperations: [],
          persistenceContractFingerprint: contractFingerprint,
        }),
      ).resolves.toBeUndefined()

      const [retained] = await connection<
        { attested: boolean; migrated: boolean; routine_exists: boolean; schema_exists: boolean }[]
      >`
        select
          exists (
            select 1 from module_persistence_operation_attestations
            where module_id = 'alpha' and operation_id = 'read-snapshot'
          ) as attested,
          exists (
            select 1 from schema_migrations
            where module = 'alpha' and name = ${migrationName}
          ) as migrated,
          to_regprocedure('eve_module_alpha.persist_read_snapshot(jsonb)') is not null
            as routine_exists,
          to_regnamespace('eve_module_alpha') is not null as schema_exists
      `
      expect(retained).toEqual({
        attested: true,
        migrated: true,
        routine_exists: true,
        schema_exists: true,
      })

      const { checkWorkerReadiness, expectedWorkerMigration } =
        await import('../../../src/worker/readiness.js')
      await expect(
        checkWorkerReadiness(connection, [{ module: 'core', name: expectedWorkerMigration }], [], {
          contractFingerprint,
          operations: [],
        }),
      ).resolves.toEqual({ healthy: true })
    } finally {
      await connection.end()
    }
  })

  test('worker readiness rejects stale contracts and excess runtime authority without repair', async () => {
    const connection = postgres(databaseUrl)

    try {
      const { migrationName, operation } = await installAlphaPersistence(connection)
      const { checkWorkerReadiness, expectedWorkerMigration } =
        await import('../../../src/worker/readiness.js')
      const persistenceRequirement = {
        contractFingerprint: persistenceContractFingerprintFor([operation]),
        operations: [operation],
      }
      const check = () =>
        checkWorkerReadiness(
          connection,
          [
            { module: 'core', name: expectedWorkerMigration },
            { module: 'alpha', name: migrationName },
          ],
          ['alpha'],
          persistenceRequirement,
        )

      await connection`
        update module_persistence_contract
        set contract_fingerprint = ${'0'.repeat(64)}
      `
      await expect(check()).resolves.toMatchObject({
        healthy: false,
        reason: expect.stringContaining('rejected: contract'),
      })
      const [staleContract] = await connection<{ contract_fingerprint: string }[]>`
        select contract_fingerprint from module_persistence_contract
      `
      expect(staleContract?.contract_fingerprint).toBe('0'.repeat(64))

      await connection`
        update module_persistence_contract
        set contract_fingerprint = ${persistenceRequirement.contractFingerprint}
      `
      await connection`
        grant select on eve_module_alpha.routine_records to eve_module_alpha_runtime
      `
      await expect(check()).resolves.toMatchObject({
        healthy: false,
        reason: expect.stringContaining('rejected: authority'),
      })
      const [excessAuthority] = await connection<{ can_read: boolean }[]>`
        select has_table_privilege(
          'eve_module_alpha_runtime',
          'eve_module_alpha.routine_records',
          'SELECT'
        ) as can_read
      `
      expect(excessAuthority?.can_read).toBe(true)
    } finally {
      await connection.end()
    }
  })

  test('rolls back routine creation and the ledger when finalization fails', async () => {
    const connection = postgres(databaseUrl)
    const migrationName = 'alpha-020-read-snapshot.sql'
    const sql = declaredReadRoutineSql()
    const operation = {
      ...(await persistenceRoutineDescriptor(migrationName, sql)),
      definitionFingerprint: '0'.repeat(64),
    }

    try {
      const failure = await runStartupMigrations(connection, {
        installed: [{ moduleId: 'alpha', name: migrationName }],
        persistenceOperations: [operation],
        loadModuleSql: async () => sql,
      }).catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(ModulePersistenceRoutineProvisioningError)
      expect(failure).toMatchObject({
        moduleId: 'alpha',
        operationId: 'read-snapshot',
        failure: 'definition',
      })
      const [state] = await connection<
        { applied: boolean; attested: boolean; routine_exists: boolean; schema_exists: boolean }[]
      >`
        select
          exists (
            select 1 from schema_migrations
            where module = 'alpha' and name = ${migrationName}
          ) as applied,
          exists (
            select 1 from module_persistence_operation_attestations
            where module_id = 'alpha' and operation_id = 'read-snapshot'
          ) as attested,
          to_regprocedure('eve_module_alpha.persist_read_snapshot(jsonb)') is not null
            as routine_exists,
          to_regnamespace('eve_module_alpha') is not null as schema_exists
      `
      expect(state).toEqual({
        applied: false,
        attested: false,
        routine_exists: false,
        schema_exists: false,
      })
    } finally {
      await connection.end()
    }
  })

  test('never exposes a routine with its default public grant', async () => {
    const migrator = postgres(databaseUrl, { max: 1 })
    const blocker = postgres(databaseUrl, { max: 1 })
    const observer = postgres(databaseUrl)
    const initialMigration = 'alpha-010-routine-gate.sql'
    const routineMigration = 'alpha-020-read-snapshot.sql'
    const routineSql = `
      ${declaredReadRoutineSql()};
      alter table routine_gate add column finalized boolean;
    `
    const operation = await persistenceRoutineDescriptor(routineMigration, routineSql)
    let migration: Promise<void> | undefined

    try {
      await runStartupMigrations(migrator, {
        installed: [{ moduleId: 'alpha', name: initialMigration }],
        loadModuleSql: async () => 'create table routine_gate (id bigint primary key);',
      })
      const [backend] = await migrator<{ pid: number }[]>`select pg_backend_pid() as pid`
      await blocker`begin`
      await blocker`select * from eve_module_alpha.routine_gate`

      migration = runStartupMigrations(migrator, {
        installed: [
          { moduleId: 'alpha', name: initialMigration },
          { moduleId: 'alpha', name: routineMigration },
        ],
        persistenceOperations: [operation],
        loadModuleSql: async ({ name }) =>
          name === initialMigration
            ? 'create table routine_gate (id bigint primary key);'
            : routineSql,
      })
      await waitForBackendLock(observer, backend!.pid)

      const [duringMigration] = await observer<{ visible: boolean }[]>`
        select to_regprocedure('eve_module_alpha.persist_read_snapshot(jsonb)') is not null
          as visible
      `
      expect(duringMigration?.visible).toBe(false)

      await blocker`rollback`
      await migration
      migration = undefined

      const [afterCommit] = await observer<{ public_execute: boolean }[]>`
        select exists (
          select 1
          from pg_proc routine
          cross join lateral aclexplode(
            coalesce(routine.proacl, acldefault('f', routine.proowner))
          ) privilege
          where routine.oid = 'eve_module_alpha.persist_read_snapshot(jsonb)'::regprocedure
            and privilege.grantee = 0
            and privilege.privilege_type = 'EXECUTE'
        ) as public_execute
      `
      expect(afterCommit?.public_execute).toBe(false)
    } finally {
      await blocker`rollback`.catch(() => undefined)
      await migration?.catch(() => undefined)
      await Promise.all([migrator.end(), blocker.end(), observer.end()])
    }
  })

  test('enforces timeout and cancellation for installed read operations', async () => {
    const connection = postgres(databaseUrl, { max: 1 })
    const blocker = postgres(databaseUrl, { max: 1 })
    const migrationName = 'alpha-030-runtime-operations.sql'
    const migrationSql = runtimePersistenceMigrationSql()
    const operations = await runtimePersistenceOperations(migrationName, migrationSql)
    const readOperation = operations[0]!

    try {
      await runStartupMigrations(connection, {
        installed: [{ moduleId: 'alpha', name: migrationName }],
        persistenceOperations: operations,
        loadModuleSql: async () => migrationSql,
      })
      await blocker`begin`
      await blocker`alter table eve_module_alpha.routine_records add column timeout_gate boolean`
      const timedInvoke = createStandaloneModulePersistenceOperationInvoker(
        connection,
        'alpha',
        operations,
        { readOnly: true, statementTimeoutMilliseconds: 100 },
      )

      await expect(timedInvoke(readOperation, {})).rejects.toMatchObject({
        category: 'execution',
      })
      await blocker`rollback`

      const controller = new AbortController()
      await blocker`begin`
      await blocker`alter table eve_module_alpha.routine_records add column cancellation_gate boolean`
      const cancelledInvoke = createStandaloneModulePersistenceOperationInvoker(
        connection,
        'alpha',
        operations,
        { readOnly: true, signal: controller.signal },
      )
      const cancelled = cancelledInvoke(readOperation, {})
      setTimeout(() => controller.abort(), 50).unref()
      await expect(cancelled).rejects.toMatchObject({ category: 'cancelled' })
      await blocker`rollback`

      const [session] = await connection<{ role: string }[]>`select current_user as role`
      expect(session?.role).toBe('eve_space')
    } finally {
      await blocker`rollback`.catch(() => undefined)
      await Promise.all([connection.end(), blocker.end()])
    }
  })

  test('rolls malformed scoped write output back and retains the first failure', async () => {
    const connection = postgres(databaseUrl)
    const migrationName = 'alpha-030-runtime-operations.sql'
    const migrationSql = runtimePersistenceMigrationSql()
    const operations = await runtimePersistenceOperations(migrationName, migrationSql)
    const writeOperation = operations[1]!

    try {
      await runStartupMigrations(connection, {
        installed: [{ moduleId: 'alpha', name: migrationName }],
        persistenceOperations: operations,
        loadModuleSql: async () => migrationSql,
      })

      await connection.begin(async (transaction) => {
        const scoped = createTransactionScopedModulePersistenceOperationInvoker(
          transaction,
          'alpha',
          operations,
        )
        const first = await scoped
          .invoke(writeOperation, { value: 'must roll back' })
          .catch((error: unknown) => error)
        expect(first).toMatchObject({ category: 'output' })
        expect(scoped.suppressedFailure()?.error).toBe(first)
        await expect(
          scoped.invoke(writeOperation, { value: 'must not run' }),
        ).rejects.toMatchObject({ category: 'repeated' })
        scoped.close()

        const [state] = await transaction<{ count: number; role: string }[]>`
          select
            current_user as role,
            (select count(*)::integer from eve_module_alpha.routine_records) as count
        `
        expect(state).toEqual({ count: 0, role: 'eve_space' })
      })
    } finally {
      await connection.end()
    }
  })

  test('executes exact migration bytes in declared order under the restricted role', async () => {
    const connection = postgres(databaseUrl)
    const firstSql = `
      create table execution_trace (
        ordinal integer primary key,
        executing_role text not null,
        search_path text not null,
        query_text text not null
      );
      insert into execution_trace values (
        1,
        current_user,
        current_setting('search_path'),
        current_query()
      );
    `
    const secondSql = `
      insert into execution_trace values (
        2,
        current_user,
        current_setting('search_path'),
        current_query()
      );
    `
    const installed = [
      { moduleId: 'alpha', name: 'alpha-900-first.sql' },
      { moduleId: 'alpha', name: 'alpha-100-second.sql' },
    ] as const
    const sqlByName = new Map([
      ['alpha-900-first.sql', firstSql],
      ['alpha-100-second.sql', secondSql],
    ])

    try {
      await runStartupMigrations(connection, {
        installed,
        loadModuleSql: async ({ name }) => sqlByName.get(name)!,
      })

      const trace = await connection<
        { ordinal: number; executing_role: string; search_path: string; query_text: string }[]
      >`
        select ordinal, executing_role, search_path, query_text
        from eve_module_alpha.execution_trace
        order by ordinal
      `
      expect(trace).toEqual([
        {
          ordinal: 1,
          executing_role: 'eve_module_alpha_migrate',
          search_path: 'eve_module_alpha',
          query_text: firstSql,
        },
        {
          ordinal: 2,
          executing_role: 'eve_module_alpha_migrate',
          search_path: 'eve_module_alpha',
          query_text: secondSql,
        },
      ])
    } finally {
      await connection.end()
    }
  })

  test('rolls back structurally accepted SQL that exceeds the migration role authority', async () => {
    const connection = postgres(databaseUrl)
    const migrationName = 'alpha-authority-probe.sql'

    try {
      await runStartupMigrations(connection, { installed: [] })

      const failure = await runModuleMigrationSets(connection, [
        {
          moduleId: 'alpha',
          migrations: [
            {
              name: migrationName,
              sql: `
                create table authority_rollback_probe (id integer);
                select setval('public.domain_events_event_sequence_seq', 1, false);
              `,
            },
          ],
        },
      ]).catch((error: unknown) => error)

      expect(failure).toMatchObject({ code: '42501' })
      const [state] = await connection<
        { applied: boolean; probe_exists: boolean; schema_exists: boolean }[]
      >`
        select
          exists (
            select 1 from schema_migrations where module = 'alpha' and name = ${migrationName}
          ) as applied,
          to_regclass('eve_module_alpha.authority_rollback_probe') is not null as probe_exists,
          to_regnamespace('eve_module_alpha') is not null as schema_exists
      `
      expect(state).toEqual({ applied: false, probe_exists: false, schema_exists: false })
    } finally {
      await connection.end()
    }
  })

  test('restores the session lock timeout it overrode while migrating', async () => {
    const connection = postgres(databaseUrl, { max: 1, connection: { lock_timeout: 7_000 } })

    try {
      await runStartupMigrations(connection, {
        installed: [{ moduleId: 'alpha', name: 'alpha-001-initial.sql' }],
        loadModuleSql: async () => 'create table alpha_first (id integer);',
      })

      const [session] = await connection<{ lock_timeout: string }[]>`
        select current_setting('lock_timeout') as lock_timeout
      `
      expect(session?.lock_timeout).toBe('7s')
    } finally {
      await connection.end()
    }
  })

  test('retains migration-role data access across separate startup runs', async () => {
    const connection = postgres(databaseUrl)

    try {
      await runStartupMigrations(connection, {
        installed: [{ moduleId: 'alpha', name: 'alpha-001-initial.sql' }],
        loadModuleSql: async () =>
          'create table alpha_records (id integer generated always as identity primary key, value text not null);',
      })
      await runStartupMigrations(connection, {
        installed: [
          { moduleId: 'alpha', name: 'alpha-001-initial.sql' },
          { moduleId: 'alpha', name: 'alpha-002-data.sql' },
        ],
        loadModuleSql: async ({ name }) =>
          name === 'alpha-001-initial.sql'
            ? 'create table alpha_records (id integer generated always as identity primary key, value text not null);'
            : "insert into alpha_records (value) values ('second startup'); update alpha_records set value = 'updated' where value = 'second startup';",
      })

      const records = await connection<{ value: string }[]>`
        select value from eve_module_alpha.alpha_records
      `
      expect(records).toEqual([{ value: 'updated' }])
    } finally {
      await connection.end()
    }
  })

  test('provisions restricted migration and runtime roles for every installed module', async () => {
    const connection = postgres(databaseUrl)
    const installed = [
      { moduleId: 'alpha', name: 'alpha-010-records.sql' },
      { moduleId: 'beta', name: 'beta-010-records.sql' },
    ] as const

    try {
      await runStartupMigrations(connection, {
        installed,
        moduleIds: ['alpha', 'beta', 'empty-module'],
        loadModuleSql: loadIsolationMigrationSql,
      })

      const provisioned = await connection<{ module_id: string }[]>`
        select module_id from module_schema_provisioning order by module_id
      `
      expect(provisioned).toEqual([
        { module_id: 'alpha' },
        { module_id: 'beta' },
        { module_id: 'empty-module' },
      ])
      const { checkWorkerReadiness, expectedWorkerMigration } =
        await import('../../../src/worker/readiness.js')
      await expect(
        checkWorkerReadiness(
          connection,
          [{ module: 'core', name: expectedWorkerMigration }],
          ['alpha', 'beta', 'empty-module'],
          {
            contractFingerprint: persistenceContractFingerprintFor(
              [],
              ['alpha', 'beta', 'empty-module'],
            ),
            operations: [],
          },
        ),
      ).resolves.toEqual({ healthy: true })

      const [security] = await connection<
        {
          admin_option: boolean
          alpha_create: boolean
          alpha_usage: boolean
          beta_usage: boolean
          empty_schema_exists: boolean
          inherit_option: boolean
          ledger_insert: boolean
          migration_admin_option: boolean
          migration_alpha_create: boolean
          migration_beta_usage: boolean
          migration_inherit_option: boolean
          migration_rolcanlogin: boolean
          migration_rolcreatedb: boolean
          migration_rolcreaterole: boolean
          migration_rolinherit: boolean
          migration_rolreplication: boolean
          migration_rolsuper: boolean
          migration_rolbypassrls: boolean
          migration_set_option: boolean
          runtime_sequence_access: boolean
          runtime_table_access: boolean
          rolcanlogin: boolean
          rolcreatedb: boolean
          rolcreaterole: boolean
          rolinherit: boolean
          rolreplication: boolean
          rolsuper: boolean
          rolbypassrls: boolean
          schema_owner: string
          set_option: boolean
          table_owner: string
        }[]
      >`
        select
          runtime.rolcanlogin,
          runtime.rolcreatedb,
          runtime.rolcreaterole,
          runtime.rolinherit,
          runtime.rolreplication,
          runtime.rolsuper,
          runtime.rolbypassrls,
          membership.admin_option,
          membership.inherit_option,
          membership.set_option,
          migration.rolcanlogin as migration_rolcanlogin,
          migration.rolcreatedb as migration_rolcreatedb,
          migration.rolcreaterole as migration_rolcreaterole,
          migration.rolinherit as migration_rolinherit,
          migration.rolreplication as migration_rolreplication,
          migration.rolsuper as migration_rolsuper,
          migration.rolbypassrls as migration_rolbypassrls,
          migration_membership.admin_option as migration_admin_option,
          migration_membership.inherit_option as migration_inherit_option,
          migration_membership.set_option as migration_set_option,
          pg_get_userbyid(alpha_schema.nspowner) as schema_owner,
          pg_get_userbyid(alpha_table.relowner) as table_owner,
          has_schema_privilege(runtime.rolname, 'eve_module_alpha', 'USAGE') as alpha_usage,
          has_schema_privilege(runtime.rolname, 'eve_module_alpha', 'CREATE') as alpha_create,
          has_schema_privilege(runtime.rolname, 'eve_module_beta', 'USAGE') as beta_usage,
          has_table_privilege(
            runtime.rolname,
            'eve_module_alpha.alpha_records',
            'SELECT, INSERT, UPDATE, DELETE'
          ) as runtime_table_access,
          has_sequence_privilege(
            runtime.rolname,
            'eve_module_alpha.alpha_records_id_seq',
            'USAGE'
          ) as runtime_sequence_access,
          has_schema_privilege(migration.rolname, 'eve_module_alpha', 'CREATE')
            as migration_alpha_create,
          has_schema_privilege(migration.rolname, 'eve_module_beta', 'USAGE')
            as migration_beta_usage,
          has_table_privilege(migration.rolname, 'public.schema_migrations', 'INSERT')
            as ledger_insert,
          to_regnamespace('eve_module_empty_module') is not null as empty_schema_exists
        from pg_roles runtime
        join pg_auth_members membership on membership.roleid = runtime.oid
        join pg_roles login_role on login_role.oid = membership.member
        join pg_roles migration on migration.rolname = 'eve_module_alpha_migrate'
        join pg_auth_members migration_membership on migration_membership.roleid = migration.oid
          and migration_membership.member = login_role.oid
        join pg_namespace alpha_schema on alpha_schema.nspname = 'eve_module_alpha'
        join pg_class alpha_table
          on alpha_table.relnamespace = alpha_schema.oid
          and alpha_table.relname = 'alpha_records'
        where runtime.rolname = 'eve_module_alpha_runtime'
          and login_role.rolname = current_user
      `
      expect(security).toMatchObject({
        admin_option: false,
        alpha_create: false,
        alpha_usage: true,
        beta_usage: false,
        empty_schema_exists: true,
        inherit_option: false,
        ledger_insert: false,
        migration_admin_option: false,
        migration_alpha_create: true,
        migration_beta_usage: false,
        migration_inherit_option: false,
        migration_rolcanlogin: false,
        migration_rolcreatedb: false,
        migration_rolcreaterole: false,
        migration_rolinherit: false,
        migration_rolreplication: false,
        migration_rolsuper: false,
        migration_rolbypassrls: false,
        migration_set_option: true,
        runtime_sequence_access: false,
        runtime_table_access: false,
        rolcanlogin: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolinherit: false,
        rolreplication: false,
        rolsuper: false,
        rolbypassrls: false,
        set_option: true,
      })
      expect(security?.schema_owner).toBe('eve_space')
      expect(security?.table_owner).toBe('eve_module_alpha_migrate')
      for (const statement of [
        'select * from eve_module_alpha.alpha_records',
        'select * from eve_module_beta.beta_records',
        'select * from public.users',
      ])
        await expect(
          connection.begin(async (transaction) => {
            await transaction`set local role eve_module_alpha_runtime`
            await transaction.unsafe(statement)
          }),
        ).rejects.toMatchObject({ code: '42501' })

      const [migrationIdentity] = await connection<{ role_name: string }[]>`
        select role_name from eve_module_alpha.alpha_migration_identity
      `
      expect(migrationIdentity?.role_name).toBe('eve_module_alpha_migrate')

      await expect(
        connection.begin(async (transaction) => {
          await transaction`set local role eve_module_alpha_migrate`
          await transaction`
            insert into public.schema_migrations (module, name)
            values ('alpha', 'alpha-forged.sql')
          `
        }),
      ).rejects.toMatchObject({ code: '42501' })
    } finally {
      await connection.end()
    }
  })

  test('attests runtime authority for a module without persistence operations', async () => {
    const connection = postgres(databaseUrl)
    const options = {
      installed: [{ moduleId: 'alpha', name: 'alpha-010-records.sql' }],
      loadModuleSql: loadIsolationMigrationSql,
    } as const

    try {
      await runStartupMigrations(connection, options)
      await connection`
        grant select on eve_module_alpha.alpha_records to eve_module_alpha_runtime
      `

      await expect(runStartupMigrations(connection, options)).rejects.toMatchObject({
        moduleId: 'alpha',
        operationId: 'catalog',
        failure: 'authority',
      })
      const [authority] = await connection<{ can_read: boolean }[]>`
        select has_table_privilege(
          'eve_module_alpha_runtime',
          'eve_module_alpha.alpha_records',
          'SELECT'
        ) as can_read
      `
      expect(authority?.can_read).toBe(true)
    } finally {
      await connection.end()
    }
  })

  test('characterizes PostgreSQL role recovery that fixed operations exclude', async () => {
    const connection = postgres(databaseUrl)

    try {
      await runStartupMigrations(connection, {
        installed: [{ moduleId: 'alpha', name: 'alpha-010-records.sql' }],
        loadModuleSql: loadIsolationMigrationSql,
      })

      const [privileges] = await connection<{ can_read_users: boolean }[]>`
        select has_table_privilege(
          'eve_module_alpha_runtime',
          'public.users',
          'SELECT'
        ) as can_read_users
      `
      expect(privileges?.can_read_users).toBe(false)

      const recovered = await connection.begin(async (transaction) => {
        await transaction`set local role eve_module_alpha_runtime`
        const [restricted] = await transaction<{ current_user: string; session_user: string }[]>`
          select current_user, session_user
        `

        await transaction.unsafe('reset role').simple()
        const [restored] = await transaction<
          { current_user: string; session_user: string; user_count: number }[]
        >`
          select
            current_user,
            session_user,
            (select count(*)::integer from public.users) as user_count
        `
        return { restricted, restored }
      })

      expect(recovered.restricted).toEqual({
        current_user: 'eve_module_alpha_runtime',
        session_user: 'eve_space',
      })
      expect(recovered.restored).toEqual({
        current_user: 'eve_space',
        session_user: 'eve_space',
        user_count: 0,
      })
    } finally {
      await connection.end()
    }
  })

  test('transfers existing module objects from the platform to the migration role', async () => {
    const connection = postgres(databaseUrl)

    try {
      await runMigrations(connection)
      await connection`create schema eve_module_alpha`
      await connection`
        create table eve_module_alpha.legacy_records (
          id bigint generated always as identity primary key
        )
      `
      await connection`create type eve_module_alpha.legacy_state as enum ('ready')`
      await connection`
        create function eve_module_alpha.legacy_count() returns bigint
        language sql
        as 'select count(*) from eve_module_alpha.legacy_records'
      `

      await runStartupMigrations(connection, {
        installed: [{ moduleId: 'alpha', name: 'alpha-001-adopt.sql' }],
        loadModuleSql: async () => 'alter table legacy_records add column value text;',
      })

      const relations = await connection<{ name: string; owner: string }[]>`
        select relation.relname as name, pg_get_userbyid(relation.relowner) as owner
        from pg_class relation
        join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'eve_module_alpha'
          and relation.relname in ('legacy_records', 'legacy_records_id_seq')
        order by relation.relname
      `
      const [state] = await connection<
        { routine_owner: string; schema_owner: string; type_owner: string }[]
      >`
        select
          pg_get_userbyid(namespace.nspowner) as schema_owner,
          pg_get_userbyid(type.typowner) as type_owner,
          pg_get_userbyid(routine.proowner) as routine_owner
        from pg_namespace namespace
        join pg_type type on type.typnamespace = namespace.oid
          and type.typname = 'legacy_state'
        join pg_proc routine on routine.pronamespace = namespace.oid
          and routine.proname = 'legacy_count'
        where namespace.nspname = 'eve_module_alpha'
      `

      expect(relations).toEqual([
        { name: 'legacy_records', owner: 'eve_module_alpha_migrate' },
        { name: 'legacy_records_id_seq', owner: 'eve_module_alpha_migrate' },
      ])
      expect(state).toEqual({
        routine_owner: 'eve_module_alpha_migrate',
        schema_owner: 'eve_space',
        type_owner: 'eve_module_alpha_migrate',
      })
    } finally {
      await connection.end()
    }
  })

  test('seeds module defaults once and retains unavailable module settings', async () => {
    const connection = postgres(databaseUrl)

    try {
      await runStartupMigrations(connection, {
        installed: [],
        moduleIds: ['alpha', 'beta'],
        moduleDefinitions: [
          { moduleId: 'alpha', defaultEnabled: true },
          { moduleId: 'beta', defaultEnabled: false },
        ],
        moduleSectionDefinitions: [],
      })
      await connection`
        update deployment_modules
        set enabled = false, updated_at = '2026-08-24T12:00:00Z'
        where module_id = 'alpha'
      `
      await connection`
        insert into deployment_shell_navigation_order (
          owner_id,
          navigation_id,
          position,
          created_at,
          updated_at
        ) values
          ('core', 'core-overview', 0, '2026-08-24T10:00:00Z', '2026-08-24T10:00:00Z'),
          ('alpha', 'alpha-audit', 1, '2026-08-24T10:00:00Z', '2026-08-24T10:00:00Z')
      `

      await runStartupMigrations(connection, {
        installed: [],
        moduleIds: ['beta', 'delta'],
        moduleDefinitions: [
          { moduleId: 'beta', defaultEnabled: true },
          { moduleId: 'delta', defaultEnabled: true },
        ],
        moduleSectionDefinitions: [],
      })

      const modules = await connection<{ module_id: string; enabled: boolean; updated_at: Date }[]>`
        select module_id, enabled, updated_at
        from deployment_modules
        order by module_id
      `
      expect(modules).toEqual([
        {
          module_id: 'alpha',
          enabled: false,
          updated_at: new Date('2026-08-24T12:00:00Z'),
        },
        {
          module_id: 'beta',
          enabled: false,
          updated_at: expect.any(Date),
        },
        {
          module_id: 'core',
          enabled: true,
          updated_at: expect.any(Date),
        },
        {
          module_id: 'delta',
          enabled: true,
          updated_at: expect.any(Date),
        },
      ])
      const navigation = await connection<
        { owner_id: string; navigation_id: string; position: number; updated_at: Date }[]
      >`
        select owner_id, navigation_id, position, updated_at
        from deployment_shell_navigation_order
        order by position
      `
      expect(navigation).toEqual([
        {
          owner_id: 'core',
          navigation_id: 'core-overview',
          position: 0,
          updated_at: new Date('2026-08-24T10:00:00Z'),
        },
        {
          owner_id: 'alpha',
          navigation_id: 'alpha-audit',
          position: 1,
          updated_at: new Date('2026-08-24T10:00:00Z'),
        },
      ])

      const definitions = [
        { moduleId: 'beta', defaultEnabled: true },
        { moduleId: 'delta', defaultEnabled: true },
      ] as const
      const defaults = [
        {
          ownerId: 'core',
          navigationId: 'core-overview',
          placement: 'dashboard',
          order: 10,
        },
        {
          ownerId: 'alpha',
          navigationId: 'alpha-audit',
          placement: 'dashboard',
          order: 20,
        },
        {
          ownerId: 'beta',
          navigationId: 'beta-audit',
          placement: 'dashboard',
          order: 30,
        },
        {
          ownerId: 'delta',
          navigationId: 'delta-audit',
          placement: 'dashboard',
          order: 40,
        },
      ] as const
      await expect(
        setInstalledModuleEnabled('alpha', true, connection, definitions),
      ).resolves.toBeNull()
      await expect(
        setInstalledModuleEnabled('beta', true, connection, definitions),
      ).resolves.toMatchObject({ moduleId: 'beta', enabled: true, defaultEnabled: true })
      await expect(loadModuleRuntimeState(connection, definitions, defaults)).resolves.toEqual({
        enabledModuleIds: ['beta', 'delta'],
        enabledSections: [],
        shellNavigationOrder: {
          dashboard: [
            { ownerId: 'core', navigationId: 'core-overview' },
            { ownerId: 'beta', navigationId: 'beta-audit' },
            { ownerId: 'delta', navigationId: 'delta-audit' },
          ],
          character: [],
        },
      })

      const savedOrder = {
        dashboard: [
          { ownerId: 'delta', navigationId: 'delta-audit' },
          { ownerId: 'core', navigationId: 'core-overview' },
          { ownerId: 'beta', navigationId: 'beta-audit' },
        ],
        character: [],
      }
      await expect(
        saveInstalledShellNavigationOrder(savedOrder, connection, definitions, defaults),
      ).resolves.toEqual(savedOrder)
      const retained = await connection<{ count: number }[]>`
        select count(*)::integer as count
        from deployment_shell_navigation_order
        where owner_id = 'alpha' and navigation_id = 'alpha-audit'
      `
      expect(retained[0]?.count).toBe(1)
    } finally {
      await connection.end()
    }
  })

  test('rolls back persistence provisioning when a first module migration fails', async () => {
    const connection = postgres(databaseUrl)

    try {
      await expect(
        runStartupMigrations(connection, {
          installed: [{ moduleId: 'gamma', name: 'gamma-001-failing.sql' }],
          loadModuleSql: async () =>
            'create table first_failure_probe (id integer); select missing_first_function();',
        }),
      ).rejects.toThrow('missing_first_function')

      const [state] = await connection<
        {
          migration_role_exists: boolean
          provisioned: boolean
          role_exists: boolean
          schema_exists: boolean
        }[]
      >`
        select
          exists (
            select 1 from module_schema_provisioning where module_id = 'gamma'
          ) as provisioned,
          to_regrole('eve_module_gamma_runtime') is not null as role_exists,
          to_regrole('eve_module_gamma_migrate') is not null as migration_role_exists,
          to_regnamespace('eve_module_gamma') is not null as schema_exists
      `
      expect(state).toEqual({
        migration_role_exists: false,
        provisioned: false,
        role_exists: false,
        schema_exists: false,
      })
    } finally {
      await connection.end()
    }
  })

  test('refuses to adopt an incompatible module runtime role', async () => {
    const connection = postgres(databaseUrl)

    try {
      await connection`create role eve_module_drift_runtime login`
      await expect(
        runStartupMigrations(connection, { installed: [], moduleIds: ['drift'] }),
      ).rejects.toThrow('Existing module runtime role eve_module_drift_runtime is not restricted')
      const [schema] = await connection<{ exists: boolean }[]>`
        select to_regnamespace('eve_module_drift') is not null as exists
      `
      expect(schema?.exists).toBe(false)
    } finally {
      await connection`drop role if exists eve_module_drift_runtime`
      await connection.end()
    }
  })

  test('bounds module migration advisory-lock waits', async () => {
    const setup = postgres(databaseUrl)
    await runMigrations(setup)
    await setup.end()

    const holder = await postgres(databaseUrl).reserve()
    const contender = postgres(databaseUrl)
    const moduleId = 'alpha'
    const migration = {
      moduleId,
      migrations: [
        { name: 'alpha-001-initial.sql', sql: 'create table alpha_lock_probe (id integer);' },
      ],
    }

    try {
      await holder`
        select pg_advisory_lock(
          ${moduleMigrationLockNamespace},
          ${moduleMigrationLockKey(moduleId)}
        )
      `
      await expect(
        runModuleMigrationSets(contender, [migration], { lockTimeoutMs: 100 }),
      ).rejects.toMatchObject({ code: '55P03' })

      const [state] = await contender<{ applied: number; table_exists: boolean }[]>`
        select
          (
            select count(*)::integer
            from schema_migrations
            where module = ${moduleId}
          ) as applied,
          to_regclass('alpha_lock_probe') is not null as table_exists
      `
      expect(state).toEqual({ applied: 0, table_exists: false })
    } finally {
      await holder`
        select pg_advisory_unlock(
          ${moduleMigrationLockNamespace},
          ${moduleMigrationLockKey(moduleId)}
        )
      `
      holder.release()
      await contender.end()
    }
  })

  test('generates one stable planner offset for the installation', async () => {
    const connection = postgres(databaseUrl)

    try {
      await runMigrations(connection)
      const [first] = await connection<{ planner_schedule_offset_ms: number }[]>`
        select planner_schedule_offset_ms from deployment_installation_settings where id = 1
      `
      await runMigrations(connection)
      const [second] = await connection<{ planner_schedule_offset_ms: number }[]>`
        select planner_schedule_offset_ms from deployment_installation_settings where id = 1
      `

      expect(first?.planner_schedule_offset_ms).toBeGreaterThanOrEqual(0)
      expect(first?.planner_schedule_offset_ms).toBeLessThan(60_000)
      expect(second).toEqual(first)
    } finally {
      await connection.end()
    }
  })

  test('rolls back a failed migration with its migration record', async () => {
    const connection = postgres(databaseUrl)

    try {
      await expect(
        runMigrations(connection, [
          {
            name: 'test_rollback.sql',
            sql: 'create table migration_rollback_probe (id integer); select missing_function();',
          },
        ]),
      ).rejects.toThrow('missing_function')

      const [table] = await connection<{ exists: boolean }[]>`
        select to_regclass('migration_rollback_probe') is not null as exists
      `
      const applied = await connection<{ count: number }[]>`
        select count(*)::integer as count from schema_migrations where name = 'test_rollback.sql'
      `
      expect(table?.exists).toBe(false)
      expect(applied[0]?.count).toBe(0)
    } finally {
      await connection.end()
    }
  })

  test('rolls back every domain-event migration object when the migration fails', async () => {
    const connection = postgres(databaseUrl)
    const migration = (await loadMigrations()).find(({ name }) => name === '001_baseline.sql')
    expect(migration).toBeDefined()

    try {
      await expect(
        runMigrations(connection, [
          {
            name: migration!.name,
            sql: `${migration!.sql}\nselect missing_domain_event_migration_function();`,
          },
        ]),
      ).rejects.toThrow('missing_domain_event_migration_function')

      const [objects] = await connection<
        { table_exists: boolean; function_exists: boolean; migration_count: number }[]
      >`
        select
          to_regclass('domain_events') is not null as table_exists,
          to_regprocedure('prevent_domain_event_envelope_update()') is not null as function_exists,
          (
            select count(*)::integer from schema_migrations
            where name = '001_baseline.sql'
          ) as migration_count
      `
      expect(objects).toEqual({
        table_exists: false,
        function_exists: false,
        migration_count: 0,
      })
    } finally {
      await connection.end()
    }
  })

  test('rejects migrations that cannot run in a transaction', async () => {
    const connection = postgres(databaseUrl)

    try {
      await expect(
        runMigrations(connection, [
          {
            name: 'test_concurrent_index.sql',
            sql: 'create index concurrently test_index on users (created_at);',
          },
        ]),
      ).rejects.toThrow('cannot run in a transaction')

      const applied = await connection<{ count: number }[]>`
        select count(*)::integer as count
        from schema_migrations
        where name = 'test_concurrent_index.sql'
      `
      expect(applied[0]?.count).toBe(0)
    } finally {
      await connection.end()
    }
  })

  test('rejects changed content for an already-applied supplied migration', async () => {
    const connection = postgres(databaseUrl)

    try {
      await runMigrations(connection)
      await runMigrations(connection, [{ name: 'legacy.sql', sql: 'select 1' }])
      await expect(
        runMigrations(connection, [{ name: 'legacy.sql', sql: 'vacuum' }]),
      ).rejects.toThrow('Applied migration content identity mismatch: legacy.sql')
    } finally {
      await connection.end()
    }
  })

  test('bounds migration advisory-lock waits', async () => {
    const holder = await postgres(databaseUrl).reserve()
    const contender = postgres(databaseUrl)

    try {
      await holder`select pg_advisory_lock(${migrationLockId})`
      await expect(runMigrations(contender, [], { lockTimeoutMs: 100 })).rejects.toMatchObject({
        code: '55P03',
      })
    } finally {
      await holder`select pg_advisory_unlock(${migrationLockId})`
      holder.release()
      await contender.end()
    }
  })

  test('persists one rotated refresh token across independent token-service instances', async () => {
    const connection = postgres(databaseUrl)
    const characterId = 1404328063
    const userId = '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c'
    const scope = 'esi-wallet.read_character_wallet.v1'
    await runMigrations(connection)
    const { decryptTokens, encryptTokens } = await import('../../../src/auth/security.js')

    await connection`insert into users (id) values (${userId})`
    await connection`
      insert into characters (character_id, user_id, name, corporation_id, is_main)
      values (${characterId}, ${userId}, 'Refresh Test', 1000166, true)
    `
    await connection`
      insert into platform_subject_lifecycles (subject_kind, subject_id, character_id)
      values ('character', ${String(characterId)}, ${characterId})
    `
    await connection`
      insert into eve_tokens (
        character_id, encrypted_tokens, access_token_expires_at, scopes
      ) values (
        ${characterId},
        ${encryptTokens({ accessToken: 'expired-access-token', refreshToken: 'original-refresh-token' })},
        ${new Date(Date.now() - 60_000)},
        ${connection.json([scope])}
      )
    `
    const [lifecycle] = await connection<{ subject_lifecycle_id: string }[]>`
      select subject_lifecycle_id
      from platform_subject_lifecycles
      where character_id = ${characterId}
    `
    if (!lifecycle) throw new Error('Character lifecycle is missing')

    let releaseRefresh: () => void
    const refreshReleased = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    let notifyRefreshStarted: () => void
    const refreshStarted = new Promise<void>((resolve) => {
      notifyRefreshStarted = resolve
    })
    const refreshAccessToken = vi.fn(async () => {
      notifyRefreshStarted()
      await refreshReleased
      return {
        access_token: 'rotated-access-token',
        refresh_token: 'rotated-refresh-token',
        expires_in: 1200,
        token_type: 'Bearer',
      }
    })
    const verifyAccessToken = vi.fn(async () => ({
      characterId,
      characterName: 'Refresh Test',
      scopes: [scope],
    }))

    vi.resetModules()
    vi.doMock('../../../src/auth/sso.js', () => ({ refreshAccessToken, verifyAccessToken }))
    const firstService = await import('../../../src/auth/tokens.js')
    const firstClient = await import('../../../src/db/client.js')

    vi.resetModules()
    vi.doMock('../../../src/auth/sso.js', () => ({ refreshAccessToken, verifyAccessToken }))
    const secondService = await import('../../../src/auth/tokens.js')
    const secondClient = await import('../../../src/db/client.js')

    try {
      const first = firstService.getCharacterAccessToken(
        characterId,
        lifecycle.subject_lifecycle_id,
        scope,
      )
      await refreshStarted
      const second = secondService.getCharacterAccessToken(
        characterId,
        lifecycle.subject_lifecycle_id,
        scope,
      )
      releaseRefresh!()

      await expect(Promise.all([first, second])).resolves.toEqual([
        'rotated-access-token',
        'rotated-access-token',
      ])
      expect(refreshAccessToken).toHaveBeenCalledOnce()

      const [stored] = await connection<
        {
          encrypted_tokens: string
          token_version: number
        }[]
      >`
        select encrypted_tokens, token_version from eve_tokens where character_id = ${characterId}
      `
      expect(stored?.token_version).toBe(1)
      expect(decryptTokens(stored!.encrypted_tokens)).toEqual({
        accessToken: 'rotated-access-token',
        refreshToken: 'rotated-refresh-token',
      })
    } finally {
      await Promise.all([connection.end(), firstClient.sql.end(), secondClient.sql.end()])
      vi.doUnmock('../../../src/auth/sso.js')
    }
  })
})

async function loadNormalizedPublicSchema(connection: postgres.Sql) {
  const objects = await connection<{ kind: string; identity: string; definition: string }[]>`
    select kind, identity, definition
    from (
      select
        'column' as kind,
        format('%I.%I', class.relname, attribute.attname) as identity,
        concat_ws(
          ' ',
          format_type(attribute.atttypid, attribute.atttypmod),
          case when attribute.attnotnull then 'not null' else 'nullable' end,
          case
            when default_value.adbin is null then null
            else 'default ' || pg_get_expr(default_value.adbin, default_value.adrelid)
          end
        ) as definition
      from pg_attribute attribute
      join pg_class class on class.oid = attribute.attrelid
      join pg_namespace namespace on namespace.oid = class.relnamespace
      left join pg_attrdef default_value
        on default_value.adrelid = attribute.attrelid
        and default_value.adnum = attribute.attnum
      where namespace.nspname = 'public'
        and class.relkind in ('r', 'p', 'v', 'm')
        and attribute.attnum > 0
        and not attribute.attisdropped

      union all

      select
        'constraint',
        format('%I.%I', class.relname, constraint_record.conname),
        pg_get_constraintdef(constraint_record.oid, true)
      from pg_constraint constraint_record
      join pg_class class on class.oid = constraint_record.conrelid
      join pg_namespace namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'public'

      union all

      select
        'index',
        index_record.indexname,
        index_record.indexdef
      from pg_indexes index_record
      where index_record.schemaname = 'public'

      union all

      select
        'function',
        format(
          '%I(%s)',
          procedure_record.proname,
          pg_get_function_identity_arguments(procedure_record.oid)
        ),
        pg_get_functiondef(procedure_record.oid)
      from pg_proc procedure_record
      join pg_namespace namespace on namespace.oid = procedure_record.pronamespace
      where namespace.nspname = 'public'

      union all

      select
        'trigger',
        format('%I.%I', class.relname, trigger_record.tgname),
        pg_get_triggerdef(trigger_record.oid, true)
      from pg_trigger trigger_record
      join pg_class class on class.oid = trigger_record.tgrelid
      join pg_namespace namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'public' and not trigger_record.tgisinternal

      union all

      select
        'row-security',
        class.relname,
        format('enabled=%s forced=%s', class.relrowsecurity, class.relforcerowsecurity)
      from pg_class class
      join pg_namespace namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'public'
        and class.relkind in ('r', 'p')
        and (class.relrowsecurity or class.relforcerowsecurity)
    ) schema_object
    order by kind, identity
  `

  return objects
    .map(({ kind, identity, definition }) => {
      const normalized = definition.replaceAll(/\s+/g, ' ').trim()
      const sha256 = createHash('sha256').update(normalized).digest('hex')
      return `${kind}\t${identity}\t${sha256}`
    })
    .join('\n')
}
