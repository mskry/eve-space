import ts from 'typescript'
import type { TypeScriptSource } from '../typescript-source-directory.js'

const ROUTE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete'])
const CHARACTER_PARAMETER = ':characterId'
const OWNERSHIP_MIDDLEWARE = 'loadOwnedCharacter'
const SESSION_MIDDLEWARE = 'loadSession'
const PARAM_VALIDATOR = 'zValidator'

// Character-ID-scoped routes that are gated by something other than character ownership.
// Keep exact membership here rather than in prose, and state why each one differs.
const ALTERNATIVE_GATES: Record<string, string | null> = {
  // Unauthenticated character profile. Ownership must never gate it.
  'api/src/characters/public-routes.ts': null,
  // HR reviewers act on another member's character, so ownership cannot apply.
  'api/src/organization/routes-review.ts': 'requireOrganizationHr',
}

interface RouteDefinition {
  path: string
  method: string
  line: number
  gates: readonly string[]
  validatedTargets: readonly string[]
}

export const characterRouteOwnershipViolations = (sources: readonly TypeScriptSource[]) =>
  sources
    .flatMap((source) =>
      characterRoutesIn(source).flatMap((route) => routeViolations(source.path, route)),
    )
    .toSorted((left, right) => left.localeCompare(right))

const characterRoutesIn = ({ path, source }: TypeScriptSource): RouteDefinition[] => {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  const routes: RouteDefinition[] = []

  const visit = (node: ts.Node) => {
    const route = toRouteDefinition(node, sourceFile)

    if (route?.path.includes(CHARACTER_PARAMETER)) routes.push(route)

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  return routes
}

const toRouteDefinition = (
  node: ts.Node,
  sourceFile: ts.SourceFile,
): RouteDefinition | undefined => {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression))
    return undefined

  const method = node.expression.name.text
  const [first, ...rest] = node.arguments

  if (!ROUTE_METHODS.has(method) || !first || !ts.isStringLiteralLike(first)) return undefined

  const handler = rest.findIndex(isInlineHandler)
  const middleware = handler === -1 ? rest : rest.slice(0, handler)

  return {
    path: first.text,
    method: method.toUpperCase(),
    line: sourceFile.getLineAndCharacterOfPosition(first.getStart(sourceFile)).line + 1,
    gates: middleware.filter(ts.isIdentifier).map((argument) => argument.text),
    validatedTargets: middleware.flatMap(validatedTarget),
  }
}

const isInlineHandler = (argument: ts.Expression) =>
  (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) &&
  argument.parameters.length < 2

const validatedTarget = (argument: ts.Expression) =>
  ts.isCallExpression(argument) &&
  ts.isIdentifier(argument.expression) &&
  argument.expression.text === PARAM_VALIDATOR &&
  argument.arguments[0] &&
  ts.isStringLiteralLike(argument.arguments[0])
    ? [argument.arguments[0].text]
    : []

const routeViolations = (path: string, route: RouteDefinition) => {
  const location = `${path}:${route.line} ${route.method} ${route.path}`
  const requiredGate = Object.hasOwn(ALTERNATIVE_GATES, path)
    ? ALTERNATIVE_GATES[path]
    : OWNERSHIP_MIDDLEWARE

  return [
    ...(route.validatedTargets.includes('param')
      ? []
      : [`${location}: must validate the character ID with ${PARAM_VALIDATOR}('param', ...)`]),
    ...gateViolations(location, route, requiredGate),
  ]
}

const gateViolations = (
  location: string,
  route: RouteDefinition,
  requiredGate: string | null,
): string[] => {
  if (requiredGate === null)
    return route.gates.includes(OWNERSHIP_MIDDLEWARE)
      ? [`${location}: is declared public but applies ${OWNERSHIP_MIDDLEWARE}`]
      : []

  if (!route.gates.includes(requiredGate))
    return [`${location}: must load authorization through ${requiredGate} before its handler`]

  if (requiredGate !== OWNERSHIP_MIDDLEWARE) return []

  const session = route.gates.indexOf(SESSION_MIDDLEWARE)
  const ownership = route.gates.indexOf(OWNERSHIP_MIDDLEWARE)

  return session === -1 || session > ownership
    ? [`${location}: must apply ${SESSION_MIDDLEWARE} before ${OWNERSHIP_MIDDLEWARE}`]
    : []
}
