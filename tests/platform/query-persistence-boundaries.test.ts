import { describe, expect, it } from 'vitest'
import {
  queryPersistenceConsumerImportViolations,
  queryPersistenceImportViolations,
  type QueryPersistenceSource,
} from '../../scripts/query-persistence/boundaries'

const modules = [
  'entry-state',
  'envelope',
  'notifications',
  'private-lifecycle',
  'runtime',
  'shape',
  'state',
  'storage',
] as const

describe('query persistence boundaries', () => {
  it('allows the declared dependency direction', () => {
    expect(
      queryPersistenceImportViolations(
        sources({
          'entry-state':
            "import type { EsiQueryPersistencePresentation } from '@eve-space/platform-module-nuxt/runtime'; import '../utils/esi-freshness'; import '../utils/query-error'; import './envelope'",
          envelope: "import './shape'",
          notifications: "import './envelope'; import './shape'",
          'private-lifecycle':
            "import '../queries/auth'; import './envelope'; import './notifications'; import './shape'; import './storage'",
          runtime:
            "import './entry-state'; import './envelope'; import './notifications'; import './private-lifecycle'; import './state'; import './storage'",
          state: "import './entry-state'; import './envelope'",
          storage: "import './envelope'; import './shape'",
        }),
      ),
    ).toStrictEqual([])
  })

  it.each(['storage', 'notifications'] as const)(
    'keeps the %s adapter independent of runtime state and orchestration',
    (module) => {
      for (const dependency of ['entry-state', 'private-lifecycle', 'runtime', 'state']) {
        const violations = queryPersistenceImportViolations(
          sources({ [module]: `import './${dependency}'` }),
        )
        expect(violations).toContain(
          `app/query-persistence/${module}.ts: query persistence module ${module} cannot import module ${dependency}`,
        )
      }
    },
  )

  it('keeps private lifecycle independent of runtime state and entry state', () => {
    for (const dependency of ['entry-state', 'runtime', 'state']) {
      expect(
        queryPersistenceImportViolations(
          sources({ 'private-lifecycle': `import './${dependency}'` }),
        ),
      ).toContain(
        `app/query-persistence/private-lifecycle.ts: query persistence module private-lifecycle cannot import module ${dependency}`,
      )
    }
  })

  it('keeps entry state limited to policy and declared presentation dependencies', () => {
    expect(
      queryPersistenceImportViolations(
        sources({ 'entry-state': "import type { QueryCache } from '@pinia/colada'" }),
      ),
    ).toContain(
      'app/query-persistence/entry-state.ts: query persistence module entry-state cannot import external dependency @pinia/colada',
    )
  })

  it('rejects undeclared modules and dependency cycles', () => {
    const sourceSet = [
      ...sources({ envelope: "import './runtime'", runtime: "import './envelope'" }),
      { path: 'app/query-persistence/facade.ts', source: '' },
    ]
    expect(queryPersistenceImportViolations(sourceSet)).toStrictEqual(
      expect.arrayContaining([
        'app/query-persistence/envelope.ts: query persistence module envelope cannot import module runtime',
        'app/query-persistence/facade.ts: Query persistence module facade is not declared',
        'Query persistence dependency cycle: envelope -> runtime -> envelope',
      ]),
    )
  })

  it('requires application callers to use the runtime seam', () => {
    expect(
      queryPersistenceConsumerImportViolations([
        {
          path: 'app/composables/useInternal.ts',
          source: "import { emptyEnvelope } from '../query-persistence/envelope'",
        },
        {
          path: 'app/plugins/query-persistence.client.ts',
          source: "import { installQueryPersistence } from '../query-persistence/runtime'",
        },
      ]),
    ).toStrictEqual([
      'app/composables/useInternal.ts: application caller cannot import query persistence module envelope',
    ])
  })
})

function sources(
  overrides: Partial<Record<(typeof modules)[number], string>> = {},
): QueryPersistenceSource[] {
  return modules.map((module) => ({
    path: `app/query-persistence/${module}.ts`,
    source: overrides[module] ?? '',
  }))
}
