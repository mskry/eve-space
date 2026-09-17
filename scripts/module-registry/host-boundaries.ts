import { readFile, readdir, stat } from 'node:fs/promises'
import { extname, join, posix, relative } from 'node:path'
import { parse as parseVue } from 'vue/compiler-sfc'
import { typescriptModuleSpecifiers } from '../typescript-module-specifiers.js'

const sourceExtensions = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
  '.vue',
])
const platformServerPackage = '@eve-space/platform-module-server'
const platformNuxtPackage = '@eve-space/platform-module-nuxt'
const generatedServerRegistries = new Set([
  'api/src/generated/platform/installed-module-activity-providers.ts',
  'api/src/generated/platform/installed-module-esi.ts',
  'api/src/generated/platform/installed-module-persistence.ts',
  'api/src/generated/platform/installed-module-routes.ts',
  'api/src/generated/platform/installed-module-worker.ts',
])

export interface PlatformHostSource {
  readonly path: string
  readonly source: string
}

export function platformFeatureImportViolations(sources: readonly PlatformHostSource[]) {
  return sources
    .flatMap((source) =>
      hostModuleSpecifiers(source).flatMap((specifier) =>
        featureImportViolation(source.path, specifier),
      ),
    )
    .toSorted((left, right) => left.localeCompare(right))
}

function hostModuleSpecifiers(source: PlatformHostSource) {
  if (!source.path.endsWith('.vue')) return typescriptModuleSpecifiers(source.path, source.source)
  const { descriptor } = parseVue(source.source, { filename: source.path })
  return [descriptor.script, descriptor.scriptSetup].flatMap((script, index) =>
    script
      ? typescriptModuleSpecifiers(
          `${source.path}#script-${index}.${script.lang ?? 'js'}`,
          script.content,
        )
      : [],
  )
}

export async function loadPlatformHostSources(root: string) {
  const directories = ['api/src', 'app', 'generated', 'layers', 'packages', 'scripts', 'server']
  const nested = await Promise.all(
    directories.map((directory) => loadSources(root, join(root, directory))),
  )
  const rootFiles = await Promise.all(
    ['app.config.ts', 'nuxt.config.ts'].map(async (filename) => {
      const path = join(root, filename)
      return (await fileExists(path))
        ? [{ path: relative(root, path), source: await readFile(path, 'utf8') }]
        : []
    }),
  )
  return [...nested.flat(), ...rootFiles.flat()]
}

function featureImportViolation(path: string, specifier: string) {
  const normalized = posix.normalize(specifier.replaceAll('\\', '/'))
  const featurePackage = featurePackageEnvironment(normalized)
  const featurePath = featurePathEnvironment(normalized)
  const environment = featurePackage ?? featurePath
  if (!environment) return []
  if (environment === 'server' && isGeneratedServerRegistry(path)) return []
  if (environment === 'nuxt' && isGeneratedNuxtRegistry(path)) return []
  return [
    `${path}: feature ${environment} packages may only enter the host through generated registries: ${specifier}`,
  ]
}

function featurePackageEnvironment(specifier: string) {
  if (
    !specifier.startsWith('@eve-space/') ||
    specifier === platformServerPackage ||
    specifier.startsWith(`${platformServerPackage}/`) ||
    specifier === platformNuxtPackage ||
    specifier.startsWith(`${platformNuxtPackage}/`)
  )
    return undefined
  if (/^@eve-space\/[a-z0-9]+(?:-[a-z0-9]+)*-server(?:\/|$)/.test(specifier)) return 'server'
  if (/^@eve-space\/[a-z0-9]+(?:-[a-z0-9]+)*-nuxt(?:\/|$)/.test(specifier)) return 'nuxt'
  return undefined
}

function featurePathEnvironment(specifier: string) {
  const match = /(?:^|\/)features\/[a-z0-9]+(?:-[a-z0-9]+)*\/(server|nuxt)(?:\/|$)/.exec(specifier)
  return match?.[1]
}

function isGeneratedServerRegistry(path: string) {
  return generatedServerRegistries.has(path.replaceAll('\\', '/'))
}

function isGeneratedNuxtRegistry(path: string) {
  return path.replaceAll('\\', '/') === 'generated/platform/installed-nuxt-modules.ts'
}

async function loadSources(root: string, directory: string): Promise<PlatformHostSource[]> {
  if (!(await directoryExists(directory))) return []
  const entries = await readdir(directory, { withFileTypes: true })
  const sources = await Promise.all(
    entries.map(async (entry): Promise<PlatformHostSource[]> => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (
          ['.nuxt', 'build', 'coverage', 'dist', 'node_modules', 'test', 'tests'].includes(
            entry.name,
          )
        )
          return []
        return loadSources(root, path)
      }
      if (!entry.isFile() || !sourceExtensions.has(extname(entry.name))) return []
      return [{ path: relative(root, path), source: await readFile(path, 'utf8') }]
    }),
  )
  return sources.flat()
}

async function directoryExists(path: string) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function fileExists(path: string) {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}
