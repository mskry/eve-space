import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { typescriptModuleSpecifiers } from './typescript-module-specifiers.js'

const root = resolve(import.meta.dirname, '..')
const contractSource = join(root, 'packages/platform-module-contract/src')
const publicModules = new Set([
  'activity',
  'compiler',
  'esi',
  'identifiers',
  'installed',
  'manifest',
  'nuxt',
  'permissions',
  'persistence',
  'publisher',
  'resources',
  'server',
])
const internalModules = new Set([...publicModules, 'validation'])
const allowedInternalImports: Readonly<Record<string, ReadonlySet<string>>> = {
  activity: new Set(['installed', 'persistence', 'server']),
  compiler: new Set([
    'activity',
    'manifest',
    'nuxt',
    'permissions',
    'persistence',
    'resources',
    'server',
    'validation',
  ]),
  esi: new Set(),
  identifiers: new Set(),
  installed: new Set(['nuxt', 'permissions', 'server']),
  manifest: new Set(['activity', 'nuxt', 'permissions', 'persistence', 'resources', 'server']),
  nuxt: new Set(['server']),
  permissions: new Set(['server']),
  persistence: new Set(),
  publisher: new Set(['compiler', 'esi', 'identifiers', 'manifest', 'nuxt']),
  resources: new Set(['persistence', 'server']),
  server: new Set(),
  validation: new Set([
    'identifiers',
    'manifest',
    'nuxt',
    'permissions',
    'persistence',
    'resources',
    'server',
  ]),
}
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
const ignoredDirectories = new Set([
  '.git',
  '.nuxt',
  '.opencode',
  '.output',
  '.pnpm-store',
  'coverage',
  'dist',
  'node_modules',
])
const featureServerModules = new Set([
  'activity',
  'esi',
  'identifiers',
  'persistence',
  'resources',
  'server',
])
const platformNuxtModules = new Set(['nuxt', 'server'])
const hostApiModules = new Set([
  'activity',
  'esi',
  'identifiers',
  'installed',
  'nuxt',
  'persistence',
  'resources',
  'server',
])
const hostNuxtModules = new Set(['nuxt', 'server'])
const nonCompositionModules = new Set(
  [...publicModules].filter((name) => name !== 'compiler' && name !== 'manifest'),
)
const apiGeneratedRegistryModules: Readonly<Record<string, ReadonlySet<string>>> = {
  'installed-module-activity-providers': new Set(['activity']),
  'installed-module-esi': new Set(['esi']),
  'installed-module-migrations': new Set(['installed']),
  'installed-module-runtime': new Set(['installed', 'nuxt']),
  'installed-module-worker': new Set(['resources']),
  'installed-reviewer-contributions': new Set(['installed']),
}

export function platformModuleContractBoundaryViolations() {
  return [
    ...validateContractFiles(),
    ...validatePackageExports(),
    ...validateRepositoryImports(),
  ].toSorted((left, right) => left.localeCompare(right))
}

const contractViolations = platformModuleContractBoundaryViolations()
if (contractViolations.length > 0)
  throw new Error(
    `Platform module contract boundary verification failed:\n${contractViolations.join('\n')}`,
  )

console.log('Platform module contract boundaries verified')

function validateContractFiles() {
  const violations: string[] = []
  const files = readdirSync(contractSource)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => name.slice(0, -3))
  for (const name of files)
    if (!internalModules.has(name))
      violations.push(`packages/platform-module-contract/src/${name}.ts is undeclared`)
  for (const name of internalModules)
    if (!files.includes(name))
      violations.push(`packages/platform-module-contract/src/${name}.ts is missing`)

  const dependencies = new Map<string, string[]>()
  for (const name of files) {
    const path = join(contractSource, `${name}.ts`)
    const imports = localImports(path)
    dependencies.set(name, imports)
    for (const imported of imports)
      if (!allowedInternalImports[name]?.has(imported))
        violations.push(
          `packages/platform-module-contract/src/${name}.ts cannot import ${imported}.ts`,
        )
  }
  for (const cycle of dependencyCycles(dependencies))
    violations.push(`platform module contract dependency cycle: ${cycle.join(' -> ')}`)
  return violations
}

