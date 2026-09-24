import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertInstalledFeatureBoundaries,
  descriptorBoundaryViolations,
  featurePackageManifestViolations,
  manifestCompositionBoundaryViolations,
  nuxtSourceBoundaryViolations,
  serverFactoryBoundaryViolations,
  serverSourceBoundaryViolations,
} from '../../scripts/module-registry/feature-boundaries'
import { loadInstalledModuleManifests } from '../../scripts/module-registry/generator'
import { loadFeatureNuxtSources } from '../../scripts/module-registry/nuxt-boundaries'
import type { ResolvedInstalledModuleRelease } from '../../scripts/module-registry/resolved-release'
import { loadFeatureServerSources } from '../../scripts/module-registry/server-sources'
import {
  loadPlatformHostSources,
  platformFeatureImportViolations,
} from '../../scripts/module-registry/host-boundaries'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  )
})

describe('feature package dependency allowlists', () => {
  it('accepts only reviewed server dependencies and package-local exports', () => {
    expect(
      featurePackageManifestViolations('alpha', 'server', 'features/alpha/server/package.json', {
        ...packageManifest('alpha', 'server'),
        dependencies: {
          '@eve-space/platform-module-contract': 'workspace:*',
          '@eve-space/platform-module-server': 'workspace:*',
          hono: 'catalog:',
          zod: 'catalog:',
        },
        devDependencies: { typescript: 'catalog:', vitest: 'catalog:' },
      }),
    ).toStrictEqual([])
  })

  it('accepts only reviewed Nuxt dependencies and package-local exports', () => {
    expect(
      featurePackageManifestViolations('alpha', 'nuxt', 'features/alpha/nuxt/package.json', {
        ...packageManifest('alpha', 'nuxt'),
        dependencies: {
          '@eve-space/platform-module-contract': 'workspace:*',
          '@eve-space/platform-module-nuxt': 'workspace:*',
          '@nuxt/kit': 'catalog:',
          '@pinia/colada': 'catalog:',
          vue: 'catalog:',
        },
        devDependencies: { '@nuxt/test-utils': 'catalog:', nuxt: 'catalog:' },
      }),
    ).toStrictEqual([])
  })

  it('requires Nuxt packages to retain SFC style side effects', () => {
    const violations = featurePackageManifestViolations(
      'alpha',
      'nuxt',
      'features/alpha/nuxt/package.json',
      { ...packageManifest('alpha', 'nuxt'), sideEffects: false },
    )

    expect(violations).toContainEqual(expect.stringContaining('only Vue files as side-effectful'))
  })

  it('requires package roots to resolve to the verified canonical build entries', () => {
    const violations = featurePackageManifestViolations(
      'alpha',
      'server',
      'features/alpha/server/package.json',
      {
        ...packageManifest('alpha', 'server'),
        exports: {
          '.': { import: './dist/alternate.js', types: './dist/index.d.ts' },
          './migrations/*': './migrations/*',
        },
      },
    )

    expect(violations).toContainEqual(
      expect.stringContaining('feature package root export must use'),
    )
  })

  it.each([
    ['database', 'postgres'],
    ['Redis', 'ioredis'],
    ['queue', 'bullmq'],
    ['authentication', 'jose'],
    ['ESI', '@evespace/esi-client'],
    ['network', 'undici'],
    ['cross-feature', '@eve-space/bravo-server'],
  ])('rejects server %s dependencies', (_category, dependency) => {
    const violations = featurePackageManifestViolations(
      'alpha',
      'server',
      'features/alpha/server/package.json',
      {
        ...packageManifest('alpha', 'server'),
        dependencies: { [dependency]: 'catalog:' },
      },
    )

    expect(violations).toContainEqual(expect.stringContaining(`${dependency} is not allowed`))
  })

  it.each([
    ['server package', '@eve-space/alpha-server'],
    ['cross-feature', '@eve-space/bravo-nuxt'],
    ['direct behavior library', 'reka-ui'],
    ['database', 'drizzle-orm'],
    ['Redis', 'redis'],
    ['queue', 'bullmq'],
    ['authentication', 'jose'],
    ['ESI', '@evespace/esi-client'],
    ['network', 'axios'],
  ])('rejects Nuxt %s dependencies', (_category, dependency) => {
    const violations = featurePackageManifestViolations(
      'alpha',
      'nuxt',
      'features/alpha/nuxt/package.json',
      {
        ...packageManifest('alpha', 'nuxt'),
        peerDependencies: { [dependency]: 'catalog:' },
      },
    )

    expect(violations).toContainEqual(expect.stringContaining(`${dependency} is not allowed`))
  })

  it('rejects local dependency and package-export escapes', () => {
    const violations = featurePackageManifestViolations(
      'alpha',
      'nuxt',
      'features/alpha/nuxt/package.json',
      {
        ...packageManifest('alpha', 'nuxt'),
        dependencies: { vue: 'file:../../../../app' },
        exports: { '.': '../../../../app/index.ts' },
      },
    )

    expect(violations).toStrictEqual(
      expect.arrayContaining([
        expect.stringContaining('dependency vue must use catalog:'),
        expect.stringContaining('escapes the feature package root'),
      ]),
    )
  })

  it('validates external packed package dependencies and built artifacts', async () => {
    const valid = await createExternalPackageBoundaryFixture()
    temporaryRoots.push(valid.root)

    await expect(
      assertInstalledFeatureBoundaries(valid.root, [valid.release]),
    ).resolves.toBeUndefined()
    await expect(loadFeatureServerSources(valid.root, [valid.release])).resolves.toHaveLength(2)
    await expect(loadFeatureNuxtSources(valid.root, [valid.release])).resolves.toHaveLength(2)

    const invalid = await createExternalPackageBoundaryFixture({
      nuxtDependencies: {
        '@eve-space/bravo-nuxt': '^1.0.0',
        '@example/alpha-server': '^1.2.3',
      },
      nuxtSource:
        "import '@example/alpha-server'\nimport '@eve-space/bravo-nuxt'\nexport default {}\n",
      serverDependencies: {
        '@eve-space/bravo-server': '^1.0.0',
        postgres: '^3.4.0',
      },
      serverSource: "import 'postgres'\nimport '@eve-space/bravo-server'\n",
    })
    temporaryRoots.push(invalid.root)

    let message = ''
    try {
      await assertInstalledFeatureBoundaries(invalid.root, [invalid.release])
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    for (const fragment of [
      'dependency postgres is not allowed',
      'dependency @eve-space/bravo-server is not allowed',
      'import postgres is not allowed',
      'import @eve-space/bravo-server is not allowed',
      'dependency @example/alpha-server is not allowed',
      'dependency @eve-space/bravo-nuxt is not allowed',
      'import @example/alpha-server is not allowed',
      'import @eve-space/bravo-nuxt is not allowed',
    ]) {
      expect(message).toContain(fragment)
    }
  })
})

describe('feature source import allowlists', () => {
  it('accepts package-local and reviewed server imports', () => {
    expect(
      serverSourceBoundaryViolations(
        serverSource(`
          import type { PlatformModuleRouteCapabilities } from '@eve-space/platform-module-contract/server'
          import { Hono } from 'hono'
          export { localValue } from './local.js'
          export function alphaRoutes() {
            return new Hono().get('/', (context) => context.json({ ok: true }))
          }
        `),
      ),
    ).toStrictEqual([])
  })

  it('allows reviewer panels to import the focused public props contract', () => {
    expect(
      nuxtSourceBoundaryViolations(
        nuxtRuntimeSource(
          `<script setup lang="ts">
            import type { PlatformReviewerPanelProps } from '@eve-space/platform-module-nuxt/runtime/reviewer-panel'
            defineProps<PlatformReviewerPanelProps>()
          </script>
          <template><section>Review</section></template>`,
          'reviewer/OverviewPanel.vue',
        ),
      ),
    ).toStrictEqual([])
  })

  it.each([
    '@eve-space/api/auth/tokens',
    '@eve-space/core-data-contract',
    'postgres',
    'ioredis',
    'bullmq',
    'jose',
    '@evespace/esi-client/domains/status',
    'undici',
    '@eve-space/bravo-server',
    '@eve-space/bravo-nuxt',
  ])('rejects server import %s', (specifier) => {
    const violations = serverSourceBoundaryViolations(
      serverSource(`import { value } from '${specifier}'`),
    )

    expect(violations).not.toStrictEqual([])
  })

  it.each([
    '@eve-space/platform-module-contract/internal',
    '@eve-space/platform-module-contract/compiler',
    '@eve-space/platform-module-contract/installed',
    '@eve-space/platform-module-contract/manifest',
    '@eve-space/platform-module-contract/nuxt',
    '@eve-space/platform-module-server/persistence',
    'hono/client',
    'zod/v4/core',
  ])('rejects unreviewed server package subpath %s', (specifier) => {
    expect(serverSourceBoundaryViolations(serverSource(`import '${specifier}'`))).not.toStrictEqual(
      [],
    )
  })

  it('rejects TypeScript import-equals declarations before resolving their target', () => {
    expect(
      nuxtSourceBoundaryViolations(
        nuxtRuntimeSource(
          'import platformApi = require("../../../../../../../packages/platform-module-nuxt/src/runtime/platform-api")',
        ),
      ),
    ).toStrictEqual(
      expect.arrayContaining([
        expect.stringContaining('escapes the feature package root'),
        expect.stringContaining('import-equals declarations are not allowed'),
      ]),
    )
  })

  it.each([
    ['@eve-space/platform-module-server', 'bindPlatformPersistenceOperation'],
    ['@eve-space/platform-module-nuxt/runtime', 'createPlatformApiClient'],
  ])('rejects host-only %s export %s', (specifier, name) => {
    const source = `import { ${name} } from '${specifier}'`
    const violations = specifier.includes('-nuxt')
      ? nuxtSourceBoundaryViolations(nuxtRuntimeSource(source))
      : serverSourceBoundaryViolations(serverSource(source))
    expect(violations).toContainEqual(expect.stringContaining('host-only platform symbols'))
  })

  it.each([
    '../../../../api/src/platform/module-settings.js',
    '../../../../api/src/auth/character-disclosure-store.js',
    '../../../../api/src/organization/reviewer-target.js',
    '../../../../api/src/organization/reviewer-commands.js',
    '../../../../api/src/organization/sensitive-access-audit.js',
    '../../../../api/src/organization/group-store.js',
  ])('rejects protected core bypass import %s', (specifier) => {
    expect(
      serverSourceBoundaryViolations(serverSource(`import { bypass } from '${specifier}'`)),
    ).toContainEqual(expect.stringContaining('cannot import core API source'))
  })

  it.each([
    'process.getBuiltinModule("node:fs")',
    'eval("import(\\"postgres\\")")',
    'Function("return process")()',
    'require("postgres")',
    'module.require("postgres")',
    'new globalThis.WebSocket("wss://example.test")',
  ])('rejects server module-loader bypass %s', (expression) => {
    expect(
      serverSourceBoundaryViolations(serverSource(`export const bypass = ${expression}`)),
    ).not.toStrictEqual([])
  })

  it.each([
    '../../../../app/composables/useAuth.js',
    '../../../bravo/server/src/index.js',
    '..\\\\..\\\\..\\\\..\\\\secrets\\\\client.js',
  ])('rejects server package-root escape %s', (specifier) => {
    expect(
      serverSourceBoundaryViolations(serverSource(`export { value } from '${specifier}'`)),
    ).toContainEqual(expect.stringContaining('escapes the feature package root'))
  })

  it('rejects package-local runtime imports outside the scanned source tree', () => {
    expect(
      serverSourceBoundaryViolations(serverSource("import { start } from '../bootstrap.js'")),
    ).toContainEqual(expect.stringContaining('escapes the feature package root'))
  })

  it.each([
    '@eve-space/platform-module-contract',
    '@eve-space/platform-module-contract/compiler',
    '@eve-space/platform-module-contract/internal',
    '@eve-space/platform-module-contract/manifest',
    '@eve-space/platform-module-contract/resources',
    '@eve-space/platform-module-contract/server',
    'reka-ui',
    '@eve-space/alpha-server',
    '@eve-space/bravo-nuxt',
    'node:fs',
    'postgres',
    'ioredis',
    'bullmq',
    'jose',
    '@evespace/esi-client',
    'axios',
    '~/components/AppSecret.vue',
    '~~/app/queries/query-cache',
    '#components',
    '#app',
  ])('rejects Nuxt import %s', (specifier) => {
    const violations = nuxtSourceBoundaryViolations(
      nuxtRuntimeSource(`import { value } from '${specifier}'`),
    )

    expect(violations).not.toStrictEqual([])
  })

  it('allows only named reviewed #imports symbols', () => {
    expect(
      nuxtSourceBoundaryViolations(
        nuxtRuntimeSource("import { computed, useRoute } from '#imports'"),
      ),
    ).toStrictEqual([])
    expect(
      nuxtSourceBoundaryViolations(
        nuxtRuntimeSource("import { $fetch, useCharacterQuery } from '#imports'"),
      ),
    ).toContainEqual(expect.stringContaining('rejected $fetch, useCharacterQuery'))
  })

  it('restricts feature API access to the calling module route tree', () => {
    expect(
      nuxtSourceBoundaryViolations(
        nuxtRuntimeSource(`
          export function load() {
            const api = usePlatformApi()
            return api.api.modules.alpha.summary.$get()
          }
        `),
      ),
    ).toStrictEqual([])
    expect(
      nuxtSourceBoundaryViolations(
        nuxtRuntimeSource(`
          export function bypass() {
            const api = usePlatformApi()
            return api.api.organization.groups.$get()
          }
        `),
      ),
    ).toContainEqual(expect.stringContaining('must remain under api.modules["alpha"]'))
    expect(
      nuxtSourceBoundaryViolations(
        nuxtRuntimeSource(`
          export function leak() {
            const api = usePlatformApi()
            return api.api
          }
        `),
      ),
    ).toContainEqual(expect.stringContaining('must remain under api.modules["alpha"]'))
    expect(
      nuxtSourceBoundaryViolations(
        nuxtRuntimeSource(`
          export function alias() {
            const api = usePlatformApi()
            const bypass = api
            return bypass
          }
        `),
      ),
    ).toContainEqual(expect.stringContaining('must not be aliased or exposed'))
    expect(
      nuxtSourceBoundaryViolations(
        nuxtRuntimeSource(`
          export function destructure() {
            const { api } = usePlatformApi()
            return api.organization
          }
        `),
      ),
    ).toContainEqual(expect.stringContaining('must remain an opaque module-scoped client value'))
  })

  it.each([
    'const request = fetch',
    'new XMLHttpRequest()',
    'process.getBuiltinModule("node:http")',
    'eval("fetch(\\"/api/private\\")")',
    'Function("return fetch")()',
    'new globalThis.WebSocket("wss://example.test")',
    'navigator.sendBeacon("https://example.test", "private")',
  ])('rejects Nuxt client bypass %s', (statement) => {
    expect(nuxtSourceBoundaryViolations(nuxtRuntimeSource(statement))).not.toStrictEqual([])
  })

  it('extracts and checks both Vue script blocks', () => {
    const violations = nuxtSourceBoundaryViolations(
      nuxtRuntimeSource(
        `
        <script lang="ts">
        import { ref } from 'vue'
        </script>
        <script setup lang="ts">
        import { DialogRoot } from 'reka-ui'
        </script>
        <template><div></div></template>
      `,
        'FeaturePage.vue',
      ),
    )

    expect(violations).toContainEqual(expect.stringContaining('reka-ui'))
  })

  it('rejects raw feature network clients and Nitro registration', () => {
    expect(
      nuxtSourceBoundaryViolations(
        nuxtRuntimeSource('fetch("/api/private")\naddServerHandler({})'),
      ),
    ).toStrictEqual(
      expect.arrayContaining([
        expect.stringContaining('platform client surface'),
        expect.stringContaining('must not call addServerHandler'),
      ]),
    )
  })

  it('rejects direct SDE datasets and alternate product sources or caches', () => {
    const violations = serverSourceBoundaryViolations(
      serverSource(`
        export function lookup() {
          return persistence.query('select * from sde_types')
        }
      `),
    )

    expect(violations).toStrictEqual(
      expect.arrayContaining([
        expect.stringContaining('must not reference unrestricted SDE datasets'),
        expect.stringContaining('instead of alternate adapters or caches'),
      ]),
    )
  })

  it('rejects renamed module-level caches wrapped around core-data products', () => {
    expect(
      serverSourceBoundaryViolations(
        serverSource(`
          const memo = new Map<number, unknown>()
          const groupsByType: Record<number, unknown> = {}
          export async function enrich(capabilities, typeId: number) {
            const cached = memo.get(typeId) ?? groupsByType[typeId]
            if (cached) return cached
            const result = await capabilities.coreData.publishedTypeGroups({ typeIds: [typeId] })
            memo.set(typeId, result)
            groupsByType[typeId] = result
            return result
          }
        `),
      ),
    ).toContainEqual(expect.stringContaining('instead of alternate adapters or caches'))
  })

  it('does not classify unrelated module state or const assertions as core-data caches', () => {
    expect(
      serverSourceBoundaryViolations(
        serverSource(`
          let requestCount = 0
          const immutable = { kinds: ['project'] } as const
          const deferred = { run() { requestCount += immutable.kinds.length } }
          export function run() { return deferred.run() }
        `),
      ),
    ).toStrictEqual([])
  })

  it('allows transient function-local collections', () => {
    expect(
      serverSourceBoundaryViolations(
        serverSource(`
          export function groupRows(rows: readonly { id: number }[]) {
            const groupsByType = new Map<number, { id: number }>()
            for (const row of rows) groupsByType.set(row.id, row)
            return [...groupsByType.values()]
          }
        `),
      ),
    ).toStrictEqual([])
  })

  it('ignores commented-out Vue scripts', () => {
    expect(
      nuxtSourceBoundaryViolations(
        nuxtRuntimeSource(
          `<!-- <script setup>import { secret } from 'node:fs'</script> -->
          <template><div></div></template>`,
          'FeaturePage.vue',
        ),
      ),
    ).toStrictEqual([])
  })

  it('parses Vue script attributes and TSX with the compiler grammar', () => {
    expect(
      nuxtSourceBoundaryViolations(
        nuxtRuntimeSource(
          `<script setup lang="tsx" data-label=">">
          import { ref } from 'vue'
          const content = <div>{ref('alpha').value}</div>
          </script>`,
          'FeaturePage.vue',
        ),
      ),
    ).toStrictEqual([])
  })

  it.each([
    '<script setup>const value = 1',
    '<script>const a = 1</script><script>const b = 2</script>',
    '<script src="../../../../../../app/private.js"></script><template><div></div></template>',
    '<script lang="coffee">value = 1</script>',
  ])('rejects Vue scripts that cannot be fully checked: %s', (source) => {
    expect(
      nuxtSourceBoundaryViolations(nuxtRuntimeSource(source, 'FeaturePage.vue')),
    ).not.toStrictEqual([])
  })
})

describe('descriptor and composition purity', () => {
  it.each([
    ['export default buildManifest(); export default {}', []],
    [
      'export default {}; export default buildManifest()',
      ['module descriptor must be a static serializable object'],
    ],
  ])(
    'validates the last default export after collecting ordered diagnostics: %s',
    (exports, finalErrors) => {
      const path = 'features/alpha/module.config.ts'
      expect(
        descriptorBoundaryViolations({
          moduleId: 'alpha',
          path,
          source: `
          import 'unapproved'
          let mutable = {}
          const { invalid } = {}, valid = {}
          ${exports}
        `,
        }),
      ).toStrictEqual(
        [
          'module descriptor may only type-import @eve-space/platform-module-contract/manifest',
          'module descriptor declarations must be const',
          'module descriptor declarations must be initialized names',
          'module descriptor must have one default export',
          ...finalErrors,
        ].map((message) => `${path}: ${message}`),
      )
    },
  )

  it('reports every eager initializer in source order while allowing deferred methods', () => {
    const source = serverSource(`
      const first = connect(), second = connect()
      const deferred = { run() { connect() } }
      export default connect()
      connect()
    `)
    expect(serverSourceBoundaryViolations(source)).toStrictEqual(
      [
        'feature package entry or definition first has an executable initializer',
        'feature package entry or definition second has an executable initializer',
        'feature package default export has an executable initializer',
        'feature package entry contains executable top-level code',
      ].map((message) => `${source.path}: ${message}`),
    )
  })

  it('allows declarative persistence operation definitions', () => {
    const source = serverSource(`
      import { definePlatformPersistenceOperation } from '@eve-space/platform-module-server'
      import { z } from 'zod'
      export const readSnapshot = definePlatformPersistenceOperation({
        id: 'read-snapshot', method: 'readSnapshot', revision: 1, mode: 'read',
        inputSchema: z.object({ id: z.string().max(100) }),
        outputSchema: z.object({ value: z.string().max(100).nullable() }),
        maximumInputBytes: 1024, maximumOutputBytes: 4096,
      })
    `)

    expect(serverSourceBoundaryViolations(source)).toStrictEqual([])
  })

  it('rejects runtime SQL and generic persistence dispatch while allowing named methods', () => {
    const source = serverSource(`
      export async function load(capabilities) {
        const persistence = capabilities.persistence
        await persistence.readSnapshot({ id: 'alpha' })
        await persistence.execute('read-snapshot', { id: 'alpha' })
        return 'select value from module_records'
      }
    `)

    expect(serverSourceBoundaryViolations(source)).toStrictEqual(
      [
        'feature server code must not contain runtime SQL statements',
        'feature server code must not use generic persistence dispatch',
      ].map((message) => `${source.path}: ${message}`),
    )
  })

  it('requires exact persistence definition exports at the package root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eve-space-persistence-definitions-'))
    temporaryRoots.push(root)
    const sourceRoot = join(root, 'features/alpha/server/src')
    await mkdir(sourceRoot, { recursive: true })
    await writeFile(
      join(sourceRoot, 'persistence.ts'),
      `
        import { definePlatformPersistenceOperation } from '@eve-space/platform-module-server'
        import { z } from 'zod'
        export const alphaReadOperation = definePlatformPersistenceOperation({
          id: 'alpha-read', method: 'alphaRead', revision: 1, mode: 'read',
          inputSchema: z.object({ id: z.string().max(100) }),
          outputSchema: z.object({ value: z.string().max(100).nullable() }),
          maximumInputBytes: 1024, maximumOutputBytes: 4096,
        })
        export const unusedOperation = definePlatformPersistenceOperation({
          id: 'unused', method: 'unused', revision: 1, mode: 'read',
          inputSchema: z.object({}), outputSchema: z.object({}),
          maximumInputBytes: 1024, maximumOutputBytes: 1024,
        })
      `,
      'utf8',
    )
    await writeFile(join(sourceRoot, 'index.ts'), "export * from './persistence.js'\n", 'utf8')

    const violations = await manifestCompositionBoundaryViolations(
      root,
      persistenceManifest('alphaReadOperation'),
    )
    expect(violations).toContain(
      'features/alpha/server/src/persistence.ts: persistence definition export unusedOperation is not declared by module alpha',
    )

    const missing = await manifestCompositionBoundaryViolations(
      root,
      persistenceManifest('missingOperation'),
    )
    expect(missing).toContain(
      'features/alpha/server: persistence definition export missingOperation must resolve to one local declaration',
    )
  })

  it('requires resource and ESI definitions to be exported from the package root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eve-space-definition-exports-'))
    temporaryRoots.push(root)
    const sourceRoot = join(root, 'features/alpha/server/src')
    await mkdir(sourceRoot, { recursive: true })
    await writeFile(
      join(sourceRoot, 'definitions.ts'),
      'export const alphaResource = {}; export const alphaOperation = {}',
      'utf8',
    )
    await writeFile(
      join(sourceRoot, 'alternate.ts'),
      'export const alternateResource = {}; export const alternateOperation = {}',
      'utf8',
    )
    await writeFile(
      join(sourceRoot, 'index.ts'),
      'export { alternateResource as alphaResource, alternateOperation as alphaOperation } from "./alternate.js"',
      'utf8',
    )
    const declaration = persistenceManifest('unused') as unknown as {
      server: {
        routes: unknown[]
        persistenceOperations: unknown[]
        resources: unknown[]
        esiOperations: unknown[]
        activityProviders: unknown[]
      }
    }
    declaration.server.persistenceOperations = []
    declaration.server.resources = [{ exportName: 'alphaResource' }]
    declaration.server.esiOperations = [{ exportName: 'alphaOperation' }]

    const violations = await manifestCompositionBoundaryViolations(root, declaration as never)
    expect(violations).toStrictEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'definition export alphaResource must be exported from the package root',
        ),
        expect.stringContaining(
          'definition export alphaOperation must be exported from the package root',
        ),
      ]),
    )
  })

  it('accepts a static serializable descriptor with a type-only contract import', () => {
    expect(
      descriptorBoundaryViolations({
        moduleId: 'alpha',
        path: 'features/alpha/module.config.ts',
        source: `
          import type { PlatformModuleManifest } from '@eve-space/platform-module-contract/manifest'
          const manifest = {
            id: 'alpha', icon: 'character', defaultEnabled: false,
            release: { publisherPackage: '@eve-space/alpha-manifest', version: '0.1.0', hostContractRange: '^1.0.0' },
            server: { package: '@eve-space/alpha-server', routes: [], migrations: [], persistenceOperations: [], resources: [], esiOperations: [], activityProviders: [] },
            nuxt: { package: '@eve-space/alpha-nuxt', pages: [], navigation: [] },
          } satisfies PlatformModuleManifest
          export default manifest
        `,
      }),
    ).toStrictEqual([])
  })

  it.each([
    ["import '@eve-space/platform-module-contract'\nexport default {}", 'type-import'],
    ["fetch('https://example.test')\nexport default {}", 'top-level fetch'],
    ["export default { defaultEnabled: process.env.ALPHA === '1' }", 'environment'],
    ['export default buildManifest()', 'factory call'],
    ['export default { ...baseManifest }', 'spread'],
  ])('rejects descriptor %s', (source, _case) => {
    expect(
      descriptorBoundaryViolations({
        moduleId: 'alpha',
        path: 'features/alpha/module.config.ts',
        source,
      }),
    ).not.toStrictEqual([])
  })

  it.each([
    ['connection', 'connect()'],
    ['fetch', "fetch('https://example.test')"],
    ['timer', 'setInterval(() => {}, 1000)'],
    ['background loop', 'queueMicrotask(run)'],
    ['environment', 'const enabled = process.env.ALPHA'],
    ['runtime client', "const socket = new WebSocket('wss://example.test')"],
  ])('rejects server entry %s work', (_category, statement) => {
    expect(serverSourceBoundaryViolations(serverSource(statement))).not.toStrictEqual([])
  })

  it.each([
    'const request = fetch; await request(url)',
    'const request = fetch; const send = request; await send(url)',
    'let request; request = fetch; await request(url)',
    'const request = (fetch as typeof fetch); await request(url)',
    'const client = { request: fetch }; await client.request(url)',
    'const client = { fetch }; await client.fetch(url)',
    'await execute(fetch, url)',
    'const request = globalThis.fetch; await request(url)',
    'const request = globalThis["fetch"]; await request(url)',
    'const { fetch: request } = globalThis; await request(url)',
    'const globals = globalThis; const { fetch: request } = globals; await request(url)',
    'const globals = globalThis; const request = globals.fetch; await request(url)',
    'const request = fetch.bind(globalThis); await request(url)',
    'const schedule = setTimeout; schedule(work, 1)',
    'const schedule = setInterval; schedule(work, 1)',
    'const schedule = setImmediate; schedule(work)',
    'const schedule = queueMicrotask; schedule(work)',
  ])('rejects captured server globals: %s', (statement) => {
    expect(
      serverSourceBoundaryViolations(
        serverSource(`
      export async function run(url, work) { ${statement} }
    `),
      ),
    ).toContainEqual(expect.stringContaining('must not reference'))
  })

  it.each([
    'const fetch = async () => {}; const request = fetch; await request(url)',
    'const client = { fetch: async () => {} }; await client.fetch(url)',
    'const fetch = async () => {}; const client = { fetch }; await client.fetch(url)',
    'const globalThis = { fetch: async () => {} }; const request = globalThis.fetch; await request(url)',
    'const fetch = async () => {}; const { fetch: request } = { fetch }; await request(url)',
    'type Request = typeof fetch',
    'const left = right; const right = left; left.fetch(url)',
  ])('allows local server references: %s', (statement) => {
    expect(
      serverSourceBoundaryViolations(
        serverSource(`
      export async function run(url) { ${statement} }
    `),
      ),
    ).toStrictEqual([])
  })

  it('resolves forbidden globals independently of nested shadowing', () => {
    expect(
      serverSourceBoundaryViolations(
        serverSource(`
      export async function run(url) {
        function local(fetch) { return fetch(url) }
        const request = fetch
        await request(url)
      }
    `),
      ),
    ).toContainEqual(expect.stringContaining('must not reference fetch'))
  })

  it('allows deferred route and provider work but rejects factory-time work', () => {
    const cleanSources = [
      serverSource(`
        import { Hono } from 'hono'
        import { zValidator } from '@hono/zod-validator'
          import { z } from 'zod'
          export function alphaRoutes(capabilities) {
            return new Hono().get('/', zValidator('query', z.object({ view: z.string() })), async (context) => {
            await capabilities.persistence.readSnapshot({ id: 'alpha' })
            return context.json({ ok: true })
          })
        }
        export function alphaProvider(capabilities) {
          return async () => {
            await capabilities.persistence.readSnapshot({ id: 'alpha' })
            return { activities: [], freshness: { state: 'current', collectedAt: null } }
          }
        }
      `),
    ]
    expect(serverFactoryBoundaryViolations(cleanSources, 'alphaRoutes', 'route')).toStrictEqual([])
    expect(
      serverFactoryBoundaryViolations(cleanSources, 'alphaProvider', 'provider'),
    ).toStrictEqual([])

    const eager = [
      serverSource(`
        export function alphaRoutes(capabilities) {
          capabilities.persistence.readSnapshot({ id: 'alpha' })
          return {}
        }
        export function alphaProvider() {
          setTimeout(() => {}, 1)
          return async () => ({ activities: [], freshness: { state: 'current', collectedAt: null } })
        }
      `),
    ]
    expect(serverFactoryBoundaryViolations(eager, 'alphaRoutes', 'route')).not.toStrictEqual([])
    expect(serverFactoryBoundaryViolations(eager, 'alphaProvider', 'provider')).not.toStrictEqual(
      [],
    )
  })

  it('rejects spoofed route-composition method receivers', () => {
    const sources = [
      serverSource(`
        import { Hono } from 'hono'
        export function alphaRoutes(capabilities) {
          const facade = { get() { return capabilities.persistence.readSnapshot({ id: 'alpha' }) } }
          facade.get()
          return new Hono().get('/', () => new Response())
        }
      `),
    ]

    expect(serverFactoryBoundaryViolations(sources, 'alphaRoutes', 'route')).toContainEqual(
      expect.stringContaining('must not perform work during composition'),
    )
  })

  it('rejects a shadowed Hono constructor and a decoy package export', () => {
    const shadowed = [
      serverSource(`
        import { Hono as RealHono } from 'hono'
        class Hono extends RealHono { constructor(capabilities) { super(); capabilities.run() } }
        export function alphaRoutes(capabilities) { return new Hono(capabilities).get('/', () => new Response()) }
      `),
    ]
    const decoy = [
      {
        ...serverSource('export function alphaRoutes() { return new Hono() }'),
        path: 'features/alpha/server/src/routes.ts',
      },
      serverSource('export { evilRoutes as alphaRoutes } from "./evil.js"'),
      {
        ...serverSource('export function evilRoutes() { connect(); return {} }'),
        path: 'features/alpha/server/src/evil.ts',
      },
    ]

    expect(serverFactoryBoundaryViolations(shadowed, 'alphaRoutes', 'route')).not.toStrictEqual([])
    expect(serverFactoryBoundaryViolations(decoy, 'alphaRoutes', 'route')).toContainEqual(
      expect.stringContaining('must be exported from the package root'),
    )
  })

  it('requires feature Nuxt runtime contributions to use generated registries', () => {
    expect(
      nuxtSourceBoundaryViolations(
        nuxtModuleSource(`
          import { defineNuxtModule } from '@nuxt/kit'
          export default defineNuxtModule({})
        `),
      ),
    ).toStrictEqual([])

    for (const setup of [
      'extendPages(() => {})',
      'addPlugin("./runtime/plugin")',
      'addRouteMiddleware({ name: "bypass", path: "./middleware" })',
      'addComponentsDir({ path: "./runtime/components" })',
    ]) {
      expect(
        nuxtSourceBoundaryViolations(
          nuxtModuleSource(`
            import { defineNuxtModule } from '@nuxt/kit'
            export default defineNuxtModule({ setup() { ${setup} } })
          `),
        ),
      ).toContainEqual(expect.stringContaining('must not define setup'))
    }
  })

  it('rejects Nuxt deployment hooks and indirect module entries', () => {
    expect(
      nuxtSourceBoundaryViolations(
        nuxtModuleSource(`
          import { defineNuxtModule } from '@nuxt/kit'
          const feature = defineNuxtModule({ onInstall() {} })
          export default feature
        `),
      ),
    ).not.toStrictEqual([])
  })

  it('rejects an executable descriptor before registry generation imports it', async () => {
    const root = await createUnsafeInstalledFixture()
    temporaryRoots.push(root)
    delete globalThis.unsafeDescriptorImported

    await expect(loadInstalledModuleManifests(root)).rejects.toThrow(
      'must be a module package-export record',
    )
    expect(globalThis.unsafeDescriptorImported).toBeUndefined()
  })
})

