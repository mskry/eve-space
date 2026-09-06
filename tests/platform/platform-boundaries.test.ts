import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { platformImportViolations } from '../../scripts/platform/boundaries'
import { loadPlatformSources } from '../../scripts/platform/sources'

describe('platform module boundaries', () => {
  it.each([
    ['collection-state', 'representation', 'core-resources', 'declaration'],
    ['collection-state', 'representation', 'module-runtime-cache', 'state'],
    ['core-resources', 'declaration', 'module-settings', 'adapter'],
    ['module-runtime-cache', 'state', 'module-settings', 'adapter'],
    ['module-settings', 'adapter', 'collection-status', 'service'],
    ['collection-status', 'service', 'resource-refresh', 'application'],
    ['resource-refresh', 'application', 'collection-state-repair', 'entry'],
    ['collection-state-repair', 'entry', 'routes', 'transport'],
    ['routes', 'transport', 'collection-state-repair', 'entry'],
  ] as const)(
    'rejects %s (%s) importing %s (%s)',
    (sourceModule, sourceTier, importedModule, importedTier) => {
      expect(
        platformImportViolations([source(sourceModule, `import './${importedModule}.js'`)]),
      ).toEqual([
        `api/src/platform/${sourceModule}.ts: ${sourceTier} module ${sourceModule} cannot import ${importedTier} module ${importedModule}`,
      ])
    },
  )

  it('allows representative dependencies toward lower tiers', () => {
    expect(
      platformImportViolations([
        source('resource-batch-contract', "import './collection-state.js'"),
        source('core-resources', "import './resource-id-list.js'"),
        source('module-runtime-cache', "import './module-navigation.js'"),
        source('module-settings', "import './module-runtime-cache.js'"),
        source('collection-status', "import './module-settings.js'"),
        source('resource-refresh', "import './collection-status.js'"),
        source('collection-state-repair', "import './resource-eligibility.js'"),
        source('routes', "import './module-settings.js'"),
      ]),
    ).toEqual([])
  })

  it.each(['postgres', 'drizzle-orm', 'node:fs', '../db/client.js'])(
    'rejects representation importing runtime dependency %s',
    (specifier) => {
      expect(
        platformImportViolations([
          source('resource-identity', `import runtime from '${specifier}'`),
        ]),
      ).toEqual([
        `api/src/platform/resource-identity.ts: representation module resource-identity cannot import runtime dependency ${specifier}`,
      ])
    },
  )

  it('allows representation schema and contract dependencies', () => {
    expect(
      platformImportViolations([
        source('collection-state', "import { z } from 'zod'"),
        source(
          'resource-subject',
          "import type { PlatformResourceSubject } from '@eve-space/platform-module-contract'",
        ),
      ]),
    ).toEqual([])
  })

  it('rejects platform dependencies on queue delivery', () => {
    expect(
      platformImportViolations([
        source('resource-batch', "const registry = import('../queue/job-registry.js')"),
      ]),
    ).toEqual([
      'api/src/platform/resource-batch.ts: Platform module resource-batch cannot import queue module ../queue/job-registry.js',
    ])
  })

  it('rejects dependency cycles', () => {
    expect(
      platformImportViolations([
        source('collection-status', "import './resource-failures.js'"),
        source('resource-failures', "import './collection-status.js'"),
      ]),
    ).toEqual([
      'Platform dependency cycle: collection-status -> resource-failures -> collection-status',
    ])
  })

  it('requires new modules to declare their tier', () => {
    expect(platformImportViolations([source('new-module', '')])).toEqual([
      'api/src/platform/new-module.ts: Platform module new-module has no declared tier',
    ])
  })

  it('retains the relative path when checking nested modules', () => {
    expect(platformImportViolations([source('nested/new-module', '')])).toEqual([
      'api/src/platform/nested/new-module.ts: Platform module nested/new-module has no declared tier',
    ])
  })

  it('loads platform sources recursively', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eve-space-platform-sources-'))
    const nested = join(root, 'api', 'src', 'platform', 'nested')
    try {
      await mkdir(nested, { recursive: true })
      await writeFile(join(nested, 'example.ts'), 'export const example = true\n')

      await expect(loadPlatformSources(root)).resolves.toEqual([
        {
          path: join('api', 'src', 'platform', 'nested', 'example.ts'),
          source: 'export const example = true\n',
        },
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

function source(module: string, contents: string) {
  return { path: `api/src/platform/${module}.ts`, source: contents }
}
