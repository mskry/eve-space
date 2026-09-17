import { describe, expect, test, vi } from 'vitest'
import {
  isCompleteShellNavigationOrder,
  resolveShellNavigationOrder,
} from '../../src/platform/module-navigation.js'
import {
  loadEnabledReviewerUseDisclosures,
  loadModuleRuntimeState,
  reconcileInstalledModules,
  reconcileInstalledModuleSections,
} from '../../src/platform/module-settings.js'
import { platformNavigationDefaults } from '../../src/generated/platform/installed-module-runtime.js'

describe('installed module reconciliation', () => {
  test('does nothing when no modules are installed', async () => {
    const connection = vi.fn()

    await expect(reconcileInstalledModules(connection as never, [])).resolves.toBeUndefined()
    expect(connection).not.toHaveBeenCalled()
  })

  test('inserts explicit defaults without updating existing rows', async () => {
    const connection = vi.fn((value) => {
      if (Array.isArray(value) && !('raw' in value)) return 'module-default-values'
      return Promise.resolve([])
    })

    await reconcileInstalledModules(connection as never, [
      { moduleId: 'alpha', defaultEnabled: false },
      { moduleId: 'beta', defaultEnabled: true },
    ])

    expect(connection).toHaveBeenNthCalledWith(
      1,
      [
        { module_id: 'alpha', enabled: false },
        { module_id: 'beta', enabled: true },
      ],
      'module_id',
      'enabled',
    )
    expect(connection).toHaveBeenCalledTimes(2)
  })
})

describe('installed module section reconciliation', () => {
  const definitions = [
    {
      moduleId: 'alpha',
      id: 'overview',
      kind: 'workspace' as const,
      defaultEnabled: false as const,
    },
    {
      moduleId: 'alpha',
      id: 'skills',
      kind: 'sensitive-evidence' as const,
      defaultEnabled: false as const,
      disclosureRevision: 2,
    },
  ]

  test('does nothing when no sections are installed', async () => {
    const connection = vi.fn()

    await expect(reconcileInstalledModuleSections(connection as never, [])).resolves.toBeUndefined()
    expect(connection).not.toHaveBeenCalled()
  })

  test('inserts every section disabled with disclosure policy metadata', async () => {
    const connection = vi.fn((value) => {
      if (Array.isArray(value) && !('raw' in value)) return 'section-default-values'
      return Promise.resolve([])
    })

    await reconcileInstalledModuleSections(connection as never, definitions)

    expect(connection).toHaveBeenNthCalledWith(
      1,
      [
        {
          module_id: 'alpha',
          section_id: 'overview',
          kind: 'workspace',
          enabled: false,
          declaration_revision: null,
        },
        {
          module_id: 'alpha',
          section_id: 'skills',
          kind: 'sensitive-evidence',
          enabled: false,
          declaration_revision: 2,
        },
      ],
      'module_id',
      'section_id',
      'kind',
      'enabled',
      'declaration_revision',
    )
    expect(connection).toHaveBeenCalledTimes(2)
  })

  test('applies module override while retaining independently enabled sections', async () => {
    const connection = vi.fn((strings: TemplateStringsArray) => {
      const query = strings.join(' ')
      if (query.includes('from deployment_modules'))
        return Promise.resolve([
          { module_id: 'alpha', enabled: false, updated_at: new Date('2026-09-16T00:00:00Z') },
        ])
      if (query.includes('from deployment_module_sections'))
        return Promise.resolve([
          {
            module_id: 'alpha',
            section_id: 'skills',
            kind: 'sensitive-evidence',
            enabled: true,
            declaration_revision: 2,
            disclosure_version: 1,
            activation_version: 1,
            updated_at: new Date('2026-09-16T00:00:00Z'),
          },
        ])
      return Promise.resolve([])
    })

    await expect(
      loadModuleRuntimeState(
        connection as never,
        [{ moduleId: 'alpha', defaultEnabled: false }],
        [],
        definitions,
      ),
    ).resolves.toMatchObject({ enabledModuleIds: [], enabledSections: [] })
  })

  test('loads an uncached canonical snapshot of enabled declared evidence sections', async () => {
    const connection = vi.fn(() =>
      Promise.resolve([
        { module_id: 'alpha', section_id: 'skills', disclosure_version: 4 },
        { module_id: 'removed', section_id: 'wallet', disclosure_version: 9 },
      ]),
    )

    await expect(
      loadEnabledReviewerUseDisclosures(connection as never, definitions),
    ).resolves.toEqual([{ moduleId: 'alpha', sectionId: 'skills', disclosureVersion: 4 }])
    expect(connection).toHaveBeenCalledOnce()
  })
})

