import { readdir, readFile } from 'node:fs/promises'
import { join, posix } from 'node:path'
import { parse } from 'vue/compiler-sfc'
import { typescriptModuleSpecifiers } from './typescript-module-specifiers.js'

const buildModules = new Map([
  ['module.ts', 'entry'],
  ['contribution-resolution.ts', 'adapter'],
  ['page-resolution.ts', 'adapter'],
  ['runtime-registration.ts', 'adapter'],
  ['templates.ts', 'adapter'],
  ['navigation.ts', 'pure'],
  ['pages.ts', 'pure'],
  ['path-containment.ts', 'pure'],
  ['resolved-exposures.ts', 'pure'],
])

export interface PlatformNuxtSource {
  readonly path: string
  readonly source: string
}

export function platformNuxtBoundaryViolations(sources: readonly PlatformNuxtSource[]) {
  return sources
    .flatMap(platformNuxtSourceBoundaryViolations)
    .toSorted((left, right) => left.localeCompare(right))
}

export async function loadPlatformNuxtSources(
  root: string,
  directory = '',
): Promise<PlatformNuxtSource[]> {
  const sourceRoot = join(root, 'packages/platform-module-nuxt/src')
  const entries = await readdir(join(sourceRoot, directory), { withFileTypes: true })
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = posix.join(directory, entry.name)
        if (entry.isDirectory()) return loadPlatformNuxtSources(root, path)
        if (!entry.isFile() || !/\.(?:ts|vue)$/.test(entry.name)) return []
        return [{ path, source: await readFile(join(sourceRoot, path), 'utf8') }]
      }),
    )
  ).flat()
}

function platformNuxtSourceBoundaryViolations({ path, source }: PlatformNuxtSource) {
  const runtime = path === 'runtime.ts' || path.startsWith('runtime/')
  const tier = buildModules.get(path)
  const violations: string[] = []
  if (!runtime && !tier) violations.push(`${path}: build module has no declared tier`)

  const specifiers = sourceScripts(path, source).flatMap((script) =>
    typescriptModuleSpecifiers(path, script),
  )
  for (const specifier of specifiers)
    violations.push(...platformNuxtImportBoundaryViolations(path, runtime, tier, specifier))
  return violations
}

function platformNuxtImportBoundaryViolations(
  path: string,
  runtime: boolean,
  tier: string | undefined,
  specifier: string,
) {
  const target = specifier.startsWith('.')
    ? posix.normalize(posix.join(posix.dirname(path), specifier)).replace(/\.js$/, '.ts')
    : specifier
  const violations: string[] = []
  if (
    runtime &&
    (specifier.startsWith('node:') ||
      specifier === '@nuxt/kit' ||
      specifier.startsWith('@nuxt/kit/') ||
      (specifier.startsWith('.') && !target.startsWith('runtime/')))
  )
    violations.push(`${path}: runtime must not import build dependency ${specifier}`)
  if (
    tier === 'pure' &&
    (specifier === '@nuxt/kit' ||
      specifier.startsWith('@nuxt/kit/') ||
      (specifier.startsWith('node:') && specifier !== 'node:path') ||
      buildModules.get(target) === 'adapter' ||
      (target.startsWith('runtime/') && target !== 'runtime/navigation.ts'))
  )
    violations.push(`${path}: pure module must not import registration dependency ${specifier}`)
  if (tier && tier !== 'entry' && buildModules.get(target) === 'entry')
    violations.push(`${path}: module must not import the orchestration entry ${specifier}`)
  return violations
}

function sourceScripts(path: string, source: string) {
  if (!path.endsWith('.vue')) return [source]
  const { descriptor } = parse(source)
  return [descriptor.script, descriptor.scriptSetup].flatMap((script) =>
    script ? [script.content] : [],
  )
}