function validatePackageExports() {
  const packageJson = JSON.parse(
    readFileSync(join(root, 'packages/platform-module-contract/package.json'), 'utf8'),
  ) as { exports?: Record<string, unknown> }
  const actual = Object.keys(packageJson.exports ?? {}).toSorted((left, right) =>
    left.localeCompare(right),
  )
  const expected = [...publicModules]
    .map((name) => `./${name}`)
    .toSorted((left, right) => left.localeCompare(right))
  return arraysEqual(actual, expected)
    ? []
    : [`platform module contract exports must be exactly ${expected.join(', ')}`]
}

function validateRepositoryImports() {
  const violations: string[] = []
  for (const path of walk(root)) {
    const relativePath = relative(root, path)
    if (relativePath.startsWith('packages/platform-module-contract/src/')) continue
    const source = readFileSync(path, 'utf8')
    for (const specifier of platformModuleContractModuleSpecifiers(path, source))
      violations.push(...platformModuleContractImportViolations(relativePath, specifier))
  }
  return violations
}

export function platformModuleContractImportViolations(relativePath: string, specifier: string) {
  const violations: string[] = []
  if (specifier === '@eve-space/platform-module-contract')
    violations.push(`${relativePath}: package-root contract import is forbidden`)
  if (specifier.includes('packages/platform-module-contract/src'))
    violations.push(`${relativePath}: contract implementation-file import is forbidden`)
  if (!specifier.startsWith('@eve-space/platform-module-contract/')) return violations

  const subpath = specifier.slice('@eve-space/platform-module-contract/'.length)
  if (!publicModules.has(subpath)) {
    violations.push(`${relativePath}: unknown contract subpath ${specifier}`)
    return violations
  }

  const role = contractCallerRole(relativePath)
  if (!role) violations.push(`${relativePath}: unregistered caller role cannot import ${subpath}`)
  else if (!role.allowed.has(subpath))
    violations.push(`${relativePath}: ${role.name} cannot import ${subpath}`)
  return violations
}

function contractCallerRole(relativePath: string) {
  const normalizedPath = relativePath.replaceAll('\\', '/')
  return (
    featureContractCallerRole(normalizedPath) ??
    platformPackageContractCallerRole(normalizedPath) ??
    generatedRegistryContractCallerRole(normalizedPath) ??
    hostContractCallerRole(normalizedPath) ??
    scriptContractCallerRole(normalizedPath) ??
    testContractCallerRole(normalizedPath)
  )
}

