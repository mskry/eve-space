import { describe, expect, test } from 'vitest'
import {
  authImportViolations,
  authModuleDeclarations,
  declaredAuthModules,
  type AuthModuleDeclaration,
} from '../../scripts/auth/boundaries.js'

describe('authentication module boundaries', () => {
  test('declares every focused authentication module', () => {
    expect(declaredAuthModules).toEqual([
      'character-lifecycle',
      'character-lock',
      'character-token-store',
      'character-transfer',
      'character-transfer-approvals',
      'character-transfer-store',
      'oauth-state-store',
      'routes',
      'security',
      'session-store',
      'sso',
      'sso-errors',
      'token-errors',
      'tokens',
    ])
  })

  test.each([
    ['sso-errors', 'policy', 'security', 'primitive'],
    ['security', 'primitive', 'session-store', 'persistence'],
    ['session-store', 'persistence', 'sso', 'provider'],
    ['sso', 'provider', 'tokens', 'application'],
    ['tokens', 'application', 'routes', 'transport'],
  ] as const)(
    'rejects %s (%s) importing %s (%s)',
    (sourceModule, sourceTier, importedModule, importedTier) => {
      expect(
        authImportViolations(authSources({ [sourceModule]: `import './${importedModule}.js'` })),
      ).toContain(
        `api/src/auth/${sourceModule}.ts: ${sourceTier} module ${sourceModule} cannot import ${importedTier} module ${importedModule}`,
      )
    },
  )

  test('keeps persistence dependencies within primitive and persistence tiers', () => {
    expect(
      authImportViolations(authSources({ 'session-store': "import './sso-errors.js'" })),
    ).toContain(
      'api/src/auth/session-store.ts: persistence module session-store cannot import policy module sso-errors',
    )
  })

  test.each([
    ['sso-errors', 'policy'],
    ['security', 'primitive'],
    ['session-store', 'persistence'],
    ['sso', 'provider'],
  ] as const)('rejects organization workflows from %s (%s)', (sourceModule, sourceTier) => {
    const violations = authImportViolations(
      authSources({
        [sourceModule]:
          "import { recomputeOrganizationAccountCompliance } from '../organization/compliance.js'",
      }),
    )
    expect(violations).toContain(
      sourceTier === 'persistence'
        ? `api/src/auth/${sourceModule}.ts: persistence module ${sourceModule} cannot import ../organization/compliance.js`
        : `api/src/auth/${sourceModule}.ts: ${sourceTier} module ${sourceModule} cannot import external dependency ../organization/compliance.js`,
    )
  })

  test.each([
    ['sso-errors', 'policy'],
    ['security', 'primitive'],
    ['session-store', 'persistence'],
    ['sso', 'provider'],
  ] as const)('rejects domain-event workflows from %s (%s)', (sourceModule, sourceTier) => {
    const violations = authImportViolations(
      authSources({
        [sourceModule]: "import { appendDomainEvent } from '../domain-events/store.js'",
      }),
    )
    expect(violations).toContain(
      sourceTier === 'persistence'
        ? `api/src/auth/${sourceModule}.ts: persistence module ${sourceModule} cannot import ../domain-events/store.js`
        : `api/src/auth/${sourceModule}.ts: ${sourceTier} module ${sourceModule} cannot import external dependency ../domain-events/store.js`,
    )
  })

  test('accepts representative dependencies at every tier', () => {
    expect(
      authImportViolations(
        authSources({
          security:
            "import { randomBytes } from 'node:crypto'\nimport { getSsoConfig } from '../env.js'",
          'character-lock':
            "import { sql } from 'drizzle-orm'\nimport type { DatabaseTransaction } from '../db/client.js'",
          sso: "import { jwtVerify } from 'jose'\nimport { z } from 'zod'\nimport { env } from '../env.js'\nimport './sso-errors.js'",
          'character-lifecycle':
            "import './security.js'\nimport './session-store.js'\nimport './sso.js'\nimport '../domain-events/store.js'\nimport '../organization/compliance.js'",
          routes: "import { Hono } from 'hono'\nimport './character-lifecycle.js'",
        }),
      ),
    ).toEqual([])
  })

  test('reports nested modules even when their basename duplicates a declaration', () => {
    expect(
      authImportViolations([
        ...authSources(),
        { path: 'api/src/auth/nested/security.ts', source: '' },
      ]),
    ).toContain('api/src/auth/nested/security.ts: Auth module nested/security has no declared tier')
  })

  test('reports duplicate source ownership', () => {
    expect(
      authImportViolations([
        ...authSources({}, ['security']),
        { path: 'api/src/auth/security.ts', source: '' },
        { path: 'api/src/auth/security.ts', source: '' },
      ]),
    ).toEqual([
      'Auth module security has duplicate source ownership: api/src/auth/security.ts, api/src/auth/security.ts',
    ])
  })

  test('reports source modules missing a declaration', () => {
    const declarations = authModuleDeclarations.filter(({ module }) => module !== 'security')
    expect(authImportViolations(authSources(), declarations)).toContain(
      'api/src/auth/security.ts: Auth module security has no declared tier',
    )
  })

  test('reports declarations missing a source', () => {
    expect(authImportViolations(authSources({}, ['security']))).toContain(
      'Declared auth module security has no source file',
    )
  })

  test('reports duplicate tier declarations without choosing an owner', () => {
    const declarations: AuthModuleDeclaration[] = [
      ...authModuleDeclarations,
      { module: 'security', tier: 'policy' },
    ]
    expect(authImportViolations(authSources(), declarations)).toContain(
      'Auth module security has duplicate tier declarations: primitive, policy',
    )
  })

  test('rejects dependency cycles between canonically resolved local imports', () => {
    expect(
      authImportViolations(
        authSources({
          'character-lifecycle': "import '../auth/tokens.js'",
          tokens: "import './character-lifecycle.js'",
        }),
      ),
    ).toContain(
      'Authentication dependency cycle: character-lifecycle -> tokens -> character-lifecycle',
    )
  })
})

function authSources(
  contents: Readonly<Record<string, string>> = {},
  excludedModules: readonly string[] = [],
) {
  return authModuleDeclarations
    .filter(({ module }) => !excludedModules.includes(module))
    .map(({ module }) => ({ path: `api/src/auth/${module}.ts`, source: contents[module] ?? '' }))
}