describe('host feature package composition', () => {
  it('allows feature packages only through generated registries', () => {
    expect(
      platformFeatureImportViolations([
        {
          path: 'api/src/generated/platform/installed-module-routes.ts',
          source: "import { routes } from '@eve-space/alpha-server'",
        },
        {
          path: 'generated/platform/installed-nuxt-modules.ts',
          source: "import alpha from '@eve-space/alpha-nuxt'",
        },
      ]),
    ).toStrictEqual([])
  })

  it('rejects fabricated generated registry entry points and normalized path escapes', () => {
    const violations = platformFeatureImportViolations([
      {
        path: 'api/src/generated/platform/installed-module-backdoor.ts',
        source: "import { routes } from '@eve-space/alpha-server'",
      },
      {
        path: 'api/src/index.ts',
        source: "import routes from '../features/ignored/../alpha/server/src/index.js'",
      },
    ])

    expect(violations).toHaveLength(2)
    expect(violations[0]).toContain('installed-module-backdoor.ts')
    expect(violations[1]).toContain('api/src/index.ts')
  })

  it('detects import-equals bypasses and loads Nitro server sources', async () => {
    expect(
      platformFeatureImportViolations([
        {
          path: 'api/src/index.ts',
          source: "import alpha = require('@eve-space/alpha-server')",
        },
      ]),
    ).toHaveLength(1)

    const root = await mkdtemp(join(tmpdir(), 'eve-space-host-sources-'))
    temporaryRoots.push(root)
    await mkdir(join(root, 'server', 'routes'), { recursive: true })
    await writeFile(
      join(root, 'server', 'routes', 'bypass.get.ts'),
      "import alpha from '@eve-space/alpha-server'",
      'utf8',
    )
    const sources = await loadPlatformHostSources(root)

    expect(platformFeatureImportViolations(sources)).toHaveLength(1)
  })

  it.each([
    ['api/src/index.ts', '@eve-space/alpha-server'],
    ['api/src/platform/routes.ts', '../../../features/alpha/server/src/index.js'],
    ['nuxt.config.ts', '@eve-space/alpha-nuxt'],
    ['app/app.vue', '../features/alpha/nuxt/src/runtime/app/pages/AlphaPage.vue'],
  ])('rejects direct host import from %s', (path, specifier) => {
    const source = `import feature from '${specifier}'`
    expect(
      platformFeatureImportViolations([
        { path, source: path.endsWith('.vue') ? `<script setup>${source}</script>` : source },
      ]),
    ).toStrictEqual([
      `${path}: feature ${specifier.includes('nuxt') ? 'nuxt' : 'server'} packages may only enter the host through generated registries: ${specifier}`,
    ])
  })
})

