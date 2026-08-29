import { describe, expect, test, vi } from 'vitest'
import { loadInstalledModuleMigrationSets } from '../../src/db/module-migration-runner.js'
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
      schemaName: 'eve_module_member_audit',
      runtimeRoleName: 'eve_module_member_audit_runtime',
    })
    expect(modulePersistenceNames('a'.repeat(44)).runtimeRoleName).toHaveLength(63)
  })

  test('rejects module IDs that cannot produce safe identifiers', () => {
    expect(() => modulePersistenceNames('a'.repeat(45))).toThrow('Invalid module persistence owner')
  })
})
