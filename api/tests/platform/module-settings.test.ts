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
      if (Array.isArray(value) && !('raw' in value)) {
        return 'module-default-values'
      }
      return Promise.resolve([])
    })

    await reconcileInstalledModules(connection as never, [
      { defaultEnabled: false, moduleId: 'alpha' },
      { defaultEnabled: true, moduleId: 'beta' },
    ])

    expect(connection).toHaveBeenNthCalledWith(
      1,
      [
        { enabled: false, module_id: 'alpha' },
        { enabled: true, module_id: 'beta' },
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
      defaultEnabled: false as const,
      id: 'overview',
      kind: 'workspace' as const,
      moduleId: 'alpha',
    },
    {
      defaultEnabled: false as const,
      disclosureRevision: 2,
      id: 'skills',
      kind: 'sensitive-evidence' as const,
      moduleId: 'alpha',
    },
  ]

  test('does nothing when no sections are installed', async () => {
    const connection = vi.fn()

    await expect(reconcileInstalledModuleSections(connection as never, [])).resolves.toBeUndefined()
    expect(connection).not.toHaveBeenCalled()
  })

  test('inserts every section disabled with disclosure policy metadata', async () => {
    const connection = vi.fn((value) => {
      if (Array.isArray(value) && !('raw' in value)) {
        return 'section-default-values'
      }
      return Promise.resolve([])
    })

    await reconcileInstalledModuleSections(connection as never, definitions)

    expect(connection).toHaveBeenNthCalledWith(
      1,
      [
        {
          declaration_revision: null,
          enabled: false,
          kind: 'workspace',
          module_id: 'alpha',
          section_id: 'overview',
        },
        {
          declaration_revision: 2,
          enabled: false,
          kind: 'sensitive-evidence',
          module_id: 'alpha',
          section_id: 'skills',
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
      if (query.includes('from deployment_modules')) {
        return Promise.resolve([
          { enabled: false, module_id: 'alpha', updated_at: new Date('2026-09-16T00:00:00Z') },
        ])
      }
      if (query.includes('from deployment_module_sections')) {
        return Promise.resolve([
          {
            activation_version: 1,
            declaration_revision: 2,
            disclosure_version: 1,
            enabled: true,
            kind: 'sensitive-evidence',
            module_id: 'alpha',
            section_id: 'skills',
            updated_at: new Date('2026-09-16T00:00:00Z'),
          },
        ])
      }
      return Promise.resolve([])
    })

    await expect(
      loadModuleRuntimeState(
        connection as never,
        [{ defaultEnabled: false, moduleId: 'alpha' }],
        [],
        definitions,
      ),
    ).resolves.toMatchObject({ enabledModuleIds: [], enabledSections: [] })
  })

  test('loads an uncached canonical snapshot of enabled declared evidence sections', async () => {
    const connection = vi.fn(() =>
      Promise.resolve([
        { disclosure_version: 4, module_id: 'alpha', section_id: 'skills' },
        { disclosure_version: 9, module_id: 'removed', section_id: 'wallet' },
      ]),
    )

    await expect(
      loadEnabledReviewerUseDisclosures(connection as never, definitions),
    ).resolves.toStrictEqual([{ disclosureVersion: 4, moduleId: 'alpha', sectionId: 'skills' }])
    expect(connection).toHaveBeenCalledOnce()
  })
})

describe('shell navigation order resolution', () => {
  const defaults = [
    { navigationId: 'core-overview', order: 10, ownerId: 'core', placement: 'dashboard' },
    { navigationId: 'core-settings', order: 20, ownerId: 'core', placement: 'dashboard' },
    { navigationId: 'alpha-audit', order: 30, ownerId: 'alpha', placement: 'dashboard' },
    { navigationId: 'alpha-character', order: 10, ownerId: 'alpha', placement: 'character' },
  ] as const

  test('orders saved available entries first and appends new defaults per placement', () => {
    expect(
      resolveShellNavigationOrder(
        defaults,
        [
          { navigation_id: 'alpha-audit', owner_id: 'alpha', position: 0 },
          { navigation_id: 'core-settings', owner_id: 'core', position: 1 },
          { navigation_id: 'removed-entry', owner_id: 'removed', position: 0 },
        ],
        new Set(['core', 'alpha']),
      ),
    ).toStrictEqual({
      character: [{ ownerId: 'alpha', navigationId: 'alpha-character' }],
      dashboard: [
        { ownerId: 'alpha', navigationId: 'alpha-audit' },
        { ownerId: 'core', navigationId: 'core-settings' },
        { ownerId: 'core', navigationId: 'core-overview' },
      ],
    })
  })

  test('omits unavailable owners without losing deterministic core defaults', () => {
    expect(resolveShellNavigationOrder(defaults, [], new Set(['core']))).toStrictEqual({
      character: [],
      dashboard: [
        { ownerId: 'core', navigationId: 'core-overview' },
        { ownerId: 'core', navigationId: 'core-settings' },
      ],
    })
  })

  test('filters section navigation without hiding unrelated enabled sections', () => {
    const sectionDefaults = [
      ...defaults,
      {
        navigationId: 'alpha-skills',
        order: 40,
        ownerId: 'alpha',
        placement: 'dashboard' as const,
        sectionId: 'skills',
      },
      {
        navigationId: 'alpha-assets',
        order: 50,
        ownerId: 'alpha',
        placement: 'dashboard' as const,
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
    ).toStrictEqual(['core-overview', 'core-settings', 'alpha-audit', 'alpha-skills'])
  })

  test('requires one current identity in its declared placement', () => {
    const complete = {
      character: [{ ownerId: 'alpha', navigationId: 'alpha-character' }],
      dashboard: [
        { ownerId: 'core', navigationId: 'core-overview' },
        { ownerId: 'core', navigationId: 'core-settings' },
        { ownerId: 'alpha', navigationId: 'alpha-audit' },
      ],
    }
    expect(isCompleteShellNavigationOrder(complete, defaults)).toBe(true)
    expect(
      isCompleteShellNavigationOrder(
        { ...complete, character: [{ navigationId: 'alpha-audit', ownerId: 'alpha' }] },
        defaults,
      ),
    ).toBe(false)
  })

  test('requires Clones in a complete generated character order', () => {
    const complete = {
      character: platformNavigationDefaults
        .filter((entry) => entry.placement === 'character')
        .map(({ ownerId, navigationId }) => ({ ownerId, navigationId })),
      dashboard: platformNavigationDefaults
        .filter((entry) => entry.placement === 'dashboard')
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

    expect(characterIds.slice(financeIndex, financeIndex + 4)).toStrictEqual([
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