declare global {
  var unsafeDescriptorImported: boolean | undefined
}

function packageManifest(moduleId: string, environment: 'server' | 'nuxt') {
  return {
    exports:
      environment === 'server'
        ? {
            '.': { types: './dist/index.d.ts', import: './dist/index.js' },
            './migrations/*': './migrations/*',
          }
        : { '.': { types: './dist/module.d.ts', import: './dist/module.js' } },
    name: `@eve-space/${moduleId}-${environment}`,
    sideEffects: environment === 'server' ? false : ['**/*.vue'],
    type: 'module',
  }
}

function persistenceManifest(exportName: string) {
  return {
    defaultEnabled: false,
    icon: 'character',
    id: 'alpha',
    nuxt: {
      navigation: [],
      package: '@eve-space/alpha-nuxt',
      pages: [],
    },
    server: {
      activityProviders: [],
      esiOperations: [],
      migrations: [{ name: 'alpha-001-persistence.sql' }],
      package: '@eve-space/alpha-server',
      persistenceOperations: [
        {
          id: 'alpha-read',
          method: 'alphaRead',
          revision: 1,
          mode: 'read',
          exportName,
          migration: 'alpha-001-persistence.sql',
        },
      ],
      resources: [],
      routes: [],
    },
  } as const
}

function serverSource(source: string) {
  return {
    moduleId: 'alpha',
    path: 'features/alpha/server/src/index.ts',
    source,
  }
}

