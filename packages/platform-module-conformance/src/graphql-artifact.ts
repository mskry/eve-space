import { posix } from 'node:path'
import ts from 'typescript'
import type {
  PlatformGraphQLContribution,
  PlatformGraphQLDefinition,
  PlatformGraphQLResolver,
} from '@eve-space/platform-module-contract/graphql'
import { composeContributionSDL } from './graphql.js'

interface GraphQLArtifactView {
  read(path: string): Promise<string | undefined>
}

type StaticGraphQLValue = string | PlatformGraphQLResolver | StaticGraphQLObject
interface StaticGraphQLObject {
  readonly [key: string]: StaticGraphQLValue
}

type StaticGraphQLBinding =
  | { readonly kind: 'function' }
  | { readonly kind: 'constant'; readonly initializer: ts.Expression }

const resolverMarker = () => undefined

const propertyName = (name: ts.PropertyName): string => {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text
  throw new Error('GraphQL artifact requires literal property names')
}

const unwrap = (expression: ts.Expression): ts.Expression => {
  if (
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isParenthesizedExpression(expression)
  )
    return unwrap(expression.expression)
  return expression
}

const localBinding = (source: ts.SourceFile, name: string): StaticGraphQLBinding => {
  const callable = source.statements.some(
    (statement) =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name && !!statement.body,
  )
  if (callable) return { kind: 'function' }
  const constants = source.statements.flatMap((statement) => {
    if (
      !ts.isVariableStatement(statement) ||
      !(statement.declarationList.flags & ts.NodeFlags.Const)
    )
      return []
    return [...statement.declarationList.declarations]
  })
  const declaration = constants.find(
    (item) => ts.isIdentifier(item.name) && item.name.text === name,
  )
  if (!declaration?.initializer) throw new Error(`Unresolved static GraphQL binding ${name}`)
  return { kind: 'constant', initializer: declaration.initializer }
}

const isReadHelper = (source: ts.SourceFile, name: string): boolean =>
  source.statements.some((statement) => {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== '@eve-space/platform-module-contract/graphql'
    )
      return false
    const clause = statement.importClause
    const bindings = clause?.namedBindings
    if (clause?.isTypeOnly || !bindings || !ts.isNamedImports(bindings)) return false
    return bindings.elements.some(
      (element) =>
        !element.isTypeOnly &&
        element.name.text === name &&
        (element.propertyName?.text ?? element.name.text) === 'definePlatformGraphQLRead',
    )
  })

const identifierValue = (
  source: ts.SourceFile,
  name: string,
  visited: ReadonlySet<string>,
): StaticGraphQLValue => {
  if (visited.has(name) || visited.size >= 128) throw new Error('GraphQL binding cycle or limit')
  const binding = localBinding(source, name)
  if (binding.kind === 'function') return resolverMarker
  return literalValue(source, binding.initializer, new Set(visited).add(name))
}

const readHelperValue = (
  source: ts.SourceFile,
  value: ts.CallExpression,
  visited: ReadonlySet<string>,
): PlatformGraphQLResolver => {
  if (!ts.isIdentifier(value.expression) || !isReadHelper(source, value.expression.text))
    throw new Error('GraphQL artifact requires a static descriptor')
  const callback = value.arguments[0]
  if (
    value.arguments.length !== 1 ||
    !callback ||
    typeof literalValue(source, callback, new Set(visited)) !== 'function'
  )
    throw new Error('Invalid static GraphQL read helper callback')
  return resolverMarker
}

const literalValue = (
  source: ts.SourceFile,
  expression: ts.Expression,
  visited = new Set<string>(),
): StaticGraphQLValue => {
  const value = unwrap(expression)
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text
  if (ts.isObjectLiteralExpression(value)) return literalObject(source, value, visited)
  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return resolverMarker
  if (ts.isIdentifier(value)) return identifierValue(source, value.text, visited)
  if (ts.isCallExpression(value)) return readHelperValue(source, value, visited)
  throw new Error('GraphQL artifact requires a static descriptor')
}

