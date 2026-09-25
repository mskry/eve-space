import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import ts from 'typescript'

const ROUTE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete'])
const DEFINITION_LINES = 18

export interface RouteDefinition {
  source: string
  method: string
  path: string
  excerpt: string
  middleware: readonly string[]
}

interface ExpandedRouter {
  source: string
  contents: string
  remainder: string
  inheritedMiddleware: readonly string[]
}

export const findRouteDefinition = async (
  root: URL,
  mountSources: readonly string[],
  remainder: string,
  method: string | null,
): Promise<RouteDefinition | null> => {
  const expansions = await Promise.all(
    mountSources.map((mountSource) => expandRouterSources(root, mountSource, remainder)),
  )
  const candidates = expansions
    .flat()
    .flatMap((router) =>
      definitionsIn(router).filter((candidate) => matches(candidate, router.remainder, null)),
    )

  return (
    candidates.find((candidate) => method === null || candidate.method === method) ??
    candidates[0] ??
    null
  )
}

export const applicableRouteMiddleware = (
  rootMiddleware: readonly string[],
  route: RouteDefinition | null,
) => [...new Set([...rootMiddleware, ...(route?.middleware ?? [])])]

const expandRouterSources = async (
  root: URL,
  mountSource: string,
  remainder: string,
  inheritedMiddleware: readonly string[] = [],
  ancestors: ReadonlySet<string> = new Set(),
): Promise<ExpandedRouter[]> => {
  if (ancestors.has(mountSource)) {
    return []
  }

  const source = await readSource(root, mountSource)
  const sourceFile = ts.createSourceFile(mountSource, source, ts.ScriptTarget.Latest, true)
  const imported = importedRouterSources(sourceFile, mountSource)
  const nextAncestors = new Set([...ancestors, mountSource])
  const children = childRoutesIn(sourceFile).flatMap((child) => {
    const childSource = imported.get(child.identifier)
    const childRemainder = remainderAfterMount(remainder, child.prefix)

    return childSource && childRemainder !== null
      ? [
          expandRouterSources(
            root,
            childSource,
            childRemainder,
            [...inheritedMiddleware, ...middlewareBefore(child.call, remainder)],
            nextAncestors,
          ),
        ]
      : []
  })

  return [
    { contents: source, inheritedMiddleware, remainder, source: mountSource },
    ...(await Promise.all(children)).flat(),
  ]
}

const readSource = async (root: URL, file: string) => {
  try {
    return await readFile(new URL(file, root), 'utf8')
  } catch {
    return ''
  }
}

const definitionsIn = ({
  source,
  contents,
  remainder,
  inheritedMiddleware,
}: ExpandedRouter): RouteDefinition[] => {
  const sourceFile = ts.createSourceFile(source, contents, ts.ScriptTarget.Latest, true)
  const lines = contents.split('\n')
  const definitions: RouteDefinition[] = []

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text
      const path = node.arguments[0]

      if (ROUTE_METHODS.has(method) && path && ts.isStringLiteralLike(path)) {
        const line = sourceFile.getLineAndCharacterOfPosition(path.getStart(sourceFile)).line

        definitions.push({
          excerpt: lines.slice(line, line + DEFINITION_LINES).join('\n'),
          method: method.toUpperCase(),
          middleware: [...new Set([...inheritedMiddleware, ...middlewareBefore(node, remainder)])],
          path: path.text,
          source,
        })
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  return definitions
}

const importedRouterSources = (sourceFile: ts.SourceFile, source: string) => {
  const imported = new Map<string, string>()

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      !statement.moduleSpecifier.text.startsWith('.')
    ) {
      continue
    }

    const bindings = statement.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) {
      continue
    }

    const importedSource = join(
      dirname(source),
      statement.moduleSpecifier.text.replace(/\.js$/, '.ts'),
    )
    for (const element of bindings.elements) {
      imported.set(element.name.text, importedSource)
    }
  }

  return imported
}

const childRoutesIn = (sourceFile: ts.SourceFile) => {
  const routes: Array<{ call: ts.CallExpression; prefix: string; identifier: string }> = []

  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'route' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      node.arguments[1] &&
      ts.isIdentifier(node.arguments[1])
    ) {
      routes.push({
        call: node,
        identifier: node.arguments[1].text,
        prefix: node.arguments[0].text,
      })
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return routes
}

const middlewareBefore = (target: ts.CallExpression, path: string) =>
  callChain(target)
    .slice(0, -1)
    .filter(
      (call) =>
        ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'use',
    )
    .flatMap((call) => middlewareInUse(call, path))

const callChain = (target: ts.CallExpression) => {
  const calls: ts.CallExpression[] = []
  let current: ts.Expression = target

  while (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
    calls.unshift(current)
    current = current.expression.expression
  }

  return calls
}

const middlewareInUse = (call: ts.CallExpression, path: string) => {
  const [first, ...rest] = call.arguments
  const hasPattern = Boolean(first && ts.isStringLiteralLike(first))
  const pattern = hasPattern && first && ts.isStringLiteralLike(first) ? first.text : '*'

  if (!matchesPattern(path, pattern)) {
    return []
  }

  return (hasPattern ? rest : call.arguments).flatMap((argument) => {
    const name = expressionName(argument)
    return name ? [name] : []
  })
}

const expressionName = (expression: ts.Expression): string | null => {
  if (ts.isIdentifier(expression)) {
    return expression.text
  }
  if (!ts.isCallExpression(expression)) {
    return null
  }
  if (ts.isIdentifier(expression.expression)) {
    return expression.expression.text
  }
  if (ts.isPropertyAccessExpression(expression.expression)) {
    return expression.expression.name.text
  }
  return null
}

const remainderAfterMount = (path: string, prefix: string) => {
  if (prefix === '/' || prefix === '') {
    return path
  }
  if (path === prefix) {
    return '/'
  }
  return path.startsWith(`${prefix}/`) ? path.slice(prefix.length) : null
}

const matchesPattern = (path: string, pattern: string) =>
  pattern === '*' ||
  path === pattern ||
  (pattern.endsWith('/*') && path.startsWith(pattern.slice(0, -1)))

const matches = (candidate: RouteDefinition, remainder: string, method: string | null) =>
  (method === null || candidate.method === method) &&
  routePattern(candidate.path) === routePattern(remainder)

const routePattern = (path: string) =>
  path
    .split('/')
    .filter(Boolean)
    .map((segment) => (segment.startsWith(':') ? ':' : segment))
    .join('/')
