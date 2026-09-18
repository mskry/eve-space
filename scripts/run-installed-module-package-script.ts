import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolveInstalledModuleReleases } from './module-registry/resolved-release.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const environment = process.argv[2]
const script = process.argv[3]
const ifPresent = process.argv[4] === '--if-present'

if (
  (environment !== 'server' && environment !== 'nuxt') ||
  !script ||
  (process.argv[4] && !ifPresent) ||
  process.argv[5]
)
  throw new Error(
    'Usage: run-installed-module-package-script.ts server|nuxt <script> [--if-present]',
  )

const { releases } = resolveInstalledModuleReleases(root, { validateArtifacts: false })
let runCount = 0
for (const release of releases) {
  const artifact = release.packages[environment]
  if (!artifact.workspace) continue
  const packageName = artifact.name
  const packagePath = join(artifact.root, 'package.json')
  const manifest = readJson<{ name?: string; scripts?: Record<string, string> }>(packagePath)
  if (manifest.name !== packageName)
    throw new Error(`${packagePath} must declare package name ${packageName}`)
  if (!manifest.scripts?.[script] && ifPresent) continue
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
  runCount += 1
}

console.log(`Ran ${script} for ${runCount} installed ${environment} package(s)`)

function readJson<T>(path: string): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch (error) {
    throw new Error(`Could not read ${path}`, { cause: error })
  }
}
