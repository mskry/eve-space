import { describe, expect, test, vi } from 'vitest'
import { loadInstalledModuleMigrationSets } from '../../src/db/module-migration-runner.js'
import { assertModuleMigrationSql } from '../../src/db/module-migration-validation.js'
import { modulePersistenceNames } from '../../src/db/module-persistence-provisioner.js'

describe('installed module migration loading', () => {
  test('does not load SQL when no modules are installed', async () => {
    const loadSql = vi.fn()

    await expect(loadInstalledModuleMigrationSets([], loadSql)).resolves.toEqual([])
    expect(loadSql).not.toHaveBeenCalled()
  })

  test('retains installed modules that have no migrations', async () => {
    await expect(
      loadInstalledModuleMigrationSets([], undefined, ['empty-module']),
    ).resolves.toEqual([{ moduleId: 'empty-module', migrations: [] }])
  })

  test('sorts modules while preserving each declared migration order', async () => {
    const loadSql = vi.fn(async ({ moduleId, name }) => `select '${moduleId}/${name}'`)

    await expect(
      loadInstalledModuleMigrationSets(
        [
          { moduleId: 'beta', name: 'beta-002-second.sql' },
          { moduleId: 'alpha', name: 'alpha-001-first.sql' },
          { moduleId: 'beta', name: 'beta-001-first.sql' },
        ],
        loadSql,
      ),
    ).resolves.toEqual([
      {
        moduleId: 'alpha',
        migrations: [{ name: 'alpha-001-first.sql', sql: "select 'alpha/alpha-001-first.sql'" }],
      },
      {
        moduleId: 'beta',
        migrations: [
          { name: 'beta-002-second.sql', sql: "select 'beta/beta-002-second.sql'" },
          { name: 'beta-001-first.sql', sql: "select 'beta/beta-001-first.sql'" },
        ],
      },
    ])
  })

  test.each([
    [[{ moduleId: 'core', name: 'core-001.sql' }], 'Invalid installed module migration owner'],
    [[{ moduleId: 'Alpha', name: 'Alpha-001.sql' }], 'Invalid installed module migration owner'],
    [[{ moduleId: 'alpha', name: '001.sql' }], 'must use package-local alpha-*.sql'],
    [[{ moduleId: 'alpha', name: 'alpha-001?alias.sql' }], 'must use package-local alpha-*.sql'],
    [[{ moduleId: 'alpha', name: 'alpha-../001.sql' }], 'must use package-local alpha-*.sql'],
    [
      [
        { moduleId: 'alpha', name: 'alpha-001.sql' },
        { moduleId: 'alpha', name: 'alpha-001.sql' },
      ],
      'Duplicate installed module migration alpha/alpha-001.sql',
    ],
  ])('rejects invalid descriptors before loading SQL', async (descriptors, message) => {
    const loadSql = vi.fn()

    await expect(loadInstalledModuleMigrationSets(descriptors, loadSql)).rejects.toThrow(message)
    expect(loadSql).not.toHaveBeenCalled()
  })
})

describe('module persistence names', () => {
  test('maps module IDs to bounded PostgreSQL identifiers', () => {
    expect(modulePersistenceNames('member-audit')).toEqual({
      migrationRoleName: 'eve_module_member_audit_migrate',
      schemaName: 'eve_module_member_audit',
      runtimeRoleName: 'eve_module_member_audit_runtime',
    })
    expect(modulePersistenceNames('a'.repeat(44)).runtimeRoleName).toHaveLength(63)
    expect(modulePersistenceNames('a'.repeat(44)).migrationRoleName).toHaveLength(63)
  })

  test('rejects module IDs that cannot produce safe identifiers', () => {
    expect(() => modulePersistenceNames('a'.repeat(45))).toThrow('Invalid module persistence owner')
  })
})

