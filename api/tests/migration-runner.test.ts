import { describe, expect, test } from 'vitest'
import { assertTransactionalMigration } from '../src/db/migration-runner.js'

describe('transactional migration validation', () => {
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
})
