import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateRegistryFiles, loadInstalledModuleManifests } from './module-registry/generator.js'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixtureRoot = join(repositoryRoot, 'tests/fixtures/platform-module-conformance')
const serverRoot = join(fixtureRoot, 'features/conformance/server')
const nuxtRoot = join(fixtureRoot, 'features/conformance/nuxt')
const generatedRoot = join(fixtureRoot, 'generated')
const stableNuxtTsconfig = `${JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2023',
      module: 'Preserve',
      moduleResolution: 'Bundler',
      strict: true,
    },
    include: [],
  },
  null,
  2,
)}\n`
const outputs = [
  generatedRoot,
  join(fixtureRoot, 'api/src/generated'),
  join(fixtureRoot, '.nuxt'),
  join(fixtureRoot, '.output'),
  join(fixtureRoot, 'node_modules'),
  join(serverRoot, 'node_modules'),
  join(nuxtRoot, 'node_modules'),
  join(serverRoot, 'dist'),
  join(nuxtRoot, 'dist'),
]

try {
  cleanOutputs()
  const manifests = await loadInstalledModuleManifests(fixtureRoot)
  for (const [path, content] of generateRegistryFiles(manifests)) {
    const output = join(fixtureRoot, path)
    mkdirSync(dirname(output), { recursive: true })
    writeFileSync(output, content, 'utf8')
  }
  writeFileSync(
    join(fixtureRoot, 'tsconfig.json'),
    `${JSON.stringify(
      {
        files: [],
        references: [
          { path: './.nuxt/tsconfig.app.json' },
          { path: './.nuxt/tsconfig.server.json' },
          { path: './.nuxt/tsconfig.shared.json' },
          { path: './.nuxt/tsconfig.node.json' },
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  linkFixtureDependencies()

  run('platform contract build', 'api/node_modules/.bin/tsc', [
    '--project',
    'packages/platform-module-contract/tsconfig.json',
  ])
  run('platform server build', 'api/node_modules/.bin/tsc', [
    '--project',
    'packages/platform-module-server/tsconfig.json',
  ])
  run('platform Nuxt build', 'node_modules/.bin/tsc6', [
    '--project',
    'packages/platform-module-nuxt/tsconfig.json',
  ])
  run('platform Nuxt runtime asset copy', 'node', ['scripts/copy-platform-nuxt-runtime-assets.mjs'])
  run('conformance server typecheck', 'api/node_modules/.bin/tsc', [
    '--project',
    join(serverRoot, 'tsconfig.json'),
    '--noEmit',
  ])
  run('conformance Nuxt package typecheck', 'node_modules/.bin/tsc6', [
    '--project',
    join(nuxtRoot, 'tsconfig.json'),
    '--noEmit',
  ])
  run('conformance final API typecheck', 'api/node_modules/.bin/tsc', [
    '--project',
    join(fixtureRoot, 'api/tsconfig.json'),
  ])
  run('conformance server package build', 'api/node_modules/.bin/tsc', [
    '--project',
    join(serverRoot, 'tsconfig.json'),
  ])
  run('conformance Nuxt package build', 'node_modules/.bin/tsc6', [
    '--project',
    join(nuxtRoot, 'tsconfig.json'),
  ])
  run('conformance Nuxt application typecheck', 'node_modules/.bin/nuxt', [
    'typecheck',
    fixtureRoot,
  ])
  run('conformance Nuxt production build', 'node_modules/.bin/nuxt', ['build', fixtureRoot])

  for (const output of [
    join(serverRoot, 'dist/index.js'),
    join(serverRoot, 'dist/index.d.ts'),
    join(nuxtRoot, 'dist/module.js'),
    join(nuxtRoot, 'dist/module.d.ts'),
    join(
      repositoryRoot,
      'packages/platform-module-nuxt/dist/runtime/app/components/PlatformResourceBoundary.vue',
    ),
    join(fixtureRoot, '.output/server/index.mjs'),
    join(fixtureRoot, 'api/src/generated/platform/installed-module-routes.ts'),
    join(fixtureRoot, 'generated/platform/installed-nuxt-contributions.ts'),
  ])
    if (!existsSync(output)) throw new Error(`Module conformance output is missing ${output}`)

  run('module conformance tests', 'node_modules/.bin/vitest', [
    'run',
    '--config',
    'vitest.conformance.config.ts',
  ])
} finally {
  cleanOutputs()
  writeFileSync(join(fixtureRoot, 'tsconfig.json'), stableNuxtTsconfig, 'utf8')
}

function run(label: string, command: string, args: readonly string[]) {
  console.log(`Running ${label}`)
  const executable = command === 'node' ? process.execPath : join(repositoryRoot, command)
  const result = spawnSync(executable, args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(`${label} failed with status ${result.status ?? 'unknown'}`)
}

function cleanOutputs() {
  for (const output of outputs) rmSync(output, { recursive: true, force: true })
}

function linkFixtureDependencies() {
  const dependencies = [
    [
      serverRoot,
      '@eve-space/platform-module-contract',
      'api/node_modules/@eve-space/platform-module-contract',
    ],
    [
      serverRoot,
      '@eve-space/platform-module-server',
      'api/node_modules/@eve-space/platform-module-server',
    ],
    [serverRoot, '@hono/zod-validator', 'api/node_modules/@hono/zod-validator'],
    [serverRoot, 'hono', 'api/node_modules/hono'],
    [serverRoot, 'zod', 'api/node_modules/zod'],
    [nuxtRoot, '@eve-space/platform-module-nuxt', 'node_modules/@eve-space/platform-module-nuxt'],
    [nuxtRoot, '@nuxt/kit', 'node_modules/@nuxt/kit'],
    [nuxtRoot, '@nuxt/schema', 'packages/platform-module-nuxt/node_modules/@nuxt/schema'],
    [nuxtRoot, 'vue', 'node_modules/vue'],
  ] as const
  for (const [packageRoot, name, source] of dependencies) {
    const destination = join(packageRoot, 'node_modules', name)
    mkdirSync(dirname(destination), { recursive: true })
    symlinkSync(join(repositoryRoot, source), destination, 'junction')
  }
}
