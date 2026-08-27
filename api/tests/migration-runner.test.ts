import { describe, expect, test } from 'vitest'
import { assertTransactionalMigration, loadMigrations } from '../src/db/migration-runner.js'

describe('transactional migration validation', () => {
  test.each([
    '009_domain_events.sql',
    '010_domain_event_relay_safety.sql',
    '012_module_qualified_schema_migrations.sql',
    '013_module_persistence_security.sql',
    '014_module_schema_provisioning.sql',
    '015_deployment_module_settings.sql',
    '016_platform_collection_state.sql',
    '017_subject_lifecycles.sql',
    '020_oauth_state_return_path.sql',
  ])('keeps %s transactional', async (name) => {
    const migration = (await loadMigrations()).find((candidate) => candidate.name === name)
    expect(migration).toBeDefined()
    expect(() => assertTransactionalMigration(migration!)).not.toThrow()
  })

  test('rejects concurrent unique indexes with an actionable statement name', () => {
    expect(() =>
      assertTransactionalMigration({
        name: 'test.sql',
        sql: 'create unique index concurrently users_email_idx on users (email);',
      }),
    ).toThrow('CREATE UNIQUE INDEX CONCURRENTLY or DROP INDEX CONCURRENTLY')
  })

  test('ignores non-transactional keywords in comments and SQL literals', () => {
    expect(() =>
      assertTransactionalMigration({
        name: 'test.sql',
        sql: `
          -- vacuum;
          select 'create index concurrently ignored_idx on users (email)';
          do $$ begin raise notice 'rollback'; end $$;
        `,
      }),
    ).not.toThrow()
  })

  test.each([
    ['ALTER SYSTEM', "alter system set work_mem = '1GB'"],
    ['transaction control', 'rollback'],
    ['CREATE or DROP DATABASE', 'drop database example'],
    ['CREATE UNIQUE INDEX', 'create index concurrently users_idx on users (id)'],
    ['DROP INDEX', 'drop index concurrently users_idx'],
    ['TABLESPACE', "create tablespace example location '/tmp/example'"],
    ['SUBSCRIPTION', 'drop subscription example'],
    ['CLUSTER', 'cluster users'],
    ['REINDEX', 'reindex table concurrently users'],
    ['REFRESH', 'refresh materialized view concurrently example'],
    ['VACUUM', 'vacuum users'],
  ])('rejects executable %s statements', (_name, sql) => {
    expect(() => assertTransactionalMigration({ name: 'test.sql', sql })).toThrow(
      'cannot run in a transaction',
    )
  })

  test.each([
    '-- vacuum',
    '/* vacuum',
    "select 'vacuum",
    'select "vacuum',
    'do $tag$ vacuum',
    "select 'it''s vacuum'",
    'select $1',
  ])('handles unterminated or escaped non-executable SQL: %s', (sql) => {
    expect(() => assertTransactionalMigration({ name: 'test.sql', sql })).not.toThrow()
  })
})
