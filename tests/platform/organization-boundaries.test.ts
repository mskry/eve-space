import { describe, expect, it } from 'vitest'
import { organizationImportViolations } from '../../scripts/organization/boundaries'

describe('organization module boundaries', () => {
  it.each([
    ['access-policy', 'policy', 'context', 'adapter'],
    ['access-policy', 'policy', 'audit', 'observability'],
    ['access-policy', 'policy', 'group-compliance', 'service'],
    ['access-policy', 'policy', 'compliance', 'application'],
    ['access-policy', 'policy', 'compliance-repair', 'entry'],
    ['access-policy', 'policy', 'routes', 'transport'],
    ['context', 'adapter', 'audit', 'observability'],
    ['context', 'adapter', 'group-compliance', 'service'],
    ['context', 'adapter', 'compliance', 'application'],
    ['audit', 'observability', 'context', 'adapter'],
    ['audit', 'observability', 'group-compliance', 'service'],
    ['group-compliance', 'service', 'compliance', 'application'],
    ['compliance', 'application', 'compliance-repair', 'entry'],
    ['compliance', 'application', 'routes', 'transport'],
    ['compliance-repair', 'entry', 'routes', 'transport'],
    ['routes', 'transport', 'compliance-repair', 'entry'],
  ] as const)(
    'rejects %s (%s) importing %s (%s)',
    (sourceModule, sourceTier, importedModule, importedTier) => {
      expect(
        organizationImportViolations([source(sourceModule, `import './${importedModule}.js'`)]),
      ).toEqual([
        `api/src/organization/${sourceModule}.ts: ${sourceTier} module ${sourceModule} cannot import ${importedTier} module ${importedModule}`,
      ])
    },
  )

  it('allows representative dependencies toward lower tiers', () => {
    expect(
      organizationImportViolations([
        source('compliance-evaluator', "import './access-policy.js'"),
        source('authority', "import './authority-policy.js'"),
        source('group-audit', "import './audit.js'"),
        source(
          'group-compliance',
          "import './group-assignment-store.js'\nimport './group-audit.js'",
        ),
        source('compliance', "import './group-compliance.js'"),
        source('compliance-repair', "import './compliance.js'"),
        source('routes', "import './group-store.js'"),
      ]),
    ).toEqual([])
  })

  it('keeps pure policy inside the organization policy boundary', () => {
    expect(
      organizationImportViolations([
        source('authority-policy', "import type { Roles } from '../characters/roles.js'"),
      ]),
    ).toEqual([
      'api/src/organization/authority-policy.ts: policy module authority-policy cannot import outside organization: ../characters/roles.js',
    ])
  })

  it.each(['postgres', 'drizzle-orm', 'node:fs'])(
    'rejects pure policy importing runtime package %s',
    (specifier) => {
      expect(
        organizationImportViolations([
          source('access-policy', `import runtime from '${specifier}'`),
        ]),
      ).toEqual([
        `api/src/organization/access-policy.ts: policy module access-policy cannot import outside organization: ${specifier}`,
      ])
    },
  )

  it('rejects dependency cycles within a tier', () => {
    expect(
      organizationImportViolations([
        source('compliance', "import './group-store.js'"),
        source('group-store', "import './compliance.js'"),
      ]),
    ).toEqual(['Organization dependency cycle: compliance -> group-store -> compliance'])
  })

  it('requires new modules to declare their tier', () => {
    expect(organizationImportViolations([source('new-module', '')])).toEqual([
      'api/src/organization/new-module.ts: Organization module new-module has no declared tier',
    ])
  })
})

function source(module: string, contents: string) {
  return { path: `api/src/organization/${module}.ts`, source: contents }
}