function nuxtRuntimeSource(source: string, file = 'useAlpha.ts') {
  return {
    moduleId: 'alpha',
    path: `features/alpha/nuxt/src/runtime/app/${file}`,
    source,
  }
}

function nuxtModuleSource(source: string) {
  return {
    moduleId: 'alpha',
    path: 'features/alpha/nuxt/src/module.ts',
    source,
  }
}

async function createUnsafeInstalledFixture() {
  const root = await mkdtemp(join(tmpdir(), 'eve-space-feature-boundaries-'))
  const files: Record<string, string> = {
    'features/alpha/module.config.ts': `
      globalThis.unsafeDescriptorImported = true
      export default {}
    `,
    'features/alpha/nuxt/package.json': JSON.stringify({
      ...packageManifest('alpha', 'nuxt'),
      files: ['dist'],
      dependencies: { '@nuxt/kit': 'catalog:' },
    }),
    'features/alpha/nuxt/src/module.ts': `
      import { defineNuxtModule } from '@nuxt/kit'
      export default defineNuxtModule({ setup() {} })
    `,
    'features/alpha/nuxt/src/runtime/app/.keep': '',
    'features/alpha/server/package.json': JSON.stringify({
      ...packageManifest('alpha', 'server'),
      files: ['dist', 'migrations'],
    }),
    'features/alpha/server/src/index.ts': 'export function alphaRoutes() { return {} }',
    'features/installed-modules.json': JSON.stringify({ modules: ['alpha'] }),
  }
  await Promise.all(
    Object.entries(files).map(async ([path, source]) => {
      const output = join(root, path)
      await mkdir(dirname(output), { recursive: true })
      await writeFile(output, source)
    }),
  )
  return root
}