describe('module migration SQL validation', () => {
  test.each([
    'EXCLUDED.value',
    'excluded.value',
    '"excluded"."value"',
    'coalesce(EXCLUDED.value, records.value)',
    '(select EXCLUDED.value)',
  ])('accepts the upsert pseudo-relation in %s', (value) => {
    expect(() =>
      validateModuleSql(`
      insert into records (id, value) values (1, 'new')
      on conflict (id) do update set value = ${value}
      where EXCLUDED.value <> records.value returning records.id;
    `),
    ).not.toThrow()
  })

  test('supports upserts inside CTEs and masked conflict-clause comments', () => {
    expect(() =>
      validateModuleSql(`
      with updated as (
        insert into records (id, value) values (1, 'new')
        on /* conflict */ conflict on constraint records_pkey
        do update set value = excluded.value returning id
      ) select updated.id from updated;
    `),
    ).not.toThrow()
  })

  test.each([
    'select * from excluded.records',
    'select excluded.value',
    'update records set value = excluded.value',
    'insert into excluded.records values (1) on conflict (id) do update set id = excluded.id',
    'insert into records values (1) on conflict (id) do update set id = excluded.read_value()',
    'insert into records values (1) on conflict (id) do update set id = (select id from excluded.records)',
    'insert into records values (1) on conflict (id) do update set id = excluded.records.id',
    'insert into records values (1) on conflict (id) do update set id = 1::excluded.value',
    'insert into records values (1) on conflict (id) do update set id = cast(1 as excluded.value)',
    'insert into records values (1) on conflict (id) do update set id = 1 returning excluded.id',
    'insert into records values (1) on conflict (id) do nothing returning excluded.id',
    'insert into records values (1) on conflict (id) do update set id = excluded.id; select excluded.id',
    'with updated as (insert into records values (1) on conflict (id) do update set id = excluded.id returning id) select excluded.id',
    "select 'insert on conflict do update set', excluded.value",
    'select "insert on conflict do update set", excluded.value',
    'insert into records values (1) on conflict (id) do update set id = "EXCLUDED".id',
  ])('does not allow a schema or out-of-scope pseudo-relation: %s', (sql) => {
    expect(() => validateModuleSql(sql)).toThrow(/cross-schema reference (excluded|EXCLUDED)/)
  })

  test('accepts schema-local DDL and data changes', () => {
    expect(() =>
      validateModuleSql(`
        create table records (id bigint generated always as identity primary key, value text);
        alter table records add column created_at timestamptz default now();
        insert into records (value) values ('public.users; grant admin');
        insert into records (id) values (1) on conflict (id) do nothing;
        update records set value = 'kept';
        update records as target set value = target.value;
        select source.id from records as source;
        select source.id, joined.id from records as source join records joined on joined.id = source.id;
        select derived.id from (select id from records) as derived;
        select nested.id from (select derived.id from (select id from records) derived) nested;
        select generated.value from generate_series(1, 3) as generated(value);
        select generated.value from generate_series(1, 3) generated(value);
        select value_rows.id from (values (1), (2)) as value_rows(id);
        create index records_created_at_idx on eve_module_alpha.records (created_at);
      `),
    ).not.toThrow()
  })

  test('ignores prohibited words in comments and literals', () => {
    expect(() =>
      validateModuleSql(`
        -- grant all on public.users
        /* create extension hstore */
        select 'reset role; public.users';
      `),
    ).not.toThrow()
  })

  test.each([
    'create table "a--b" (id int); select * from public.users;',
    'create table "a/*b" (id int); select * from public.users; create table "c*/d" (id int);',
    `create table "a'b" (id int); select * from public.users; create table "c'd" (id int);`,
    'create table "a""--b;𐐷" (id int); select * from public.users;',
  ])('rejects schema escapes following quoted identifier contents: %s', (sql) => {
    expect(() => validateModuleSql(sql)).toThrow('cross-schema reference public')
  })

  test('keeps quoted parentheses out of derived relation nesting', () => {
    expect(() =>
      validateModuleSql('select derived.id from (select id from "a)""(b") derived;'),
    ).not.toThrow()
  })

  test.each([
    ["select 'masked; grant all on records to public", 'string literal'],
    ['select $$masked; grant all on records to public', 'dollar-quoted literal'],
    ['select 1 /* masked; grant all on records to public', 'block comment'],
    ['select * from "records', 'quoted identifier'],
  ])('rejects an unterminated %s', (sql, kind) => {
    expect(() => validateModuleSql(sql)).toThrow(`Unterminated SQL ${kind}`)
  })

  test.each([
    ['core schema access', 'select * from public.users', 'cross-schema reference public'],
    [
      'another module schema',
      'insert into eve_module_beta.records default values',
      'cross-schema reference eve_module_beta',
    ],
    ['an arbitrary schema', 'drop table private.records', 'cross-schema reference private'],
    ['a quoted schema', 'select * from "public"."users"', 'cross-schema reference public'],
    [
      'a cross-schema reference inside a derived table',
      'select derived.id from (select id from public.records) derived',
      'cross-schema reference public',
    ],
    ['privilege changes', 'grant select on records to public', 'role, privilege'],
    ['ownership changes', 'alter table records owner to eve_space', 'role, privilege'],
    ['role changes', 'create role elevated', 'role, privilege'],
    ['setting a role', 'set local role eve_space', 'role or session authorization'],
    ['resetting a role', 'reset role', 'role or session authorization'],
    [
      'session authorization changes',
      'set session authorization eve_space',
      'role or session authorization',
    ],
    [
      'configuration-function role escapes',
      "select set_config('role', 'none', true)",
      'role or session authorization',
    ],
    ['extension management', 'create extension hstore', 'extension management'],
    ['schema creation', 'create schema escaped', 'deployment-wide operations'],
    ['procedural dynamic SQL', "do $$ begin execute 'reset role'; end $$", 'deployment-wide'],
    ['temporary objects', 'create temporary table escaped (id integer)', 'temporary object'],
    ['selecting into a temporary table', 'select 1 into temporary escaped', 'temporary object'],
    [
      'moving an object to another schema',
      'alter table records set schema public',
      'deployment-wide',
    ],
    [
      'moving an object to another tablespace',
      'alter table records set tablespace fast',
      'deployment-wide',
    ],
    ['an unknown statement', 'analyze records', 'unsupported SQL statement'],
  ])('rejects %s', (_description, sql, message) => {
    expect(() => validateModuleSql(sql)).toThrow(message)
  })
})

function validateModuleSql(sql: string) {
  assertModuleMigrationSql('alpha', 'eve_module_alpha', {
    name: 'alpha-001-test.sql',
    sql,
  })
}
