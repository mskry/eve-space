import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const FACTORIES = new Set([
  'createPublicEsiRead',
  'createCharacterEsiRead',
  'createCharacterEsiMutation',
])
const CONTEXT_LINES_BEFORE = 16
const CONTEXT_LINES_AFTER = 32

type EsiUsageFactory =
  | 'createPublicEsiRead'
  | 'createCharacterEsiRead'
  | 'createCharacterEsiMutation'

export interface EsiUsageSite {
  readonly id: string
  readonly file: string
  readonly line: number
  readonly factory: EsiUsageFactory
  readonly operation: string
  readonly name: string
  readonly definition: string
  readonly context: string
  readonly previousDefinition: string | null
}

type ParsedSite = Omit<EsiUsageSite, 'previousDefinition'>

export async function collectEsiUsageSites(
  root: URL,
  files: readonly string[],
  previousSources: ReadonlyMap<string, string> = new Map(),
): Promise<EsiUsageSite[]> {
  const sites = await Promise.all(
    files.map(async (file) => {
      const current = await readSource(root, file)
      const previous = sitesInSource(file, previousSources.get(file) ?? '')
      return sitesInSource(file, current).map((site) => ({
        context: site.context,
        definition: site.definition,
        factory: site.factory,
        file: site.file,
        id: site.id,
        line: site.line,
        name: site.name,
        operation: site.operation,
        previousDefinition: previousDefinitionFor(site, previous),
      }))
    }),
  )

  return sites.flat().toSorted((left, right) => left.id.localeCompare(right.id))
}

export function isEsiUsageSource(file: string) {
  return file.startsWith('api/src/') && file.endsWith('.ts')
}

function sitesInSource(file: string, source: string): ParsedSite[] {
  if (!source) {
    return []
  }
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const factoryBindings = importedFactoryBindings(sourceFile)
  const lines = source.split('\n')
  const sites: ParsedSite[] = []

  visit(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) {
      return
    }
    const factory = factoryBindings.get(node.expression.text)
    if (!factory) {
      return
    }
    const definition = unwrapExpression(node.arguments[0])
    if (!definition || !ts.isObjectLiteralExpression(definition)) {
      return
    }
    const operation = stringProperty(definition, 'operation')
    const name = stringProperty(definition, 'name')
    if (!operation || !name) {
      return
    }
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line
    sites.push({
      context: excerptAround(lines, line),
      definition: node.getText(sourceFile),
      factory,
      file,
      id: `${file}:${line + 1}:${name}`,
      line: line + 1,
      name,
      operation,
    })
  })

  return sites
}

function importedFactoryBindings(sourceFile: ts.SourceFile) {
  const bindings = new Map<string, EsiUsageFactory>()
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      !statement.moduleSpecifier.text.endsWith('/esi-gateway/feature-execution.js')
    ) {
      continue
    }
    const namedBindings = statement.importClause?.namedBindings
    if (!namedBindings || !ts.isNamedImports(namedBindings)) {
      continue
    }
    for (const element of namedBindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text
      if (isEsiUsageFactory(imported)) {
        bindings.set(element.name.text, imported)
      }
    }
  }
  return bindings
}

function isEsiUsageFactory(value: string): value is EsiUsageFactory {
  return FACTORIES.has(value)
}

function stringProperty(object: ts.ObjectLiteralExpression, propertyName: string) {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) || nameOf(property.name) !== propertyName) {
      continue
    }
    const value = unwrapExpression(property.initializer)
    return value && ts.isStringLiteralLike(value) ? value.text : null
  }
  return null
}

function nameOf(name: ts.PropertyName) {
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
  ) {
    current = current.expression
  }
  return current
}

function previousDefinitionFor(site: ParsedSite, previous: readonly ParsedSite[]) {
  return (
    previous.find((candidate) => candidate.name === site.name)?.definition ??
    previous.find(
      (candidate) => candidate.operation === site.operation && candidate.factory === site.factory,
    )?.definition ??
    null
  )
}

function excerptAround(lines: readonly string[], line: number) {
  return lines
    .slice(Math.max(0, line - CONTEXT_LINES_BEFORE), line + CONTEXT_LINES_AFTER)
    .join('\n')
    .trim()
}

async function readSource(root: URL, file: string) {
  try {
    return await readFile(new URL(file, root), 'utf8')
  } catch {
    return ''
  }
}

function visit(node: ts.Node, operation: (node: ts.Node) => void) {
  operation(node)
  ts.forEachChild(node, (child) => visit(child, operation))
}
