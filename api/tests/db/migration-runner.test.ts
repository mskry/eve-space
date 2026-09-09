import { describe, expect, test } from 'vitest'
import { assertCoreMigrationHistory } from '../../src/db/migration-history.js'
import {
  activeCoreMigrationManifest,
  assertCoreMigrationContent,
  assertCoreMigrationInventory,
  assertCoreMigrationManifest,
  migrationSha256,
} from '../../src/db/migration-manifest.js'
import { loadMigrations } from '../../src/db/migration-runner.js'
import { assertTransactionalMigration } from '../../src/db/migration-validation.js'

describe('core migration manifest', () => {
  test('loads every reviewed migration in canonical order with matching content', async () => {
    const migrations = await loadMigrations()

    expect(migrations.map(({ name }) => name)).toEqual(
      activeCoreMigrationManifest.map(({ name }) => name),
    )
    expect(
      migrations.findIndex(({ name }) => name === '020_oauth_state_return_path.sql'),
    ).toBeLessThan(
      migrations.findIndex(({ name }) => name === '002_extract_platform_validation_functions.sql'),
    )
  })

  test('rejects missing, extra, changed, and non-tail inventory entries', () => {
    const names = activeCoreMigrationManifest.map(({ name }) => name)
    expect(() => assertCoreMigrationInventory(activeCoreMigrationManifest, names.slice(1))).toThrow(
      'missing file 001_initial.sql',
    )
    expect(() =>
      assertCoreMigrationInventory(activeCoreMigrationManifest, [...names, '043_extra.sql']),
    ).toThrow('absent from manifest: 043_extra.sql')
    expect(() =>
      assertCoreMigrationContent(activeCoreMigrationManifest[0]!, 'changed sql'),
    ).toThrow('content identity mismatch: 001_initial.sql')
    expect(() => assertCoreMigrationManifest(activeCoreMigrationManifest.slice(1))).toThrow(
      'preserve the reviewed canonical order',
    )
  })

  test('requires accepted additions to advance the frozen inventory', () => {
    expect(() =>
      assertCoreMigrationManifest([
        ...activeCoreMigrationManifest,
        { name: '042_next.sql', sha256: migrationSha256('select 1;') },
      ]),
    ).toThrow('match the accepted frozen inventory')
    expect(() =>
      assertCoreMigrationManifest([
        ...activeCoreMigrationManifest,
        { name: '041_reused.sql', sha256: migrationSha256('select 1;') },
      ]),
    ).toThrow('append a unique sequence after 41')
  })
})

describe('core migration history', () => {
  const firstTwo = activeCoreMigrationManifest.slice(0, 2)

  test('accepts an empty history and an interrupted current prefix with checksums', () => {
    expect(() => assertCoreMigrationHistory([], activeCoreMigrationManifest)).not.toThrow()
    expect(() =>
      assertCoreMigrationHistory(
        firstTwo.map(({ name, sha256 }) => ({ name, contentSha256: sha256 })),
        activeCoreMigrationManifest,
      ),
    ).not.toThrow()
  })

  test('rejects unknown and non-prefix histories before pending work', () => {
    expect(() =>
      assertCoreMigrationHistory(
        [{ name: '001_retired.sql', contentSha256: null }],
        activeCoreMigrationManifest,
      ),
    ).toThrow('unknown migration')
    expect(() =>
      assertCoreMigrationHistory(
        [{ name: firstTwo[1]!.name, contentSha256: null }],
        activeCoreMigrationManifest,
      ),
    ).toThrow('non-prefix migration')
  })

  test('requires exact content identities after checksum storage exists', () => {
    const rows = firstTwo.map(({ name, sha256 }) => ({ name, contentSha256: sha256 }))
    expect(() => assertCoreMigrationHistory(rows, activeCoreMigrationManifest)).not.toThrow()
    expect(() =>
      assertCoreMigrationHistory(
        [{ ...rows[0]!, contentSha256: null }],
        activeCoreMigrationManifest,
      ),
    ).toThrow('missing content identity')
    expect(() =>
      assertCoreMigrationHistory(
        [{ ...rows[0]!, contentSha256: migrationSha256('changed') }],
        activeCoreMigrationManifest,
      ),
    ).toThrow('content identity mismatch')
  })
})

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

  test('rejects unterminated SQL when strict validation is requested', () => {
    expect(() =>
      assertTransactionalMigration(
        { name: 'module.sql', sql: "select 'masked; commit;" },
        { rejectUnterminated: true },
      ),
    ).toThrow('Unterminated SQL string literal')
  })
})
