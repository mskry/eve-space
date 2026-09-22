import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import ts from 'typescript'
import { loadTypescriptSourceDirectory } from '../typescript-source-directory.js'

const COMPOSITION_FILE = 'api/src/platform/module-route-composition.ts'
const REVIEW_ALL_FILES = new Set([
  COMPOSITION_FILE,
  'packages/platform-module-contract/src/manifest.ts',
  'packages/platform-module-contract/src/permissions.ts',
  'packages/platform-module-contract/src/server.ts',
])

type OptionalText = string | null

interface PlatformContractDeclaration {
  readonly id: string
  readonly namespace: OptionalText
  readonly exportName: OptionalText
  readonly authorization: OptionalText
  readonly audience: OptionalText
  readonly requiredPermission: OptionalText
  readonly sectionId: OptionalText
  readonly target: OptionalText
  readonly exposure: OptionalText
  readonly code: string
}

export interface PlatformContractEvidence {
  readonly id: string
  readonly moduleId: string
  readonly manifestFile: string
  readonly manifestLine: number
  readonly route: PlatformContractDeclaration
  readonly permission: string | null
  readonly section: string | null
  readonly reviewerContribution: string | null
  readonly implementation: {
    readonly file: string | null
    readonly line: number | null
    readonly code: string | null
  }
  readonly composition: string
}

interface ManifestIndex {
  readonly moduleId: string
  readonly routes: readonly IndexedObject[]
  readonly permissions: readonly IndexedObject[]
  readonly sections: readonly IndexedObject[]
  readonly reviewerContributions: readonly IndexedObject[]
}

interface IndexedObject {
  readonly node: ts.ObjectLiteralExpression
  readonly code: string
  readonly line: number
}

interface RouteImplementation {
  readonly file: string
  readonly line: number
  readonly code: string
}

export async function collectPlatformContractEvidence(
  repository: URL,
  root: string,
  changedFiles: readonly string[],
): Promise<PlatformContractEvidence[]> {
  const moduleIds = await changedModuleIds(repository, changedFiles)
  const composition = await readRepositoryFile(repository, COMPOSITION_FILE)
  const compositionFunctions = namedFunctionsIn(COMPOSITION_FILE, composition)
  const evidence = await Promise.all(
    moduleIds.map((moduleId) =>
      evidenceForModule(repository, root, moduleId, compositionFunctions),
    ),
  )
  return evidence.flat().toSorted((left, right) => left.id.localeCompare(right.id))
}

function isPlatformContractSource(file: string) {
  return /^features\/[^/]+\/(module\.config\.ts|server\/src\/.*\.ts)$/.test(file)
}

async function changedModuleIds(repository: URL, changedFiles: readonly string[]) {
  if (changedFiles.some((file) => REVIEW_ALL_FILES.has(file))) return installedModuleIds(repository)
  const ids = new Set<string>()
  for (const file of changedFiles) {
    if (!isPlatformContractSource(file)) continue
    const moduleId = file.split('/')[1]
    if (moduleId) ids.add(moduleId)
  }
  return [...ids].toSorted((left, right) => left.localeCompare(right))
}

async function installedModuleIds(repository: URL) {
  const entries = await readdir(new URL('features/', repository), { withFileTypes: true })
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const source = await readRepositoryFile(
          repository,
          `features/${entry.name}/module.config.ts`,
        )
        return source ? entry.name : null
      }),
  )
  return candidates
    .filter((value): value is string => value !== null)
    .toSorted((left, right) => left.localeCompare(right))
}

async function evidenceForModule(
  repository: URL,
  root: string,
  moduleId: string,
  compositionFunctions: ReadonlyMap<string, RouteImplementation>,
) {
  const manifestFile = `features/${moduleId}/module.config.ts`
  const manifestSource = await readRepositoryFile(repository, manifestFile)
  const manifest = indexManifest(manifestFile, manifestSource)
  if (!manifest) return []
  const implementations = await loadRouteImplementations(root, moduleId)
  return manifest.routes.map((route) =>
    routeEvidence(manifestFile, manifest, route, implementations, compositionFunctions),
  )
}

function routeEvidence(
  manifestFile: string,
  manifest: ManifestIndex,
  indexedRoute: IndexedObject,
  implementations: ReadonlyMap<string, RouteImplementation>,
  compositionFunctions: ReadonlyMap<string, RouteImplementation>,
): PlatformContractEvidence {
  const route = declarationFrom(indexedRoute)
  const permission = manifest.permissions.find(
    (item) => propertyText(item.node, 'key') === route.requiredPermission,
  )
  const section = manifest.sections.find(
    (item) => propertyText(item.node, 'id') === route.sectionId,
  )
  const reviewerContribution = manifest.reviewerContributions.find(
    (item) => propertyText(item.node, 'routeId') === route.id,
  )
  const implementation = route.exportName ? implementations.get(route.exportName) : undefined
  const composition = compositionFor(route, Boolean(reviewerContribution), compositionFunctions)
  return {
    id: `${manifest.moduleId}:${route.id}`,
    moduleId: manifest.moduleId,
    manifestFile,
    manifestLine: indexedRoute.line,
    route,
    permission: permission?.code ?? null,
    section: section?.code ?? null,
    reviewerContribution: reviewerContribution?.code ?? null,
    implementation: implementation ?? { file: null, line: null, code: null },
    composition,
  }
}