function featureContractCallerRole(normalizedPath: string) {
  if (/(?:^|\/)features\/[^/]+\/module\.config\.[cm]?[jt]sx?$/.test(normalizedPath))
    return { name: 'feature descriptors', allowed: new Set(['manifest']) }
  if (/(?:^|\/)features\/[^/]+\/manifest\//.test(normalizedPath))
    return { name: 'feature manifest packages', allowed: new Set(['manifest', 'publisher']) }
  if (/(?:^|\/)features\/[^/]+\/server\//.test(normalizedPath))
    return { name: 'feature server', allowed: featureServerModules }
  if (/(?:^|\/)features\/[^/]+\/nuxt\//.test(normalizedPath))
    return { name: 'feature Nuxt', allowed: new Set(['nuxt']) }
  return undefined
}

function platformPackageContractCallerRole(normalizedPath: string) {
  if (normalizedPath.startsWith('packages/platform-module-nuxt/'))
    return { name: 'platform Nuxt', allowed: platformNuxtModules }
  if (normalizedPath.startsWith('packages/platform-module-server/'))
    return { name: 'platform server', allowed: featureServerModules }
  if (normalizedPath.startsWith('packages/platform-module-conformance/'))
    return { name: 'platform module conformance', allowed: publicModules }
  if (normalizedPath.startsWith('packages/platform-module-persistence-policy/'))
    return {
      name: 'platform module persistence policy',
      allowed: new Set(['identifiers', 'persistence']),
    }
  return undefined
}

function generatedRegistryContractCallerRole(normalizedPath: string) {
  const apiGeneratedPrefix = 'api/src/generated/platform/'
  if (normalizedPath.startsWith(apiGeneratedPrefix)) {
    const filename = normalizedPath.slice(apiGeneratedPrefix.length)
    const registryName = filename.slice(0, -extname(filename).length)
    return {
      name: 'generated API registry',
      allowed: apiGeneratedRegistryModules[registryName] ?? hostApiModules,
    }
  }
  if (normalizedPath.startsWith('generated/platform/'))
    return { name: 'generated Nuxt registry', allowed: new Set(['nuxt']) }
  return undefined
}

function hostContractCallerRole(normalizedPath: string) {
  if (normalizedPath.startsWith('api/')) return { name: 'API host', allowed: hostApiModules }
  if (
    normalizedPath.startsWith('app/') ||
    normalizedPath.startsWith('layers/') ||
    /^nuxt\.config\.[cm]?[jt]s$/.test(normalizedPath)
  )
    return { name: 'Nuxt host', allowed: hostNuxtModules }
  return undefined
}

function scriptContractCallerRole(normalizedPath: string) {
  if (
    normalizedPath.startsWith('scripts/module-registry/') ||
    normalizedPath === 'scripts/generate-module-registries.ts'
  )
    return { name: 'registry composition scripts', allowed: publicModules }
  if (normalizedPath.startsWith('scripts/'))
    return { name: 'repository scripts', allowed: nonCompositionModules }
  return undefined
}

function testContractCallerRole(normalizedPath: string) {
  if (
    normalizedPath.startsWith('packages/platform-module-contract/test/') ||
    normalizedPath.startsWith('tests/fixtures/platform-module-registry-types/') ||
    /^tests\/platform\/platform-module-(?:conformance|registry)\.test\.ts$/.test(normalizedPath)
  )
    return { name: 'contract compiler tests', allowed: publicModules }
  if (normalizedPath.startsWith('tests/'))
    return { name: 'repository tests', allowed: nonCompositionModules }
  return undefined
}

function localImports(path: string) {
  return platformModuleContractModuleSpecifiers(path, readFileSync(path, 'utf8')).flatMap(
    (specifier) => {
      const match = /^\.\/([a-z-]+)\.js$/.exec(specifier)
      return match?.[1] ? [match[1]] : []
    },
  )
}

export function platformModuleContractModuleSpecifiers(path: string, source: string) {
  if (extname(path) === '.vue')
    return [...source.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)].flatMap((match) =>
      match[1] ? [match[1]] : [],
    )
  return typescriptModuleSpecifiers(path, source)
}

export function isPlatformModuleContractSourcePath(path: string) {
  return sourceExtensions.has(extname(path))
}

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    if (ignoredDirectories.has(name)) return []
    const path = join(directory, name)
    let stats
    try {
      stats = statSync(path)
    } catch {
      return []
    }
    if (stats.isDirectory()) return walk(path)
    return isPlatformModuleContractSourcePath(path) ? [path] : []
  })
}

function dependencyCycles(dependencies: ReadonlyMap<string, readonly string[]>) {
  const cycles: string[][] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (name: string, path: readonly string[]) => {
    if (visiting.has(name)) {
      const start = path.indexOf(name)
      cycles.push([...path.slice(start), name])
      return
    }
    if (visited.has(name)) return
    visiting.add(name)
    for (const dependency of dependencies.get(name) ?? []) visit(dependency, [...path, name])
    visiting.delete(name)
    visited.add(name)
  }
  for (const name of dependencies.keys()) visit(name, [])
  return cycles
}

function arraysEqual(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
