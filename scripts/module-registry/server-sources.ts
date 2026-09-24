import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { loadInstalledFeaturePackageSources } from './feature-boundaries.js'
import type { ModuleServerSource } from './server-boundaries.js'
import type { ResolvedInstalledModuleRelease } from './resolved-release.js'
import { moduleServerSourceExtensions } from './source-extensions.mjs'

const moduleServerSourceExtensionSet = new Set(moduleServerSourceExtensions)

export async function loadFeatureServerSources(
  root: string,
  releases?: readonly ResolvedInstalledModuleRelease[],
): Promise<ModuleServerSource[]> {
  if (releases) {
    const moduleSources = await Promise.all(
      releases.map((release) => loadInstalledFeaturePackageSources(root, release, 'server')),
    )
    return moduleSources.flat()
  }
  const featuresDirectory = join(root, 'features')
  const entries = await readdir(featuresDirectory, { withFileTypes: true })
  const moduleSources = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const sourceDirectory = join(featuresDirectory, entry.name, 'server', 'src')
        try {
          return await sourceFiles(root, sourceDirectory, entry.name)
        } catch (error) {
          if (isErrnoCode(error, 'ENOENT')) {
            return []
          }
          throw error
        }
      }),
  )
  return moduleSources.flat()
}

async function sourceFiles(
  root: string,
  directory: string,
  moduleId: string,
): Promise<ModuleServerSource[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        return sourceFiles(root, path, moduleId)
      }
      if (!entry.isFile() || !moduleServerSourceExtensionSet.has(extname(entry.name))) {
        return []
      }
      return [{ moduleId, path: relative(root, path), source: await readFile(path, 'utf8') }]
    }),
  )
  return nested.flat()
}

function isErrnoCode(error: unknown, code: string) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}
