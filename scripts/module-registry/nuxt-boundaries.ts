import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { nuxtSourceBoundaryViolations } from './feature-boundaries.js'

export interface ModuleNuxtSource {
  readonly moduleId: string
  readonly path: string
  readonly source: string
}

const sourceExtensions = new Set(['.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx', '.vue'])

export async function loadFeatureNuxtSources(root: string): Promise<readonly ModuleNuxtSource[]> {
  const modules = await loadInstalledModuleIds(root)
  const sources = await Promise.all(
    modules.map(async (moduleId) => {
      const packageRoot = join(root, 'features', moduleId, 'nuxt')
      const runtimeRoot = join(packageRoot, 'src', 'runtime', 'app')
      if (!(await directoryExists(runtimeRoot)))
        throw new Error(`Installed Nuxt module ${moduleId} is missing src/runtime/app`)
      if (await directoryExists(join(packageRoot, 'server')))
        throw new Error(`Installed Nuxt module ${moduleId} must not define Nitro server handlers`)
      return sourceFiles(root, moduleId, join(packageRoot, 'src'))
    }),
  )
  return sources.flat()
}

export function moduleNuxtBoundaryViolations(sources: readonly ModuleNuxtSource[]) {
  return sources
    .flatMap((source) => nuxtSourceBoundaryViolations(source))
    .toSorted((left, right) => left.localeCompare(right))
}

async function loadInstalledModuleIds(root: string): Promise<readonly string[]> {
  const installed: unknown = JSON.parse(
    await readFile(join(root, 'features', 'installed-modules.json'), 'utf8'),
  )
  if (
    typeof installed !== 'object' ||
    installed === null ||
    !('modules' in installed) ||
    !Array.isArray(installed.modules) ||
    !installed.modules.every((moduleId) => typeof moduleId === 'string')
  )
    throw new Error('features/installed-modules.json must contain a string modules array')
  return installed.modules
}

async function sourceFiles(
  root: string,
  moduleId: string,
  directory: string,
): Promise<readonly ModuleNuxtSource[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return sourceFiles(root, moduleId, path)
      if (!entry.isFile() || !sourceExtensions.has(extname(entry.name))) return []
      return [{ moduleId, path: relative(root, path), source: await readFile(path, 'utf8') }]
    }),
  )
  return nested.flat()
}

async function directoryExists(path: string) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}