interface ExternalPackageBoundaryFixtureOptions {
  readonly serverDependencies?: Readonly<Record<string, string>>
  readonly serverSource?: string
  readonly nuxtDependencies?: Readonly<Record<string, string>>
  readonly nuxtSource?: string
}

async function createExternalPackageBoundaryFixture(
  options: ExternalPackageBoundaryFixtureOptions = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'eve-space-external-module-boundaries-'))
  const serverRoot = join(root, 'installed/alpha-server')
  const nuxtRoot = join(root, 'installed/alpha-nuxt')
  const manifestRoot = join(root, 'installed/alpha-manifest')
  const serverPackage = {
    dependencies: {
      '@eve-space/platform-module-contract': '^1.0.0',
      ...options.serverDependencies,
    },
    exports: {
      '.': { import: './dist/index.js', types: './dist/index.d.ts' },
      './migrations/*': './migrations/*',
    },
    files: ['dist', 'migrations'],
    name: '@example/alpha-server',
    sideEffects: false,
    type: 'module',
  }
  const nuxtPackage = {
    dependencies: { '@nuxt/kit': '^4.0.0', ...options.nuxtDependencies },
    exports: { '.': { import: './dist/module.js', types: './dist/module.d.ts' } },
    files: ['dist'],
    name: '@example/alpha-nuxt',
    sideEffects: ['**/*.vue'],
    type: 'module',
  }
  const files: Record<string, string> = {
    'installed/alpha-nuxt/dist/module.d.ts':
      'declare const feature: unknown\nexport default feature\n',
    'installed/alpha-nuxt/dist/module.js':
      options.nuxtSource ??
      "import { defineNuxtModule } from '@nuxt/kit'\nexport default defineNuxtModule({})\n",
    'installed/alpha-nuxt/package.json': JSON.stringify(nuxtPackage),
    'installed/alpha-server/dist/index.d.ts':
      "import type { PlatformModuleRouteCapabilities } from '@eve-space/platform-module-contract/server'\nexport declare function alphaRoutes(capabilities: PlatformModuleRouteCapabilities): void\n",
    'installed/alpha-server/dist/index.js':
      options.serverSource ??
      "import {} from '@eve-space/platform-module-contract/server'\nexport function alphaRoutes() {}\n",
    'installed/alpha-server/package.json': JSON.stringify(serverPackage),
  }
  await Promise.all(
    Object.entries(files).map(async ([path, source]) => {
      const output = join(root, path)
      await mkdir(dirname(output), { recursive: true })
      await writeFile(output, source)
    }),
  )

  const manifest = {
    defaultEnabled: false,
    icon: 'character',
    id: 'alpha',
    nuxt: { navigation: [], package: '@example/alpha-nuxt', pages: [] },
    release: {
      hostContractRange: '^1.0.0',
      publisherPackage: '@example/alpha-manifest',
      version: '1.2.3',
    },
    server: {
      activityProviders: [],
      esiOperations: [],
      migrations: [],
      package: '@example/alpha-server',
      persistenceOperations: [],
      resources: [],
      routes: [],
    },
  } as const
  const release = {
    manifest,
    migrations: [],
    moduleId: 'alpha',
    nuxtPages: {},
    packages: {
      manifest: externalPackageArtifact('@example/alpha-manifest', manifestRoot, 'manifest.json'),
      nuxt: externalPackageArtifact('@example/alpha-nuxt', nuxtRoot, 'dist/module.js'),
      server: externalPackageArtifact('@example/alpha-server', serverRoot, 'dist/index.js'),
    },
    publisherPackage: '@example/alpha-manifest',
    version: '1.2.3',
  } satisfies ResolvedInstalledModuleRelease
  return { release, root }
}

function externalPackageArtifact(
  name: string,
  packageRoot: string,
  entry: string,
): ResolvedInstalledModuleRelease['packages']['server'] {
  return {
    entryPath: join(packageRoot, entry),
    integrity: 'sha512-fixture',
    name,
    root: packageRoot,
    version: '1.2.3',
    workspace: false,
  }
}
