import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const environment = process.argv[2]
const script = process.argv[3]

if ((environment !== 'server' && environment !== 'nuxt') || !script)
  throw new Error('Usage: run-installed-module-package-script.ts server|nuxt <script>')

const installed = readJson<{ modules?: unknown }>(resolve(root, 'features/installed-modules.json'))
if (!Array.isArray(installed.modules) || installed.modules.some((id) => typeof id !== 'string'))
  throw new Error('features/installed-modules.json must contain a modules string array')

const moduleIds = [...installed.modules].toSorted((left, right) => left.localeCompare(right))
for (const moduleId of moduleIds) {
  const packageName = `@eve-space/${moduleId}-${environment}`
  const packagePath = resolve(root, 'features', moduleId, environment, 'package.json')
  const manifest = readJson<{ name?: string; scripts?: Record<string, string> }>(packagePath)
  if (manifest.name !== packageName)
    throw new Error(`${packagePath} must declare package name ${packageName}`)
  if (!manifest.scripts?.[script])
    throw new Error(`${packageName} must declare the ${script} script`)

  const pnpmPath = process.env.npm_execpath
  if (!pnpmPath) throw new Error('This command must run through pnpm')
  const result = spawnSync(process.execPath, [pnpmPath, '--filter', packageName, 'run', script], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

console.log(`Ran ${script} for ${moduleIds.length} installed ${environment} package(s)`)

function readJson<T>(path: string): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch (error) {
    throw new Error(`Could not read ${path}`, { cause: error })
  }
}
