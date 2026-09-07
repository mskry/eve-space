import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  descriptorBoundaryViolations,
  featurePackageManifestViolations,
  nuxtSourceBoundaryViolations,
  serverFactoryBoundaryViolations,
  serverSourceBoundaryViolations,
} from '../../scripts/module-registry/feature-boundaries'
import { loadInstalledModuleManifests } from '../../scripts/module-registry/generator'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
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
    ).toEqual([])
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
    ).toEqual([])
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

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('dependency vue must use catalog:'),
        expect.stringContaining('escapes the feature package root'),
      ]),
    )
  })
})

describe('feature source import allowlists', () => {
  it('accepts package-local and reviewed server imports', () => {
    expect(
      serverSourceBoundaryViolations(
        serverSource(`
          import type { PlatformModuleRouteCapabilities } from '@eve-space/platform-module-contract'
          import { Hono } from 'hono'
          export { localValue } from './local.js'
          export function alphaRoutes() {
            return new Hono().get('/', (context) => context.json({ ok: true }))
          }
        `),
      ),
    ).toEqual([])
  })

  it.each([
    '@eve-space/api/auth/tokens',
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

    expect(violations).not.toEqual([])
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

  it.each([
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

    expect(violations).not.toEqual([])
  })

  it('allows only named reviewed #imports symbols', () => {
    expect(
      nuxtSourceBoundaryViolations(
        nuxtRuntimeSource("import { computed, useRoute } from '#imports'"),
      ),
    ).toEqual([])
    expect(
      nuxtSourceBoundaryViolations(
        nuxtRuntimeSource("import { $fetch, useCharacterQuery } from '#imports'"),
      ),
    ).toContainEqual(expect.stringContaining('rejected $fetch, useCharacterQuery'))
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
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('platform client surface'),
        expect.stringContaining('must not call addServerHandler'),
      ]),
    )
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
    ).toEqual([])
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
    ).toEqual([])
  })

  it.each([
    '<script setup>const value = 1',
    '<script>const a = 1</script><script>const b = 2</script>',
    '<script src="../../../../../../app/private.js"></script><template><div></div></template>',
    '<script lang="coffee">value = 1</script>',
  ])('rejects Vue scripts that cannot be fully checked: %s', (source) => {
    expect(nuxtSourceBoundaryViolations(nuxtRuntimeSource(source, 'FeaturePage.vue'))).not.toEqual(
      [],
    )
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
      ).toEqual(
        [
          'module descriptor may only type-import @eve-space/platform-module-contract',
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
    expect(serverSourceBoundaryViolations(source)).toEqual(
      [
        'feature package entry or definition has an executable initializer',
        'feature package entry or definition has an executable initializer',
        'feature package default export has an executable initializer',
        'feature package entry contains executable top-level code',
      ].map((message) => `${source.path}: ${message}`),
    )
  })

  it('accepts a static serializable descriptor with a type-only contract import', () => {
    expect(
      descriptorBoundaryViolations({
        moduleId: 'alpha',
        path: 'features/alpha/module.config.ts',
        source: `
          import type { PlatformModuleManifest } from '@eve-space/platform-module-contract'
          const manifest = {
            id: 'alpha', icon: 'character', defaultEnabled: false,
            server: { package: '@eve-space/alpha-server', routes: [], migrations: [], resources: [], esiOperations: [], activityProviders: [] },
            nuxt: { package: '@eve-space/alpha-nuxt', pages: [], navigation: [] },
          } satisfies PlatformModuleManifest
          export default manifest
        `,
      }),
    ).toEqual([])
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
    ).not.toEqual([])
  })

  it.each([
    ['connection', 'connect()'],
    ['fetch', "fetch('https://example.test')"],
    ['timer', 'setInterval(() => {}, 1000)'],
    ['background loop', 'queueMicrotask(run)'],
    ['environment', 'const enabled = process.env.ALPHA'],
    ['runtime client', "const socket = new WebSocket('wss://example.test')"],
  ])('rejects server entry %s work', (_category, statement) => {
    expect(serverSourceBoundaryViolations(serverSource(statement))).not.toEqual([])
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
    ).toEqual([])
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
            await capabilities.persistence.transaction(async () => [])
            return context.json({ ok: true })
          })
        }
        export function alphaProvider(capabilities) {
          return async () => {
            await capabilities.persistence.transaction(async () => [])
            return { activities: [], freshness: { state: 'current', collectedAt: null } }
          }
        }
      `),
    ]
    expect(serverFactoryBoundaryViolations(cleanSources, 'alphaRoutes', 'route')).toEqual([])
    expect(serverFactoryBoundaryViolations(cleanSources, 'alphaProvider', 'provider')).toEqual([])

    const eager = [
      serverSource(`
        export function alphaRoutes(capabilities) {
          capabilities.persistence.transaction(async () => [])
          return {}
        }
        export function alphaProvider() {
          setTimeout(() => {}, 1)
          return async () => ({ activities: [], freshness: { state: 'current', collectedAt: null } })
        }
      `),
    ]
    expect(serverFactoryBoundaryViolations(eager, 'alphaRoutes', 'route')).not.toEqual([])
    expect(serverFactoryBoundaryViolations(eager, 'alphaProvider', 'provider')).not.toEqual([])
  })

  it('allows deterministic Nuxt Kit registration and rejects setup side effects', () => {
    const clean = nuxtModuleSource(`
      import { addComponentsDir, createResolver, defineNuxtModule } from '@nuxt/kit'
      export default defineNuxtModule({
        setup() {
          const resolver = createResolver(import.meta.url)
          addComponentsDir({ path: resolver.resolve('./runtime/app/components') })
        },
      })
    `)
    expect(nuxtSourceBoundaryViolations(clean)).toEqual([])

    for (const setup of [
      "fetch('https://example.test')",
      'setInterval(() => {}, 1000)',
      'connect()',
      'persistence.transaction(async () => {})',
      'const enabled = process.env.ALPHA',
    ])
      expect(
        nuxtSourceBoundaryViolations(
          nuxtModuleSource(`
            import { defineNuxtModule } from '@nuxt/kit'
            export default defineNuxtModule({ setup() { ${setup} } })
          `),
        ),
      ).not.toEqual([])
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
    ).not.toEqual([])
  })

  it('rejects an executable descriptor before registry generation imports it', async () => {
    const root = await createUnsafeInstalledFixture()
    temporaryRoots.push(root)
    delete globalThis.unsafeDescriptorImported

    await expect(loadInstalledModuleManifests(root)).rejects.toThrow(
      'Feature module boundary verification failed',
    )
    expect(globalThis.unsafeDescriptorImported).toBeUndefined()
  })
})

declare global {
  var unsafeDescriptorImported: boolean | undefined
}

function packageManifest(moduleId: string, environment: 'server' | 'nuxt') {
  return {
    name: `@eve-space/${moduleId}-${environment}`,
    type: 'module',
    sideEffects: environment === 'server' ? false : ['**/*.vue'],
    exports:
      environment === 'server'
        ? {
            '.': { types: './dist/index.d.ts', import: './dist/index.js' },
            './migrations/*': './migrations/*',
          }
        : { '.': { types: './dist/module.d.ts', import: './dist/module.js' } },
  }
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
    'features/installed-modules.json': JSON.stringify({ modules: ['alpha'] }),
    'features/alpha/module.config.ts': `
      globalThis.unsafeDescriptorImported = true
      export default {}
    `,
    'features/alpha/server/package.json': JSON.stringify({
      ...packageManifest('alpha', 'server'),
      files: ['dist', 'migrations'],
    }),
    'features/alpha/server/src/index.ts': 'export function alphaRoutes() { return {} }',
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
