import { posix } from 'node:path'
import ts from 'typescript'
import type { PlatformInventoryProviderDeclaration } from '@eve-space/platform-module-contract/inventory'

interface InventoryArtifactView {
  read(path: string): Promise<string | undefined>
}

const callable = (
  source: ts.SourceFile,
  value: ts.Expression,
  visited = new Set<string>(),
): boolean => {
  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return true
  if (
    ts.isParenthesizedExpression(value) ||
    ts.isAsExpression(value) ||
    ts.isSatisfiesExpression(value)
  )
    return callable(source, value.expression, visited)
  if (!ts.isIdentifier(value) || visited.has(value.text) || visited.size >= 128) return false
  const ancestors = new Set(visited).add(value.text)
  if (
    source.statements.some(
      (statement) =>
        ts.isFunctionDeclaration(statement) &&
        statement.name?.text === value.text &&
        !!statement.body,
    )
  )
    return true
  const declaration = source.statements
    .flatMap((statement) =>
      ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Const
        ? [...statement.declarationList.declarations]
        : [],
    )
    .find((item) => ts.isIdentifier(item.name) && item.name.text === value.text)
  return !!declaration?.initializer && callable(source, declaration.initializer, ancestors)
}

const factoryInitializer = (source: ts.SourceFile, initializer: ts.Expression): boolean => {
  if (callable(source, initializer)) return true
  if (
    !ts.isCallExpression(initializer) ||
    !ts.isIdentifier(initializer.expression) ||
    initializer.arguments.length !== 1
  )
    return false
  const localName = initializer.expression.text
  const importedHelper = source.statements.some((statement) => {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== '@eve-space/platform-module-contract/inventory'
    )
      return false
    const bindings = statement.importClause?.namedBindings
    return (
      !statement.importClause?.isTypeOnly &&
      bindings &&
      ts.isNamedImports(bindings) &&
      bindings.elements.some(
        (element) =>
          !element.isTypeOnly &&
          element.name.text === localName &&
          (element.propertyName?.text ?? element.name.text) === 'definePlatformInventoryProvider',
      )
    )
  })
  return !!importedHelper && callable(source, initializer.arguments[0]!)
}

const localFactory = (source: ts.SourceFile, name: string): boolean | undefined => {
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name)
      return !!statement.body
    if (!ts.isVariableStatement(statement)) continue
    const declaration = statement.declarationList.declarations.find(
      (item) => ts.isIdentifier(item.name) && item.name.text === name,
    )
    if (!declaration) continue
    return (
      !!(statement.declarationList.flags & ts.NodeFlags.Const) &&
      !!declaration.initializer &&
      factoryInitializer(source, declaration.initializer)
    )
  }
  return undefined
}

const exportTargets = (source: ts.SourceFile, path: string, name: string) =>
  source.statements.flatMap((statement) => {
    if (
      !ts.isExportDeclaration(statement) ||
      !statement.moduleSpecifier ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.moduleSpecifier.text.startsWith('.')
    )
      return []
    const clause = statement.exportClause
    if (clause && !ts.isNamedExports(clause)) return []
    const exported = clause?.elements.find((element) => element.name.text === name)
    if (clause && !exported) return []
    const target = posix.normalize(posix.join(posix.dirname(path), statement.moduleSpecifier.text))
    if (target.startsWith('../')) throw new Error('Inventory factory escapes package')
    return [{ path: target, name: exported?.propertyName?.text ?? name }]
  })

const inspectFactory = async (
  view: InventoryArtifactView,
  path: string,
  name: string,
  ancestors: ReadonlySet<string> = new Set(),
  budget = { remaining: 128 },
): Promise<boolean> => {
  const identity = `${path}:${name}`
  if (ancestors.has(identity) || --budget.remaining < 0)
    throw new Error('Inventory factory export cycle or limit')
  const text = await view.read(path)
  if (text === undefined) throw new Error('Missing inventory factory artifact')
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
  const local = localFactory(source, name)
  if (local !== undefined) {
    if (!local) throw new Error('Inventory provider export must be a static callable factory')
    return true
  }
  const visited = new Set(ancestors).add(identity)
  for (const target of exportTargets(source, path, name)) {
    // oxlint-disable-next-line no-await-in-loop -- Bound and inspect exports without executing package code.
    const found = await inspectFactory(view, target.path, target.name, visited, budget)
    if (found) return true
  }
  return false
}

export const validateInventoryProviderArtifacts = async (
  view: InventoryArtifactView,
  rootEntry: string,
  providers: readonly PlatformInventoryProviderDeclaration[],
) => {
  await Promise.all(
    providers.map(async ({ exportName }) => {
      if (!(await inspectFactory(view, rootEntry, exportName)))
        throw new Error('Missing inventory provider factory export')
    }),
  )
}
