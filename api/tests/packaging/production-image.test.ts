import { readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  installedModuleIds,
  installedModuleMigrations,
} from '../../src/generated/platform/installed-module-migrations.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const image = `eve-space-api-packaging-test:${process.pid}`

beforeAll(() => {
  runDocker(['build', '--file', 'api/Dockerfile', '--tag', image, '.'], 300_000)
})

afterAll(() => {
  spawnSync('docker', ['image', 'rm', '--force', image], { cwd: root, encoding: 'utf8' })
})

describe('API production image', () => {
  it('contains every server registry and migration without Nuxt dependencies', () => {
    const coreMigrations = readdirSync(resolve(root, 'api/migrations'))
      .filter((name) => name.endsWith('.sql'))
      .toSorted()
    const verification = runDocker([
      'run',
      '--rm',
      '--entrypoint',
      'node',
      image,
      '--input-type=module',
      '--eval',
      imageVerificationScript,
      JSON.stringify({ coreMigrations, installedModuleIds, installedModuleMigrations }),
    ])

    expect(JSON.parse(verification)).toEqual({ verified: true })
  })
})

const imageVerificationScript = `
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
const expected = JSON.parse(process.argv[1])
const required = [
  '/app/dist/server.js',
  '/app/dist/worker.js',
  '/app/dist/generated/platform/installed-module-routes.js',
  '/app/dist/generated/platform/installed-module-worker.js',
  '/app/dist/generated/platform/installed-module-migrations.js',
  '/app/dist/generated/platform/installed-module-esi.js',
  '/app/dist/generated/platform/installed-module-runtime.js',
  ...expected.coreMigrations.map((name) => '/app/migrations/' + name),
]
for (const path of required) if (!existsSync(path)) throw new Error('Missing production file ' + path)
for (const moduleId of expected.installedModuleIds)
  await import('@eve-space/' + moduleId + '-server')
for (const migration of expected.installedModuleMigrations) {
  const resolved = import.meta.resolve(
    '@eve-space/' + migration.moduleId + '-server/migrations/' + migration.name,
  )
  await readFile(new URL(resolved), 'utf8')
}
for (const dependency of ['nuxt', '@nuxt/kit', '@eve-space/platform-module-nuxt']) {
  try {
    import.meta.resolve(dependency)
    throw new Error('Unexpected Nuxt dependency ' + dependency)
  } catch (error) {
    if (String(error).includes('Unexpected Nuxt dependency')) throw error
  }
}
console.log(JSON.stringify({ verified: true }))
`

function runDocker(arguments_: readonly string[], timeout = 60_000) {
  const result = spawnSync('docker', arguments_, {
    cwd: root,
    encoding: 'utf8',
    timeout,
  })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(`docker ${arguments_.join(' ')} failed:\n${result.stdout}\n${result.stderr}`)
  return result.stdout.trim()
}
