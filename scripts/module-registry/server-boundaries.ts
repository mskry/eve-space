import ts from 'typescript'

export interface ModuleServerSource {
  readonly path: string
  readonly source: string
}

export function moduleServerImportViolations(sources: readonly ModuleServerSource[]) {
  const violations: string[] = []
  for (const { path, source } of sources) {
    for (const specifier of moduleSpecifiers(path, source)) {
      const normalized = specifier.replaceAll('\\', '/')
      if (
        normalized === '@eve-space/api' ||
        normalized.startsWith('@eve-space/api/') ||
        /(?:^|\/)api\/src(?:\/|$)/.test(normalized)
      )
        violations.push(`${path}: feature server code cannot import core API source ${specifier}`)
    }
  }
  return violations.toSorted((left, right) => left.localeCompare(right))
}

function moduleSpecifiers(path: string, source: string) {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  const specifiers: string[] = []

  visit(sourceFile, (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      specifiers.push(node.moduleSpecifier.text)
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      ts.isStringLiteral(node.arguments[0])
    )
      specifiers.push(node.arguments[0].text)
  })

  return specifiers
}

function visit(node: ts.Node, operation: (node: ts.Node) => void) {
  operation(node)
  ts.forEachChild(node, (child) => visit(child, operation))
}
