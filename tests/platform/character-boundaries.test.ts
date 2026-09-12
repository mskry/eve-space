import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  characterBoundaryViolations,
  characterModuleDeclarations,
  declaredCharacterModules,
  type CharacterModuleDeclaration,
} from '../../scripts/characters/boundaries'
import { loadCharacterSources } from '../../scripts/characters/sources'

const forbiddenTierImports = [
  ['finance-pagination', 'pure-leaf', 'assets', 'read-projection'],
  ['finance-pagination', 'pure-leaf', 'affiliation-sync', 'affiliation-use-case'],
  ['finance-pagination', 'pure-leaf', 'routes', 'route-adapter'],
  ['assets', 'read-projection', 'affiliation-sync', 'affiliation-use-case'],
  ['assets', 'read-projection', 'routes', 'route-adapter'],
  ['affiliation-sync', 'affiliation-use-case', 'routes', 'route-adapter'],
] as const

describe('character module boundaries', () => {
  it('declares the exact post-refactor module membership', () => {
    expect(declaredCharacterModules).toEqual([
      'affiliation-planning',
      'affiliation-sync',
      'assets',
      'assets-routes',
      'attributes',
      'clones',
      'clones-routes',
      'contracts',
      'core-routes',
      'corporation-roles',
      'finance-location-names',
      'finance-pagination',
      'finance-routes',
      'finance-type-names',
      'history',
      'history-routes',
      'market',
      'overview',
      'profile',
      'progression-routes',
      'public-routes',
      'resource-failure',
      'route-responses',
      'routes',
      'skill-catalogue',
      'skill-queue',
      'skills',
      'wallet',
    ])
  })

  it.each(forbiddenTierImports)(
    'rejects %s (%s) importing %s (%s)',
    (sourceModule, sourceTier, importedModule, importedTier) => {
      expect(
        characterBoundaryViolations(
          characterSources({ [sourceModule]: `import './${importedModule}.js'` }),
        ),
      ).toContain(
        `api/src/characters/${sourceModule}.ts: ${sourceTier} module ${sourceModule} cannot import ${importedTier} module ${importedModule}`,
      )
    },
  )

  it.each([
    ["export { characterRoutes } from './routes.js'", 'read-projection module assets'],
    ["const routes = import('./routes.js')", 'read-projection module assets'],
  ])('rejects reverse route imports expressed as %s', (contents, sourceDescription) => {
    expect(characterBoundaryViolations(characterSources({ assets: contents }))).toContain(
      `api/src/characters/assets.ts: ${sourceDescription} cannot import route-adapter module routes`,
    )
  })

  it('rejects Hono outside route adapters', () => {
    expect(
      characterBoundaryViolations(characterSources({ assets: "import { Hono } from 'hono'" })),
    ).toContain('api/src/characters/assets.ts: read-projection module assets cannot import Hono')
  })

  it.each([
    ["import { Queue } from 'bullmq'", 'Character module affiliation-sync cannot import BullMQ'],
    [
      "export { enqueue } from '../queue/bullmq-producer.js'",
      'Character module affiliation-sync cannot import queue module ../queue/bullmq-producer.js',
    ],
    [
      "const queue = import('../queue/job-handlers.js')",
      'Character module affiliation-sync cannot import queue module ../queue/job-handlers.js',
    ],
  ])('rejects queue ownership through %s', (contents, message) => {
    expect(
      characterBoundaryViolations(characterSources({ 'affiliation-sync': contents })),
    ).toContain(`api/src/characters/affiliation-sync.ts: ${message}`)
  })

  it.each([
    "import '../esi-gateway/internal/execution-runtime.js'",
    "export { transport } from '../esi-gateway/internal/transport.js'",
    "const runtime = import('../esi-gateway/internal/production-runtime.js')",
  ])('rejects ESI gateway internals through %s', (contents) => {
    expect(characterBoundaryViolations(characterSources({ assets: contents }))).toContain(
      'api/src/characters/assets.ts: Character module assets cannot import ESI gateway internals',
    )
  })

  it.each([
    '@evespace/esi-client',
    '@evespace/esi-client/domains/characters',
    '@evespace/esi-client/transport',
  ])('rejects ESI SDK client or transport surface %s', (specifier) => {
    expect(
      characterBoundaryViolations(
        characterSources({ assets: `import client from '${specifier}'` }),
      ),
    ).toContain(
      `api/src/characters/assets.ts: Character module assets cannot import ESI SDK runtime surface ${specifier}`,
    )
  })

  it.each(['@evespace/esi-client/operations', '@evespace/esi-client/types'])(
    'allows reviewed ESI SDK declaration surface %s',
    (specifier) => {
      expect(
        characterBoundaryViolations(
          characterSources({ assets: `import type {} from '${specifier}'` }),
        ),
      ).toEqual([])
    },
  )

  it.each([
    ['../alliances/public-data.js', 'skills'],
    ['../corporations/public-data.js', 'assets'],
    ['../universe/names.js', 'skills'],
  ])('rejects unapproved cross-subsystem read %s from %s', (specifier, module) => {
    expect(
      characterBoundaryViolations(characterSources({ [module]: `import '${specifier}'` })),
    ).toContain(
      `api/src/characters/${module}.ts: Character module ${module} cannot import unapproved cross-subsystem read ${specifier}`,
    )
  })

  it.each([
    ['profile', '../alliances/public-data.js'],
    ['profile', '../corporations/public-data.js'],
    ['assets', '../universe/static-locations.js'],
    ['clones', '../universe/implant-attributes.js'],
    ['finance-location-names', '../universe/names.js'],
    ['history', '../universe/names.js'],
    ['overview', '../universe/locations.js'],
  ])('allows reviewed cross-subsystem read from %s to %s', (module, specifier) => {
    expect(
      characterBoundaryViolations(characterSources({ [module]: `import '${specifier}'` })),
    ).toEqual([])
  })

  it('rejects unapproved external subsystem imports', () => {
    expect(
      characterBoundaryViolations(
        characterSources({ assets: "import '../organization/compliance.js'" }),
      ),
    ).toContain(
      'api/src/characters/assets.ts: read-projection module assets cannot import unapproved dependency ../organization/compliance.js',
    )
  })

  it('rejects dependency cycles', () => {
    expect(
      characterBoundaryViolations(
        characterSources({
          assets: "import './skills.js'",
          skills: "import './assets.js'",
        }),
      ),
    ).toContain('Character dependency cycle: assets -> skills -> assets')
  })

  it('rejects undeclared and missing modules', () => {
    expect(
      characterBoundaryViolations([...characterSources({}, ['skills']), source('new-reader', '')]),
    ).toEqual([
      'api/src/characters/new-reader.ts: Character module new-reader has no declared tier',
      'Declared character module skills has no source file',
    ])
  })

  it('rejects duplicate tier and source ownership', () => {
    const declarations: CharacterModuleDeclaration[] = [
      ...characterModuleDeclarations,
      { module: 'assets', tier: 'pure-leaf' },
    ]
    expect(
      characterBoundaryViolations([...characterSources(), source('skills', '')], declarations),
    ).toEqual([
      'Character module assets has duplicate tier declarations: read-projection, pure-leaf',
      'Character module skills has duplicate source ownership: api/src/characters/skills.ts, api/src/characters/skills.ts',
    ])
  })

  it('loads nested sources recursively so they cannot escape membership checks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eve-space-character-sources-'))
    const nested = join(root, 'api', 'src', 'characters', 'nested', 'deeper')
    try {
      await mkdir(nested, { recursive: true })
      await writeFile(join(nested, 'undeclared.ts'), 'export const undeclared = true\n')

      const sources = await loadCharacterSources(root)
      expect(sources).toEqual([
        {
          path: join('api', 'src', 'characters', 'nested', 'deeper', 'undeclared.ts'),
          source: 'export const undeclared = true\n',
        },
      ])
      expect(characterBoundaryViolations([...characterSources(), ...sources])).toContain(
        `${join('api', 'src', 'characters', 'nested', 'deeper', 'undeclared.ts')}: Character module nested/deeper/undeclared has no declared tier`,
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

function characterSources(
  contents: Readonly<Record<string, string>> = {},
  excludedModules: readonly string[] = [],
) {
  return characterModuleDeclarations
    .filter(({ module }) => !excludedModules.includes(module))
    .map(({ module }) => source(module, contents[module] ?? ''))
}

function source(module: string, contents: string) {
  return { path: `api/src/characters/${module}.ts`, source: contents }
}
