import ts from 'typescript'
import { unwrapExpression } from './typescript-expressions.js'

const globalObjects = new Set(['globalThis', 'global', 'self', 'window'])

export function forbiddenGlobalReferences(
  sourceFile: ts.SourceFile,
  forbidden: ReadonlySet<string>,
) {
  const options: ts.CompilerOptions = { noLib: true, noResolve: true, allowJs: true }
  const host = ts.createCompilerHost(options)
  host.getSourceFile = (name) => (name === sourceFile.fileName ? sourceFile : undefined)
  const checker = ts.createProgram([sourceFile.fileName], options, host).getTypeChecker()
  const references = new Set<string>()
  collectForbiddenReferences(sourceFile, checker, forbidden, references)
  return references
}

function collectForbiddenReferences(
  node: ts.Node,
  checker: ts.TypeChecker,
  forbidden: ReadonlySet<string>,
  references: Set<string>,
) {
  if (ts.isTypeNode(node)) return
  const name = forbiddenReferenceName(node, checker)
  if (name && forbidden.has(name)) references.add(name)
  if (
    ts.isVariableDeclaration(node) &&
    ts.isObjectBindingPattern(node.name) &&
    node.initializer &&
    isGlobalObject(node.initializer, checker)
  )
    for (const element of node.name.elements) {
      const key = element.propertyName ?? element.name
      if ((ts.isIdentifier(key) || ts.isStringLiteral(key)) && forbidden.has(key.text))
        references.add(key.text)
    }
  ts.forEachChild(node, (child) =>
    collectForbiddenReferences(child, checker, forbidden, references),
  )
}

function forbiddenReferenceName(node: ts.Node, checker: ts.TypeChecker) {
  if (ts.isPropertyAccessExpression(node) && isGlobalObject(node.expression, checker))
    return node.name.text
  if (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteralLike(node.argumentExpression) &&
    isGlobalObject(node.expression, checker)
  )
    return node.argumentExpression.text
  if (!ts.isIdentifier(node) || !isValueReference(node)) return undefined
  const symbol = ts.isShorthandPropertyAssignment(node.parent)
    ? checker.getShorthandAssignmentValueSymbol(node.parent)
    : checker.getSymbolAtLocation(node)
  return symbol?.declarations?.length ? undefined : node.text
}

function isValueReference(node: ts.Identifier) {
  const parent = node.parent
  if (ts.isShorthandPropertyAssignment(parent)) return true
  if (ts.isPropertyAccessExpression(parent)) return parent.expression === node
  if (ts.isBindingElement(parent)) return parent.initializer === node
  if (ts.isPropertyAssignment(parent)) return parent.initializer === node
  return !('name' in parent && parent.name === node)
}

function isGlobalObject(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  seen = new Set<ts.Symbol>(),
): boolean {
  expression = unwrapExpression(expression)
  if (!ts.isIdentifier(expression)) return false
  const symbol = checker.getSymbolAtLocation(expression)
  if (!symbol?.declarations?.length) return globalObjects.has(expression.text)
  if (seen.has(symbol)) return false
  seen.add(symbol)
  return symbol.declarations.some(
    (declaration) =>
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer &&
      isGlobalObject(declaration.initializer, checker, seen),
  )
}
