import ts from 'typescript'
import type { TypeScriptSource } from '../typescript-source-directory.js'

const VALIDATION_WRAPPER = 'api/src/http/validation.ts'
const VALIDATION_SPECIFIER = 'http/validation.js'
const VALIDATOR_EXPORT = 'zValidator'

const COOKIE_OWNER = 'api/src/http/auth-cookie.ts'
const COOKIE_SPECIFIER = 'hono/cookie'

const NOT_FOUND_METHOD = 'notFound'

export const apiHttpBoundaryViolations = (sources: readonly TypeScriptSource[]) =>
  sources
    .flatMap((source) => sourceViolations(source))
    .toSorted((left, right) => left.localeCompare(right))

const sourceViolations = ({ path, source }: TypeScriptSource) => {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  const violations: string[] = []

  const visit = (node: ts.Node) => {
    violations.push(
      ...importViolations(path, node, sourceFile),
      ...untypedNotFoundViolations(path, node, sourceFile),
    )
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  return violations
}

const importViolations = (path: string, node: ts.Node, sourceFile: ts.SourceFile) => {
  if (!ts.isImportDeclaration(node) || !ts.isStringLiteralLike(node.moduleSpecifier)) return []

  const specifier = node.moduleSpecifier.text
  const location = `${path}:${lineOf(node, sourceFile)}`

  if (specifier === COOKIE_SPECIFIER && normalize(path) !== COOKIE_OWNER)
    return [
      `${location}: imports ${COOKIE_SPECIFIER} directly; set, read, and delete cookies through ${COOKIE_OWNER} so HttpOnly, SameSite, Secure, and the __Host- prefix are preserved`,
    ]

  if (
    importsBinding(node, VALIDATOR_EXPORT) &&
    normalize(path) !== VALIDATION_WRAPPER &&
    !specifier.endsWith(VALIDATION_SPECIFIER)
  )
    return [
      `${location}: imports ${VALIDATOR_EXPORT} from '${specifier}'; use the wrapper in ${VALIDATION_WRAPPER} so validation failures keep the API's JSON error contract`,
    ]

  return []
}

const untypedNotFoundViolations = (path: string, node: ts.Node, sourceFile: ts.SourceFile) =>
  ts.isCallExpression(node) &&
  ts.isPropertyAccessExpression(node.expression) &&
  node.expression.name.text === NOT_FOUND_METHOD &&
  node.arguments.length === 0
    ? [
        `${path}:${lineOf(node, sourceFile)}: returns context.${NOT_FOUND_METHOD}(); return an explicit JSON status so the outcome stays in the typed route contract`,
      ]
    : []

const importsBinding = (node: ts.ImportDeclaration, binding: string) => {
  const bindings = node.importClause?.namedBindings

  return Boolean(
    bindings &&
    ts.isNamedImports(bindings) &&
    bindings.elements.some((element) => (element.propertyName ?? element.name).text === binding),
  )
}

const lineOf = (node: ts.Node, sourceFile: ts.SourceFile) =>
  sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1

const normalize = (path: string) => path.replaceAll('\\', '/')