describe('shell navigation order resolution', () => {
  const defaults = [
    { ownerId: 'core', navigationId: 'core-overview', placement: 'dashboard', order: 10 },
    { ownerId: 'core', navigationId: 'core-settings', placement: 'dashboard', order: 20 },
    { ownerId: 'alpha', navigationId: 'alpha-audit', placement: 'dashboard', order: 30 },
    { ownerId: 'alpha', navigationId: 'alpha-character', placement: 'character', order: 10 },
  ] as const

  test('orders saved available entries first and appends new defaults per placement', () => {
    expect(
      resolveShellNavigationOrder(
        defaults,
        [
          { owner_id: 'alpha', navigation_id: 'alpha-audit', position: 0 },
          { owner_id: 'core', navigation_id: 'core-settings', position: 1 },
          { owner_id: 'removed', navigation_id: 'removed-entry', position: 0 },
        ],
        new Set(['core', 'alpha']),
      ),
    ).toEqual({
      dashboard: [
        { ownerId: 'alpha', navigationId: 'alpha-audit' },
        { ownerId: 'core', navigationId: 'core-settings' },
        { ownerId: 'core', navigationId: 'core-overview' },
      ],
      character: [{ ownerId: 'alpha', navigationId: 'alpha-character' }],
    })
  })

  test('omits unavailable owners without losing deterministic core defaults', () => {
    expect(resolveShellNavigationOrder(defaults, [], new Set(['core']))).toEqual({
      dashboard: [
        { ownerId: 'core', navigationId: 'core-overview' },
        { ownerId: 'core', navigationId: 'core-settings' },
      ],
      character: [],
    })
  })

  test('filters section navigation without hiding unrelated enabled sections', () => {
    const sectionDefaults = [
      ...defaults,
      {
        ownerId: 'alpha',
        navigationId: 'alpha-skills',
        placement: 'dashboard' as const,
        order: 40,
        sectionId: 'skills',
      },
      {
        ownerId: 'alpha',
        navigationId: 'alpha-assets',
        placement: 'dashboard' as const,
        order: 50,
        sectionId: 'assets',
      },
    ]

    expect(
      resolveShellNavigationOrder(
        sectionDefaults,
        [],
        new Set(['core', 'alpha']),
        new Set(['alpha/skills']),
      ).dashboard.map(({ navigationId }) => navigationId),
    ).toEqual(['core-overview', 'core-settings', 'alpha-audit', 'alpha-skills'])
  })

  test('requires one current identity in its declared placement', () => {
    const complete = {
      dashboard: [
        { ownerId: 'core', navigationId: 'core-overview' },
        { ownerId: 'core', navigationId: 'core-settings' },
        { ownerId: 'alpha', navigationId: 'alpha-audit' },
      ],
      character: [{ ownerId: 'alpha', navigationId: 'alpha-character' }],
    }
    expect(isCompleteShellNavigationOrder(complete, defaults)).toBe(true)
    expect(
      isCompleteShellNavigationOrder(
        { ...complete, character: [{ ownerId: 'alpha', navigationId: 'alpha-audit' }] },
        defaults,
      ),
    ).toBe(false)
  })

  test('requires Clones in a complete generated character order', () => {
    const complete = {
      dashboard: platformNavigationDefaults
        .filter((entry) => entry.placement === 'dashboard')
        .map(({ ownerId, navigationId }) => ({ ownerId, navigationId })),
      character: platformNavigationDefaults
        .filter((entry) => entry.placement === 'character')
        .map(({ ownerId, navigationId }) => ({ ownerId, navigationId })),
    }

    expect(isCompleteShellNavigationOrder(complete, platformNavigationDefaults)).toBe(true)
    expect(
      isCompleteShellNavigationOrder(
        {
          ...complete,
          character: complete.character.filter(
            (entry) => entry.navigationId !== 'core-character-clones',
          ),
        },
        platformNavigationDefaults,
      ),
    ).toBe(false)
  })

  test('reconciles Assets in generated order and requires it in a complete order', () => {
    const resolved = resolveShellNavigationOrder(platformNavigationDefaults, [], new Set(['core']))
    const characterIds = resolved.character.map(({ navigationId }) => navigationId)
    const financeIndex = characterIds.indexOf('core-character-finance')

    expect(characterIds.slice(financeIndex, financeIndex + 4)).toEqual([
      'core-character-finance',
      'core-character-assets',
      'core-character-history',
      'core-character-mail',
    ])
    expect(isCompleteShellNavigationOrder(resolved, platformNavigationDefaults)).toBe(true)
    expect(
      isCompleteShellNavigationOrder(
        {
          ...resolved,
          character: resolved.character.filter(
            (entry) => entry.navigationId !== 'core-character-assets',
          ),
        },
        platformNavigationDefaults,
      ),
    ).toBe(false)
  })
})
