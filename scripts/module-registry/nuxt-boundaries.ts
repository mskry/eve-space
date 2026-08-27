import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import ts from 'typescript'

export interface ModuleNuxtSource {
  readonly moduleId: string
  readonly path: string
  readonly source: string
}

const sourceExtensions = new Set(['.js', '.mjs', '.mts', '.ts', '.tsx', '.vue'])
const serverOnlyDependencyPattern =
  /^(?:@eve-space\/(?:api|platform-module-server|.+-server)|(?:node:)?(?:fs|child_process|net|tls|http|https)|postgres|drizzle-orm)(?:\/|$)/

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
    .flatMap((source) => sourceViolations(source))
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

function sourceViolations(source: ModuleNuxtSource) {
  const violations: string[] = []
  const runtimePath = `/nuxt/src/runtime/app/`
  const isModuleSetup = /\/nuxt\/src\/module\.(?:[cm]?[jt]s)$/.test(source.path)
  if (!source.path.includes(runtimePath) && !isModuleSetup)
    violations.push(`${source.path}: Nuxt source must live under src/runtime/app`)

  const sourceFile = ts.createSourceFile(source.path, source.source, ts.ScriptTarget.Latest, true)
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue
    const specifier = statement.moduleSpecifier.text
    if (specifier.startsWith('~/') || specifier.startsWith('@/') || specifier.startsWith('#app/'))
      violations.push(
        `${source.path}: Nuxt runtime imports must use relative paths, #imports, or #components`,
      )
    if (
      source.path.includes(runtimePath) &&
      specifier.startsWith('#') &&
      !['#imports', '#components'].includes(specifier)
    )
      violations.push(
        `${source.path}: Nuxt runtime imports may only use #imports or #components aliases`,
      )
    if (serverOnlyDependencyPattern.test(specifier))
      violations.push(
        `${source.path}: Nuxt module imports deployment or server-only dependency ${specifier}`,
      )
  }

  visit(sourceFile, (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      ts.isStringLiteral(node.arguments[0]) &&
      serverOnlyDependencyPattern.test(node.arguments[0].text)
    )
      violations.push(
        `${source.path}: Nuxt module imports deployment or server-only dependency ${node.arguments[0].text}`,
      )
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return
    if (
      node.expression.text === 'addServerHandler' ||
      (isModuleSetup && ['fetch', '$fetch', 'installModule'].includes(node.expression.text))
    )
      violations.push(`${source.path}: Nuxt module setup must not call ${node.expression.text}`)
  })
  return violations
}

async function directoryExists(path: string) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

function visit(node: ts.Node, operation: (node: ts.Node) => void) {
  operation(node)
  ts.forEachChild(node, (child) => visit(child, operation))
}
