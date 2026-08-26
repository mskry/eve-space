import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import {
  migrationLockId,
  moduleMigrationLockKey,
  moduleMigrationLockNamespace,
} from '../../src/db/locks.js'
import { loadMigrations, runMigrations } from '../../src/db/migration-runner.js'
import { runModuleMigrationSets } from '../../src/db/module-migration-runner.js'
import { createModulePersistenceCapability } from '../../src/db/module-persistence.js'
import { runStartupMigrations } from '../../src/db/startup-migrations.js'
import {
  loadModuleRuntimeState,
  saveInstalledShellNavigationOrder,
  setInstalledModuleEnabled,
} from '../../src/platform/module-settings.js'

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

    create function ${moduleId}_privileged_count() returns bigint
    language sql
    security definer
    set search_path = pg_catalog
    as $$ select count(*) from public.users $$;
  `
}

describe('multi-process safety', () => {
  test('refuses worker readiness until its expected migration is applied', async () => {
    const connection = postgres(databaseUrl)
    const { checkWorkerReadiness, expectedWorkerMigration } =
      await import('../../src/worker-readiness.js')

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
      const applied = await inspector<{ module: string; name: string }[]>`
        select module, name from schema_migrations order by name
      `
      expect(applied.map((migration) => migration.name)).toEqual(
        migrations.map((migration) => migration.name),
      )
      expect(new Set(applied.map((migration) => migration.module))).toEqual(new Set(['core']))

      const { checkWorkerReadiness } = await import('../../src/worker-readiness.js')
      await expect(checkWorkerReadiness(inspector)).resolves.toEqual({ healthy: true })
    } finally {
      await Promise.all([first.end(), second.end(), inspector.end()])
    }
  })

  test('upgrades a legacy migration ledger without breaking name-only runners', async () => {
    const connection = postgres(databaseUrl)
    const transition = (await loadMigrations()).find(
      ({ name }) => name === '012_module_qualified_schema_migrations.sql',
    )
    expect(transition).toBeDefined()

    try {
      await connection`
        create table schema_migrations (
          name text primary key,
          applied_at timestamptz not null default now()
        )
      `
      await connection`
        insert into schema_migrations (name, applied_at)
        values
          ('010_domain_event_relay_safety.sql', '2026-01-01T00:00:00Z'),
          ('011_character_affiliation_sync.sql', '2026-01-02T00:00:00Z')
      `

      const { checkWorkerReadiness, expectedWorkerMigration } =
        await import('../../src/worker-readiness.js')
      await expect(checkWorkerReadiness(connection)).resolves.toEqual({
        healthy: false,
        reason: `Missing migration core/${expectedWorkerMigration}`,
        missing: { module: 'core', name: expectedWorkerMigration },
      })

      await runMigrations(connection, [transition!])
      await connection`insert into schema_migrations (name) values ('legacy-runner.sql')`
      await connection`
        insert into schema_migrations (module, name)
        values ('alpha', 'alpha-001-initial.sql'), ('beta', 'alpha-001-initial.sql')
      `

      const rows = await connection<{ module: string; name: string; applied_at: Date }[]>`
        select module, name, applied_at
        from schema_migrations
        order by module, name
      `
      expect(rows.map(({ module, name }) => ({ module, name }))).toEqual([
        { module: 'alpha', name: 'alpha-001-initial.sql' },
        { module: 'beta', name: 'alpha-001-initial.sql' },
        { module: 'core', name: '010_domain_event_relay_safety.sql' },
        { module: 'core', name: '011_character_affiliation_sync.sql' },
        { module: 'core', name: '012_module_qualified_schema_migrations.sql' },
        { module: 'core', name: 'legacy-runner.sql' },
      ])
      expect(
        rows.find(({ name }) => name === '010_domain_event_relay_safety.sql')?.applied_at,
      ).toEqual(new Date('2026-01-01T00:00:00Z'))
      expect(
        rows.find(({ name }) => name === '011_character_affiliation_sync.sql')?.applied_at,
      ).toEqual(new Date('2026-01-02T00:00:00Z'))

      const [shape] = await connection<
        { column_default: string; is_nullable: string; primary_key: string }[]
      >`
        select
          column_default,
          is_nullable,
          (
            select pg_get_constraintdef(oid)
            from pg_constraint
            where conrelid = 'schema_migrations'::regclass
              and contype = 'p'
          ) as primary_key
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'schema_migrations'
          and column_name = 'module'
      `
      expect(shape).toEqual({
        column_default: "'core'::text",
        is_nullable: 'NO',
        primary_key: 'PRIMARY KEY (module, name)',
      })
      await expect(
        connection`
          insert into schema_migrations (module, name)
          values ('alpha', 'alpha-001-initial.sql')
        `,
      ).rejects.toMatchObject({ code: '23505' })

      await expect(checkWorkerReadiness(connection)).resolves.toEqual({
        healthy: false,
        reason: `Missing migration core/${expectedWorkerMigration}`,
        missing: { module: 'core', name: expectedWorkerMigration },
      })
    } finally {
      await connection.end()
    }
  })

  test('rolls back the legacy ledger transition atomically', async () => {
    const connection = postgres(databaseUrl)
    const transition = (await loadMigrations()).find(
      ({ name }) => name === '012_module_qualified_schema_migrations.sql',
    )
    expect(transition).toBeDefined()

    try {
      await connection`
        create table schema_migrations (
          name text primary key,
          applied_at timestamptz not null default now()
        )
      `
      await connection`insert into schema_migrations (name) values ('011_character_affiliation_sync.sql')`

      await expect(
        runMigrations(connection, [
          {
            ...transition!,
            sql: `${transition!.sql}\nselect missing_ledger_transition_function();`,
          },
        ]),
      ).rejects.toThrow('missing_ledger_transition_function')

      const [state] = await connection<
        { module_exists: boolean; primary_key: string; rows: number }[]
      >`
        select
          exists (
            select 1
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'schema_migrations'
              and column_name = 'module'
          ) as module_exists,
          (
            select pg_get_constraintdef(oid)
            from pg_constraint
            where conrelid = 'schema_migrations'::regclass
              and contype = 'p'
          ) as primary_key,
          (select count(*)::integer from schema_migrations) as rows
      `
      expect(state).toEqual({
        module_exists: false,
        primary_key: 'PRIMARY KEY (name)',
        rows: 1,
      })
    } finally {
      await connection.end()
    }
  })

  test('qualifies core migration reads and writes after the ledger transition', async () => {
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

      const { createOwnedCharacterCoreReads, sdeCoreReads } =
        await import('../../src/platform/core-read-capabilities.js')
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
      await expect(sdeCoreReads.loadPublishedTypeGroups([37, 36, 35, 34])).resolves.toEqual([
        { typeId: 34, typeName: 'Tritanium', groupId: 18, groupName: 'Mineral' },
        { typeId: 37, typeName: 'Isogen', groupId: 18, groupName: 'Mineral' },
      ])

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

  test('provisions restricted runtime roles for every installed module', async () => {
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
        await import('../../src/worker-readiness.js')
      await expect(
        checkWorkerReadiness(
          connection,
          [{ module: 'core', name: expectedWorkerMigration }],
          ['empty-module'],
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
          pg_get_userbyid(alpha_schema.nspowner) as schema_owner,
          pg_get_userbyid(alpha_table.relowner) as table_owner,
          has_schema_privilege(runtime.rolname, 'eve_module_alpha', 'USAGE') as alpha_usage,
          has_schema_privilege(runtime.rolname, 'eve_module_alpha', 'CREATE') as alpha_create,
          has_schema_privilege(runtime.rolname, 'eve_module_beta', 'USAGE') as beta_usage,
          to_regnamespace('eve_module_empty_module') is not null as empty_schema_exists
        from pg_roles runtime
        join pg_auth_members membership on membership.roleid = runtime.oid
        join pg_roles login_role on login_role.oid = membership.member
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
        rolcanlogin: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolinherit: false,
        rolreplication: false,
        rolsuper: false,
        rolbypassrls: false,
        set_option: true,
      })
      expect(security?.schema_owner).toBe(security?.table_owner)

      const alphaPersistence = createModulePersistenceCapability(connection, 'alpha')
      await expect(
        alphaPersistence.transaction(async (restricted) => {
          const [identity] = await restricted<{ current_user: string; session_user: string }[]>`
            select current_user, session_user
          `
          const [inserted] = await restricted<{ id: number; value: string }[]>`
            insert into alpha_records (value)
            values ('allowed')
            returning id, value
          `
          return { identity, inserted }
        }),
      ).resolves.toEqual({
        identity: {
          current_user: 'eve_module_alpha_runtime',
          session_user: 'eve_space',
        },
        inserted: { id: 1, value: 'allowed' },
      })
      await expect(
        alphaPersistence.transaction(
          async (restricted) => restricted`select count(*) from public.users`,
        ),
      ).rejects.toMatchObject({ code: '42501' })
      await expect(
        alphaPersistence.transaction(
          async (restricted) => restricted`insert into public.users default values`,
        ),
      ).rejects.toMatchObject({ code: '42501' })
      await expect(
        alphaPersistence.transaction(
          async (restricted) => restricted`select eve_module_alpha.alpha_privileged_count()`,
        ),
      ).rejects.toMatchObject({ code: '42501' })
      await expect(
        alphaPersistence.transaction(
          async (restricted) => restricted`select count(*) from eve_module_beta.beta_records`,
        ),
      ).rejects.toMatchObject({ code: '42501' })
      await expect(
        alphaPersistence.transaction(
          async (restricted) =>
            restricted`insert into eve_module_beta.beta_records (value) values ('forbidden')`,
        ),
      ).rejects.toMatchObject({ code: '42501' })
      await expect(
        alphaPersistence.transaction(
          async (restricted) => restricted`create table eve_module_alpha.forbidden (id integer)`,
        ),
      ).rejects.toMatchObject({ code: '42501' })
      await expect(
        alphaPersistence.transaction(async (restricted) => {
          await restricted`insert into alpha_records (value) values ('rolled back')`
          throw new Error('rollback module transaction')
        }),
      ).rejects.toThrow('rollback module transaction')

      const [outside] = await connection<
        { current_user: string; rolled_back_rows: number; session_user: string }[]
      >`
        select
          current_user,
          session_user,
          (
            select count(*)::integer
            from eve_module_alpha.alpha_records
            where value = 'rolled back'
          ) as rolled_back_rows
      `
      expect(outside).toEqual({
        current_user: 'eve_space',
        rolled_back_rows: 0,
        session_user: 'eve_space',
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
        { provisioned: boolean; role_exists: boolean; schema_exists: boolean }[]
      >`
        select
          exists (
            select 1 from module_schema_provisioning where module_id = 'gamma'
          ) as provisioned,
          to_regrole('eve_module_gamma_runtime') is not null as role_exists,
          to_regnamespace('eve_module_gamma') is not null as schema_exists
      `
      expect(state).toEqual({ provisioned: false, role_exists: false, schema_exists: false })
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
    const migration = (await loadMigrations()).find(({ name }) => name === '009_domain_events.sql')
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
            where name = '009_domain_events.sql'
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

  test('does not revalidate an already-applied migration', async () => {
    const connection = postgres(databaseUrl)

    try {
      await runMigrations(connection, [{ name: 'legacy.sql', sql: 'select 1' }])
      await expect(
        runMigrations(connection, [{ name: 'legacy.sql', sql: 'vacuum' }]),
      ).resolves.toBeUndefined()
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
    const { decryptTokens, encryptTokens } = await import('../../src/security.js')

    await connection`insert into users (id) values (${userId})`
    await connection`
      insert into characters (character_id, user_id, name, corporation_id, is_main)
      values (${characterId}, ${userId}, 'Refresh Test', 1000166, true)
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
    vi.doMock('../../src/eve-sso.js', () => ({ refreshAccessToken, verifyAccessToken }))
    const firstService = await import('../../src/token-service.js')
    const firstClient = await import('../../src/db/client.js')

    vi.resetModules()
    vi.doMock('../../src/eve-sso.js', () => ({ refreshAccessToken, verifyAccessToken }))
    const secondService = await import('../../src/token-service.js')
    const secondClient = await import('../../src/db/client.js')

    try {
      const first = firstService.getCharacterAccessToken(characterId, scope)
      await refreshStarted
      const second = secondService.getCharacterAccessToken(characterId, scope)
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
      vi.doUnmock('../../src/eve-sso.js')
    }
  })
})
