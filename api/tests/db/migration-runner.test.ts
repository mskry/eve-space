import { describe, expect, test } from 'vitest'
import { loadMigrations } from '../../src/db/migration-runner.js'
import { assertTransactionalMigration } from '../../src/db/migration-validation.js'

describe('transactional migration validation', () => {
  test('keeps every core migration transactional', async () => {
    const migrations = await loadMigrations()
    expect(migrations.length).toBeGreaterThan(0)
    for (const migration of migrations)
      expect(() => assertTransactionalMigration(migration)).not.toThrow()
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