function declarationFrom(route: IndexedObject): PlatformContractDeclaration {
  return {
    id: propertyText(route.node, 'id') ?? '<unknown-route>',
    namespace: propertyText(route.node, 'namespace'),
    exportName: propertyText(route.node, 'exportName'),
    authorization: propertyText(route.node, 'authorization'),
    audience: propertyText(route.node, 'audience'),
    requiredPermission: propertyText(route.node, 'requiredPermission'),
    sectionId: propertyText(route.node, 'sectionId'),
    target: propertyText(route.node, 'target'),
    exposure: propertyText(route.node, 'exposure'),
    code: route.code,
  }
}

function compositionFor(
  route: PlatformContractDeclaration,
  reviewerContribution: boolean,
  functions: ReadonlyMap<string, RouteImplementation>,
) {
  const names = reviewerContribution
    ? ['composePlatformReviewerContributionRoute', 'composeReviewerTargetModuleRoute']
    : [composerNameFor(route)]
  return names
    .map((name) => functions.get(name)?.code)
    .filter((code): code is string => Boolean(code))
    .join('\n\n')
}

function composerNameFor(route: PlatformContractDeclaration) {
  if (route.target === 'managed-organization-account-search')
    return 'composeReviewerSearchModuleRoute'
  if (
    route.target === 'managed-organization-account' ||
    route.target === 'managed-organization-character'
  )
    return 'composeReviewerTargetModuleRoute'
  if (route.authorization === 'owned-character') return 'composeOwnedCharacterModuleRoute'
  return 'composeAuthenticatedSessionModuleRoute'
}

async function loadRouteImplementations(root: string, moduleId: string) {
  const directory = join(root, 'features', moduleId, 'server', 'src')
  try {
    const sources = await loadTypescriptSourceDirectory(root, directory)
    const implementations = new Map<string, RouteImplementation>()
    for (const { path, source } of sources) {
      for (const [name, implementation] of namedFunctionsIn(path, source))
        implementations.set(name, implementation)
    }
    return implementations
  } catch {
    return new Map<string, RouteImplementation>()
  }
}

function indexManifest(file: string, source: string): ManifestIndex | null {
  if (!source) return null
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const manifest = manifestObject(sourceFile)
  if (!manifest) return null
  const server = objectProperty(manifest, 'server')
  return {
    moduleId: propertyText(manifest, 'id') ?? file.split('/')[1] ?? '<unknown-module>',
    routes: server ? indexedArray(sourceFile, server, 'routes') : [],
    permissions: indexedArray(sourceFile, manifest, 'permissions'),
    sections: indexedArray(sourceFile, manifest, 'sections'),
    reviewerContributions: indexedArray(sourceFile, manifest, 'reviewerContributions'),
  }
}

function manifestObject(sourceFile: ts.SourceFile) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'manifest') continue
      const value = unwrapExpression(declaration.initializer)
      if (value && ts.isObjectLiteralExpression(value)) return value
    }
  }
  return null
}

function indexedArray(sourceFile: ts.SourceFile, object: ts.ObjectLiteralExpression, name: string) {
  const array = arrayProperty(object, name)
  if (!array) return []
  return array.elements.flatMap((element) => {
    const value = unwrapExpression(element)
    if (!value || !ts.isObjectLiteralExpression(value)) return []
    return {
      node: value,
      code: value.getText(sourceFile),
      line: sourceFile.getLineAndCharacterOfPosition(value.getStart(sourceFile)).line + 1,
    }
  })
}

function namedFunctionsIn(file: string, source: string) {
  const functions = new Map<string, RouteImplementation>()
  if (!source) return functions
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  visit(sourceFile, (node) => {
    if (!ts.isFunctionDeclaration(node) || !node.name) return
    functions.set(node.name.text, {
      file,
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
      code: node.getText(sourceFile),
    })
  })
  return functions
}

function propertyText(object: ts.ObjectLiteralExpression, name: string) {
  const value = propertyValue(object, name)
  return value && ts.isStringLiteralLike(value) ? value.text : null
}

function objectProperty(object: ts.ObjectLiteralExpression, name: string) {
  const value = propertyValue(object, name)
  return value && ts.isObjectLiteralExpression(value) ? value : null
}

function arrayProperty(object: ts.ObjectLiteralExpression, name: string) {
  const value = propertyValue(object, name)
  return value && ts.isArrayLiteralExpression(value) ? value : null
}

function propertyValue(object: ts.ObjectLiteralExpression, name: string) {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) || propertyName(property.name) !== name) continue
    return unwrapExpression(property.initializer)
  }
  return null
}

function propertyName(name: ts.PropertyName) {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : null
}

function unwrapExpression(expression: ts.Expression | undefined): ts.Expression | undefined {
  let current = expression
  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isNonNullExpression(current))
  )
    current = current.expression
  return current
}

async function readRepositoryFile(repository: URL, file: string) {
  try {
    return await readFile(new URL(file, repository), 'utf8')
  } catch {
    return ''
  }
}

function visit(node: ts.Node, operation: (node: ts.Node) => void) {
  operation(node)
  ts.forEachChild(node, (child) => visit(child, operation))
}
