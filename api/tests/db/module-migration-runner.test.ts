import { describe, expect, test, vi } from 'vitest'
import { loadInstalledModuleMigrationSets } from '../../src/db/module-migration-runner.js'
import {
  assertModuleMigrationSql,
  ModuleMigrationValidationError,
} from '../../src/db/module-migration-validation.js'
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
  ])('accepts the upsert pseudo-relation in %s', async (value) => {
    await expect(
      validateModuleSql(`
      insert into records (id, value) values (1, 'new')
      on conflict (id) do update set value = ${value}
      where EXCLUDED.value <> records.value returning records.id;
      `),
    ).resolves.toBeUndefined()
  })

  test('supports upserts inside CTEs and conflict-clause comments', async () => {
    await expect(
      validateModuleSql(`
      with updated as (
        insert into records (id, value) values (1, 'new')
        on /* conflict */ conflict on constraint records_pkey
        do update set value = excluded.value returning id
      ) select updated.id from updated;
      `),
    ).resolves.toBeUndefined()
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
  ])('does not allow a schema or out-of-scope pseudo-relation: %s', async (sql) => {
    await expect(validateModuleSql(sql)).rejects.toMatchObject({ category: 'cross-schema' })
  })

  test('accepts schema-local DDL and data changes', async () => {
    await expect(
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
    ).resolves.toBeUndefined()
  })

  test.each([
    'create unlogged table records (id integer)',
    'create unique index records_id_idx on records (id)',
    'create sequence record_ids',
    "create type status as enum ('new', 'done')",
    'create type payload as (id integer)',
    'create type float_range as range (subtype = float8)',
    'create domain positive_id as bigint check (value > 0)',
    'create or replace view records_view as select id from records',
    'create materialized view records_materialized as select id from records',
    'create trigger records_changed after update on records for each row execute function mark_changed()',
    'create policy records_policy on records using (true)',
    'create table copied as select 1 as id',
    'alter table records add column value text',
    'alter index records_id_idx rename to records_key_idx',
    'alter sequence record_ids restart with 2',
    "alter type status add value 'archived'",
    'alter domain positive_id set not null',
    'alter view records_view rename to active_records_view',
    'alter materialized view records_materialized rename to records_snapshot',
    'alter trigger records_changed on records rename to records_updated',
    'alter policy records_policy on records using (id > 0)',
    'alter table records rename column old_name to new_name',
    'alter table records rename constraint old_key to new_key',
    'alter domain local_domain rename constraint old_check to new_check',
    'alter type local_type rename attribute old_name to new_name',
    'drop table records',
    'drop index records_id_idx',
    'drop sequence record_ids',
    'drop type status',
    'drop domain positive_id',
    'drop view records_view',
    'drop materialized view records_materialized',
    'drop trigger records_changed on records',
    'drop policy records_policy on records',
    'insert into records values (1)',
    'update records set id = 2',
    'delete from records',
    'truncate table records',
    'select * from records',
    'with selected as (select id from records) select selected.id from selected',
    "comment on table records is 'local'",
    "comment on constraint valid_value on domain local_domain is 'local'",
  ])('accepts the reviewed statement family: %s', async (sql) => {
    await expect(validateModuleSql(sql)).resolves.toBeUndefined()
  })

  test('compares quoted schema identifiers using PostgreSQL semantics', async () => {
    await expect(
      validateModuleSql('select * from EVE_MODULE_ALPHA.records'),
    ).resolves.toBeUndefined()
    await expect(
      validateModuleSql('select * from "eve_module_alpha".records'),
    ).resolves.toBeUndefined()
    await expect(
      validateModuleSql('select * from "EVE_MODULE_ALPHA".records'),
    ).rejects.toMatchObject({ category: 'cross-schema' })
  })

  test('accepts representative PostgreSQL 17 SQL/JSON syntax', async () => {
    await expect(
      validateModuleSql(`
        select jt.a
        from json_table('{"a":1}', '$' columns (a integer path '$.a')) as jt
      `),
    ).resolves.toBeUndefined()
  })

  test('ignores prohibited words in comments and literals', async () => {
    await expect(
      validateModuleSql(`
        -- grant all on public.users
        /* create extension hstore */
        select 'reset role; public.users';
      `),
    ).resolves.toBeUndefined()
  })

  test.each([
    'create table "a--b" (id int); select * from public.users;',
    'create table "a/*b" (id int); select * from public.users; create table "c*/d" (id int);',
    `create table "a'b" (id int); select * from public.users; create table "c'd" (id int);`,
    'create table "a""--b;𐐷" (id int); select * from public.users;',
  ])('rejects schema escapes following quoted identifier contents: %s', async (sql) => {
    await expect(validateModuleSql(sql)).rejects.toMatchObject({ category: 'cross-schema' })
  })

  test('keeps quoted parentheses out of derived relation nesting', async () => {
    await expect(
      validateModuleSql('select derived.id from (select id from "a)""(b") derived;'),
    ).resolves.toBeUndefined()
  })

  test.each([
    ["select 'masked; grant all on records to public", 'string literal'],
    ['select $$masked; grant all on records to public', 'dollar-quoted literal'],
    ['select 1 /* masked; grant all on records to public', 'block comment'],
    ['select * from "records', 'quoted identifier'],
  ])('rejects an unterminated %s', async (sql, _kind) => {
    await expect(validateModuleSql(sql)).rejects.toMatchObject({ category: 'parse' })
  })

  test.each([
    'update only public.users set value = 1',
    'delete from only public.users',
    'alter table only public.users add column escaped integer',
    'with changed as (update only public.users set value = 1 returning id) select * from changed',
    'create type public.payload as (id integer)',
    'alter type public.payload add attribute value text',
    'select 1 OPERATOR(public.+) 2',
    'select value from records order by value using OPERATOR(public.<)',
    'select * from records tablesample public.sample_method(1)',
    'create index records_idx on records (value public.int4_ops)',
    'create index records_idx on records (value collate public.external_collation)',
    'create table records (value integer) partition by range (value public.int4_ops)',
    'create table records (value integer, exclude using btree (value with OPERATOR(public.=)))',
    'create sequence local_sequence owned by public.users.id',
    'alter sequence local_sequence owned by public.users.id',
  ])('rejects a nested or unwrapped cross-schema reference: %s', async (sql) => {
    await expect(validateModuleSql(sql)).rejects.toMatchObject({ category: 'cross-schema' })
  })

  test.each([
    'select pg_advisory_lock(42)',
    'select pg_advisory_lock_shared(42)',
    'select pg_advisory_unlock(42)',
    'select pg_advisory_unlock_all()',
    'select pg_advisory_unlock_shared(42)',
    'select pg_advisory_xact_lock(42)',
    'select pg_advisory_xact_lock_shared(42)',
    'select pg_try_advisory_lock(42)',
    'select pg_try_advisory_lock_shared(42)',
    'select pg_try_advisory_xact_lock(42)',
    'select pg_try_advisory_xact_lock_shared(42)',
  ])('rejects advisory-lock function calls: %s', async (sql) => {
    await expect(validateModuleSql(sql)).rejects.toMatchObject({
      category: 'prohibited-operation',
    })
  })

  test.each([
    'select lo_create(0)',
    "select lo_from_bytea(0, decode('00', 'hex'))",
    "select lo_put(0, 0, decode('00', 'hex'))",
    'select lo_unlink(0)',
    'select lo_open(0, 131072)',
    'select lo_close(0)',
    'select loread(0, 1)',
    "select lowrite(0, decode('00', 'hex'))",
  ])('rejects large-object function calls: %s', async (sql) => {
    await expect(validateModuleSql(sql)).rejects.toMatchObject({
      category: 'prohibited-operation',
    })
  })

  test.each([
    ['core schema access', 'select * from public.users', 'cross-schema'],
    ['another module schema', 'insert into eve_module_beta.records default values', 'cross-schema'],
    ['an arbitrary schema', 'drop table private.records', 'cross-schema'],
    ['a quoted schema', 'select * from "public"."users"', 'cross-schema'],
    [
      'a cross-schema reference inside a derived table',
      'select derived.id from (select id from public.records) derived',
      'cross-schema',
    ],
    ['privilege changes', 'grant select on records to public', 'prohibited-operation'],
    ['ownership changes', 'alter table records owner to eve_space', 'prohibited-operation'],
    ['role changes', 'create role elevated', 'prohibited-operation'],
    ['setting a role', 'set local role eve_space', 'prohibited-operation'],
    ['resetting a role', 'reset role', 'prohibited-operation'],
    [
      'session authorization changes',
      'set session authorization eve_space',
      'prohibited-operation',
    ],
    [
      'configuration-function role escapes',
      "select set_config('role', 'none', true)",
      'prohibited-operation',
    ],
    ['extension management', 'create extension hstore', 'prohibited-operation'],
    ['schema creation', 'create schema escaped', 'prohibited-operation'],
    ['procedural dynamic SQL', "do $$ begin execute 'reset role'; end $$", 'prohibited-operation'],
    ['temporary objects', 'create temporary table escaped (id integer)', 'prohibited-operation'],
    ['selecting into a temporary table', 'select 1 into temporary escaped', 'prohibited-operation'],
    [
      'moving an object to another schema',
      'alter table records set schema public',
      'prohibited-operation',
    ],
    [
      'moving an object to another tablespace',
      'alter table records set tablespace fast',
      'prohibited-operation',
    ],
    ['analyze operations', 'analyze records', 'prohibited-operation'],
  ])('rejects %s', async (_description, sql, category) => {
    await expect(validateModuleSql(sql)).rejects.toMatchObject({ category })
  })

  test('reports a bounded attributable failure without including migration SQL', async () => {
    const sql = 'select * from public.secret_table'
    const failure = await validateModuleSql(sql).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ModuleMigrationValidationError)
    expect(failure).toMatchObject({
      moduleId: 'alpha',
      migrationName: 'alpha-001-test.sql',
      category: 'cross-schema',
    })
    expect(String(failure)).not.toContain(sql)
  })
})

async function validateModuleSql(sql: string) {
  await assertModuleMigrationSql('alpha', 'eve_module_alpha', {
    name: 'alpha-001-test.sql',
    sql,
  })
}
