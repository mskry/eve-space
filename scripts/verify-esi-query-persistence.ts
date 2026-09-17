import { readFile, readdir } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PlatformQueryAdmissionScopeDescriptor } from '@eve-space/platform-module-contract/nuxt'
import { platformOrganizationAdmissionScope } from '@eve-space/platform-module-contract/server'
import { installedNuxtContributions } from '../generated/platform/installed-nuxt-contributions.js'
import ts from 'typescript'

export interface EsiQuerySource {
  readonly kind: 'core' | 'module'
  readonly path: string
  readonly source: string
}

type InstalledScope = PlatformQueryAdmissionScopeDescriptor & { readonly moduleId: string }

const SYSTEM_STATUS_QUERY_PATH = 'app/queries/system-status.ts'

export function esiQueryPersistenceViolations(
  sources: readonly EsiQuerySource[],
  scopes: readonly InstalledScope[],
) {
  const violations = scopes.flatMap(validateScope)
  for (const source of sources) {
    const sourceFile = ts.createSourceFile(
      source.path,
      source.source,
      ts.ScriptTarget.Latest,
      true,
      source.path.endsWith('.vue') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    visit(sourceFile, (node) => {
      violations.push(...validateEsiQueryCall(source, node, scopes))
    })
  }
  return violations
}

export function queryAutoRefetchViolations(sources: readonly EsiQuerySource[]) {
  const violations: string[] = []
  let systemStatusOptIns = 0

  for (const source of sources) {
    const sourceFile = ts.createSourceFile(
      source.path,
      source.source,
      ts.ScriptTarget.Latest,
      true,
      source.path.endsWith('.vue') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    visit(sourceFile, (node) => {
      if (
        !ts.isPropertyAssignment(node) ||
        !ts.isIdentifier(node.name) ||
        node.name.text !== 'autoRefetch'
      ) {
        return
      }
      if (source.path !== SYSTEM_STATUS_QUERY_PATH) {
        violations.push(`${source.path} must not enable query auto-refetch`)
      } else if (node.initializer.kind !== ts.SyntaxKind.TrueKeyword) {
        violations.push(`${SYSTEM_STATUS_QUERY_PATH} must enable auto-refetch with true`)
      } else {
        systemStatusOptIns += 1
      }
    })
  }

  if (systemStatusOptIns !== 1) {
    violations.push(`${SYSTEM_STATUS_QUERY_PATH} must contain the sole query auto-refetch opt-in`)
  }
  return violations
}

function validateEsiQueryCall(
  source: EsiQuerySource,
  node: ts.Node,
  scopes: readonly InstalledScope[],
) {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return []

  const callName = node.expression.text
  if (source.kind === 'module') {
    return moduleQueryPersistenceViolations(source, node, callName, scopes)
  }
  if (callName === 'defineQueryOptions') {
    return [`${source.path} must use defineEsiQueryOptions for query definitions`]
  }
  if (callName !== 'defineEsiQueryOptions') return []

  const declaration = node.arguments[0]
  return !declaration || !containsProperty(declaration, 'esiPersistence')
    ? [`${source.path} has a query without an ESI persistence declaration`]
    : []
}

function moduleQueryPersistenceViolations(
  source: EsiQuerySource,
  node: ts.CallExpression,
  callName: string,
  scopes: readonly InstalledScope[],
) {
  const violations: string[] = []
  if (callName === 'usePlatformProtectedQuery') {
    violations.push(...platformProtectedQueryViolations(source, node, scopes))
  }
  if (
    callName === 'defineEsiQueryOptions' ||
    (callName === 'useQuery' && containsProperty(node, 'esiPersistence'))
  ) {
    violations.push(`${source.path} must not define module persistence outside the platform seam`)
  }
  return violations
}

function platformProtectedQueryViolations(
  source: EsiQuerySource,
  node: ts.CallExpression,
  scopes: readonly InstalledScope[],
) {
  const declaration = node.arguments[0]
  if (!declaration) {
    return [`${source.path} must declare literal moduleId and routeId values`]
  }

  const moduleId = findStringProperty(declaration, 'moduleId')
  const routeId = findStringProperty(declaration, 'routeId')
  if (!moduleId || !routeId) {
    return [`${source.path} must declare literal moduleId and routeId values`]
  }

  const authorization = findPlatformQueryAuthorization(declaration)
  if (!authorization) {
    return [`${source.path} must declare a literal supported platform query subject`]
  }

  const persistenceKind = findEsiPersistenceKind(declaration)
  if (persistenceKind !== 'none' && persistenceKind !== 'organization-esi') {
    return [`${source.path} has a module query without an ESI persistence declaration`]
  }

  const violations: string[] = []
  if (
    !scopes.some(
      (scope) =>
        scope.moduleId === moduleId &&
        scope.routeId === routeId &&
        scope.authorization === authorization,
    )
  ) {
    violations.push(`${source.path} uses unauthorized query admission route ${moduleId}/${routeId}`)
  }
  if (persistenceKind === 'organization-esi' && authorization !== 'authenticated-session') {
    violations.push(
      `${source.path} cannot persist ${moduleId}/${routeId} without organization authorization`,
    )
  }
  return violations
}

function validateScope(scope: InstalledScope) {
  const expected = platformOrganizationAdmissionScope(scope.moduleId, scope)
  return scope.admissionScope === expected
    ? []
    : [`Generated query admission scope ${scope.moduleId}/${scope.routeId} is incoherent`]
}

function visit(node: ts.Node, callback: (node: ts.Node) => void) {
  callback(node)
  node.forEachChild((child) => visit(child, callback))
}

function containsProperty(node: ts.Node, propertyName: string) {
  let found = false
  visit(node, (candidate) => {
    if (
      ts.isPropertyAssignment(candidate) &&
      ts.isIdentifier(candidate.name) &&
      candidate.name.text === propertyName
    )
      found = true
  })
  return found
}

function findStringProperty(node: ts.Node, propertyName: string) {
  let value: string | undefined
  visit(node, (candidate) => {
    if (
      value === undefined &&
      ts.isPropertyAssignment(candidate) &&
      ts.isIdentifier(candidate.name) &&
      candidate.name.text === propertyName &&
      ts.isStringLiteral(candidate.initializer)
    )
      value = candidate.initializer.text
  })
  return value
}

function findPlatformQueryAuthorization(node: ts.Node) {
  let subjectKind: string | undefined
  visit(node, (candidate) => {
    if (
      subjectKind === undefined &&
      ts.isPropertyAssignment(candidate) &&
      ts.isIdentifier(candidate.name) &&
      candidate.name.text === 'subject' &&
      ts.isObjectLiteralExpression(candidate.initializer)
    ) {
      subjectKind = findStringProperty(candidate.initializer, 'kind')
    }
  })
  if (subjectKind === 'character') return 'owned-character'
  if (subjectKind === 'organization' || subjectKind === 'corporation' || subjectKind === 'alliance')
    return 'authenticated-session'
  return undefined
}

function findEsiPersistenceKind(node: ts.Node) {
  let kind: string | undefined
  visit(node, (candidate) => {
    if (
      kind === undefined &&
      ts.isPropertyAssignment(candidate) &&
      ts.isIdentifier(candidate.name) &&
      candidate.name.text === 'esiPersistence' &&
      ts.isObjectLiteralExpression(candidate.initializer)
    ) {
      kind = findStringProperty(candidate.initializer, 'kind')
    }
  })
  return kind
}

async function loadSources(root: string) {
  const corePaths = (await listSourceFiles(join(root, 'app/queries'))).filter(
    (path) => !path.endsWith('query-keys.ts') && !path.endsWith('query-policy.ts'),
  )
  const modulePaths = (await listSourceFiles(join(root, 'features'))).filter(
    (path) => path.includes('/nuxt/src/') && !path.endsWith('.d.ts'),
  )
  return Promise.all([
    ...corePaths.map(async (path) => ({
      kind: 'core' as const,
      path: relative(root, path),
      source: await readFile(path, 'utf8'),
    })),
    ...modulePaths.map(async (path) => ({
      kind: 'module' as const,
      path: relative(root, path),
      source: await readFile(path, 'utf8'),
    })),
  ])
}

async function listSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const paths = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? listSourceFiles(path) : Promise.resolve([path])
    }),
  )
  return paths.flat().filter((path) => ['.ts', '.vue'].includes(extname(path)))
}

const isEntryPoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isEntryPoint) {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const scopes = installedNuxtContributions.flatMap((contribution) =>
    contribution.queryAdmissionScopes.map((scope) => ({
      moduleId: contribution.moduleId,
      ...scope,
    })),
  )
  const sources = await loadSources(root)
  const violations = [
    ...esiQueryPersistenceViolations(sources, scopes),
    ...queryAutoRefetchViolations(sources),
  ]
  if (violations.length)
    throw new Error(`ESI query persistence verification failed:\n${violations.join('\n')}`)
}