const literalObject = (
  source: ts.SourceFile,
  expression: ts.ObjectLiteralExpression,
  visited: ReadonlySet<string>,
): StaticGraphQLObject => {
  const entries = expression.properties.map((property): readonly [string, StaticGraphQLValue] => {
    if (ts.isPropertyAssignment(property))
      return [
        propertyName(property.name),
        literalValue(source, property.initializer, new Set(visited)),
      ]
    if (ts.isMethodDeclaration(property)) return [propertyName(property.name), resolverMarker]
    if (ts.isShorthandPropertyAssignment(property))
      return [property.name.text, literalValue(source, property.name, new Set(visited))]
    throw new Error('GraphQL descriptor spreads and accessors are unsupported')
  })
  if (new Set(entries.map(([name]) => name)).size !== entries.length)
    throw new Error('Duplicate GraphQL descriptor key')
  return Object.fromEntries(entries)
}

const localDefinition = (
  source: ts.SourceFile,
  name: string,
): PlatformGraphQLDefinition | undefined => {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    const declaration = statement.declarationList.declarations.find(
      (item) => ts.isIdentifier(item.name) && item.name.text === name,
    )
    if (!declaration?.initializer) continue
    const value = literalValue(source, declaration.initializer, new Set([name]))
    if (
      !value ||
      typeof value !== 'object' ||
      !('typeDefs' in value) ||
      typeof value.typeDefs !== 'string' ||
      !('reads' in value) ||
      !value.reads ||
      typeof value.reads !== 'object'
    )
      throw new Error('Invalid static GraphQL definition')
    if (Object.keys(value).some((key) => key !== 'typeDefs' && key !== 'reads'))
      throw new Error('Extra static GraphQL descriptor property')
    const reads = Object.fromEntries(
      Object.entries(value.reads).map(([field, resolver]) => {
        if (typeof resolver !== 'function') throw new Error('Invalid static GraphQL resolver')
        return [field, resolver]
      }),
    )
    return { typeDefs: value.typeDefs, reads }
  }
  return undefined
}

const reexportTarget = (statement: ts.Statement, path: string, name: string) => {
  if (
    !ts.isExportDeclaration(statement) ||
    !statement.moduleSpecifier ||
    !ts.isStringLiteral(statement.moduleSpecifier)
  )
    return undefined
  const specifier = statement.moduleSpecifier.text
  if (!specifier.startsWith('.')) return undefined
  let originalName = name
  if (statement.exportClause) {
    if (!ts.isNamedExports(statement.exportClause)) return undefined
    const exported = statement.exportClause.elements.find((element) => element.name.text === name)
    if (!exported) return undefined
    originalName = exported.propertyName?.text ?? exported.name.text
  }
  const target = posix.normalize(posix.join(posix.dirname(path), specifier))
  if (target.startsWith('../')) throw new Error('GraphQL descriptor export escapes package')
  return { target, originalName, wildcard: !statement.exportClause }
}

const resolveDefinition = async (
  view: GraphQLArtifactView,
  path: string,
  name: string,
  ancestors: ReadonlySet<string> = new Set(),
  budget = { remaining: 128 },
): Promise<PlatformGraphQLDefinition | undefined> => {
  const identity = `${path}:${name}`
  if (ancestors.has(identity) || --budget.remaining < 0)
    throw new Error('GraphQL descriptor export cycle or limit')
  const visited = new Set(ancestors).add(identity)
  const text = await view.read(path)
  if (text === undefined) throw new Error('Missing GraphQL descriptor artifact')
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
  const local = localDefinition(source, name)
  if (local) return local
  for (const statement of source.statements) {
    const reexport = reexportTarget(statement, path, name)
    if (!reexport) continue
    // oxlint-disable-next-line no-await-in-loop -- Inspect re-export targets deterministically without executing modules.
    const definition = await resolveDefinition(
      view,
      reexport.target,
      reexport.originalName,
      visited,
      budget,
    )
    if (definition) return definition
    if (!reexport.wildcard) throw new Error('Missing GraphQL descriptor export')
  }
  return undefined
}

export const readGraphQLArtifactContributions = async (
  view: GraphQLArtifactView,
  rootEntry: string,
  contributions: readonly PlatformGraphQLContribution[],
) => {
  const resolved = await Promise.all(
    contributions.map(async (contribution) => {
      const definition = await resolveDefinition(view, rootEntry, contribution.exportName)
      if (!definition) throw new Error('Missing GraphQL descriptor export')
      return { ...contribution, definition }
    }),
  )
  composeContributionSDL(resolved)
  return resolved
}
