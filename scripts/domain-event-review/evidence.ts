import { dirname, join, normalize } from 'node:path'
import ts from 'typescript'
import { loadTypescriptSourceDirectory } from '../typescript-source-directory.js'

const DEFINITIONS_FILE = 'api/src/domain-events/definitions.ts'
const HANDLERS_FILE = 'api/src/domain-events/handlers.ts'
const CONTEXT_LINES_BEFORE = 50
const CONTEXT_LINES_AFTER = 20

type OptionalText = string | null

interface DomainEventProducerEvidence {
  readonly id: string
  readonly file: string
  readonly line: number
  readonly functionName: OptionalText
  readonly eventType: string
  readonly eventTypeExpression: string
  readonly payloadVersion: number | null
  readonly aggregateId: OptionalText
  readonly payload: OptionalText
  readonly appendCall: string
  readonly mutationContext: string
}

interface DomainEventDefinitionEvidence {
  readonly eventType: string
  readonly payloadVersion: number
  readonly aggregateType: OptionalText
  readonly registryEntry: string
  readonly payloadSchema: OptionalText
}

interface DomainEventConsumerEvidence {
  readonly id: string
  readonly file: string
  readonly line: number
  readonly functionName: string
  readonly idempotency: OptionalText
  readonly code: string
  readonly dependencyFiles: readonly string[]
  readonly dependencies: readonly DomainEventConsumerDependency[]
}

interface DomainEventConsumerDependency {
  readonly file: string
  readonly symbol: string
  readonly code: OptionalText
}

export interface DomainEventEvidence {
  readonly id: string
  readonly producer: DomainEventProducerEvidence
  readonly definition: DomainEventDefinitionEvidence | null
  readonly consumers: readonly DomainEventConsumerEvidence[]
}

export async function collectDomainEventEvidence(
  root: string,
  changedFiles: readonly string[],
): Promise<DomainEventEvidence[]> {
  const sources = await loadTypescriptSourceDirectory(root, join(root, 'api', 'src'))
  const sourceByPath = new Map(sources.map((source) => [source.path, source.source]))
  const definitions = indexDomainEventDefinitions(sourceByPath.get(DEFINITIONS_FILE) ?? '')
  const eventTypes = [...new Set([...definitions.values()].map(({ eventType }) => eventType))]
  const consumers = indexDomainEventConsumers(sourceByPath.get(HANDLERS_FILE) ?? '', sourceByPath)
  const producers = sources.flatMap(({ path, source }) =>
    producerEvidenceInSource(path, source, eventTypes),
  )
  const changed = new Set(changedFiles)
  const reviewAll = changed.has(DEFINITIONS_FILE) || changed.has(HANDLERS_FILE)
  const consumerAffectedTypes = affectedConsumerEventTypes(consumers, changed)
  return producers
    .filter(
      (producer) =>
        reviewAll || changed.has(producer.file) || consumerAffectedTypes.has(producer.eventType),
    )
    .map((producer) => ({
      id: producer.id,
      producer,
      definition:
        definitions.get(definitionKey(producer.eventType, producer.payloadVersion ?? 1)) ?? null,
      consumers: consumers.get(producer.eventType) ?? [],
    }))
    .toSorted((left, right) => left.id.localeCompare(right.id))
}

function affectedConsumerEventTypes(
  consumers: ReadonlyMap<string, readonly DomainEventConsumerEvidence[]>,
  changedFiles: ReadonlySet<string>,
) {
  const affected = new Set<string>()
  for (const [eventType, handlers] of consumers) {
    if (
      handlers.some(
        (handler) =>
          changedFiles.has(handler.file) ||
          handler.dependencyFiles.some((file) => changedFiles.has(file)),
      )
    )
      affected.add(eventType)
  }
  return affected
}

function producerEvidenceInSource(
  file: string,
  source: string,
  registeredEventTypes: readonly string[],
) {
  if (!source) return []
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const appendBindings = importedBindings(
    sourceFile,
    (specifier) => specifier.endsWith('/domain-events/store.js'),
    'appendDomainEvent',
  )
  if (appendBindings.size === 0) return []
  const lines = source.split('\n')
  const producers: DomainEventProducerEvidence[] = []
  visit(sourceFile, (node) => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isIdentifier(node.expression) ||
      !appendBindings.has(node.expression.text)
    )
      return
    const input = unwrapExpression(node.arguments[1])
    if (!input || !ts.isObjectLiteralExpression(input)) return
    const typeValue = propertyValue(input, 'type')
    if (!typeValue) return
    const lineIndex = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line
    const eventTypeExpression = typeValue.getText(sourceFile)
    for (const eventType of eventTypesFrom(typeValue, registeredEventTypes)) {
      producers.push({
        id: `${file}:${lineIndex + 1}:${eventType}`,
        file,
        line: lineIndex + 1,
        functionName: enclosingFunctionName(node),
        eventType,
        eventTypeExpression,
        payloadVersion: numericProperty(input, 'payloadVersion'),
        aggregateId: propertyCode(sourceFile, input, 'aggregateId'),
        payload: propertyCode(sourceFile, input, 'payload'),
        appendCall: node.getText(sourceFile),
        mutationContext: excerptAround(lines, lineIndex),
      })
    }
  })
  return producers
}

function indexDomainEventDefinitions(source: string) {
  const definitions = new Map<string, DomainEventDefinitionEvidence>()
  if (!source) return definitions
  const sourceFile = ts.createSourceFile(DEFINITIONS_FILE, source, ts.ScriptTarget.Latest, true)
  const schemas = variableDeclarations(sourceFile)
  const registry = objectVariable(sourceFile, 'domainEventRegistry')
  if (!registry) return definitions
  for (const property of registry.properties) {
    for (const definition of definitionsFromRegistryProperty(property, sourceFile, schemas)) {
      definitions.set(definitionKey(definition.eventType, definition.payloadVersion), definition)
    }
  }
  return definitions
}

function definitionsFromRegistryProperty(
  property: ts.ObjectLiteralElementLike,
  sourceFile: ts.SourceFile,
  schemas: ReadonlyMap<string, string>,
): DomainEventDefinitionEvidence[] {
  if (!ts.isPropertyAssignment(property)) return []
  const eventType = propertyName(property.name)
  const entry = unwrapExpression(property.initializer)
  if (!eventType || !entry || !ts.isObjectLiteralExpression(entry)) return []
  const versions = objectProperty(entry, 'versions')
  if (!versions) return []
  const definitions: DomainEventDefinitionEvidence[] = []
  for (const versionProperty of versions.properties) {
    if (!ts.isPropertyAssignment(versionProperty)) continue
    const version = Number(propertyName(versionProperty.name))
    if (!Number.isInteger(version)) continue
    definitions.push({
      eventType,
      payloadVersion: version,
      aggregateType: propertyText(entry, 'aggregateType'),
      registryEntry: property.getText(sourceFile),
      payloadSchema: payloadSchemaText(versionProperty.initializer, sourceFile, schemas),
    })
  }
  return definitions
}

function payloadSchemaText(
  initializer: ts.Expression,
  sourceFile: ts.SourceFile,
  schemas: ReadonlyMap<string, string>,
) {
  const schema = unwrapExpression(initializer)
  if (!schema) return null
  if (ts.isIdentifier(schema)) return schemas.get(schema.text) ?? null
  return schema.getText(sourceFile)
}

function indexDomainEventConsumers(source: string, sourceByPath: ReadonlyMap<string, string>) {
  const consumers = new Map<string, DomainEventConsumerEvidence[]>()
  if (!source) return consumers
  const sourceFile = ts.createSourceFile(HANDLERS_FILE, source, ts.ScriptTarget.Latest, true)
  const eventTypeArrays = stringArrayVariables(sourceFile)
  const imports = importedSymbols(sourceFile, HANDLERS_FILE)
  for (const statement of sourceFile.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.name) continue
    const indexed = indexDomainEventConsumer(
      statement,
      statement.name.text,
      sourceFile,
      eventTypeArrays,
      imports,
      sourceByPath,
    )
    if (!indexed) continue
    for (const eventType of indexed.eventTypes) {
      const existing = consumers.get(eventType) ?? []
      consumers.set(eventType, [...existing, indexed.consumer])
    }
  }
  return consumers
}

function indexDomainEventConsumer(
  statement: ts.FunctionDeclaration,
  functionName: string,
  sourceFile: ts.SourceFile,
  eventTypeArrays: ReadonlyMap<string, readonly string[]>,
  imports: ReadonlyMap<string, { file: string; symbol: string }>,
  sourceByPath: ReadonlyMap<string, string>,
) {
  const identifiers = identifiersIn(statement)
  const eventTypes = consumerEventTypes(statement, eventTypeArrays, identifiers)
  const idempotency = firstStringProperty(statement, 'idempotency')
  if (eventTypes.size === 0 || !idempotency) return null
  const line = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1
  const dependencies = [...imports]
    .filter(([name]) => identifiers.has(name))
    .map(([, dependency]) => ({
      file: dependency.file,
      symbol: dependency.symbol,
      code: namedDeclarationCode(
        dependency.file,
        sourceByPath.get(dependency.file) ?? '',
        dependency.symbol,
      ),
    }))
    .toSorted((left, right) => left.file.localeCompare(right.file))
  const consumer = {
    id: `${HANDLERS_FILE}:${line}:${functionName}`,
    file: HANDLERS_FILE,
    line,
    functionName,
    idempotency,
    code: statement.getText(sourceFile),
    dependencyFiles: dependencies.map(({ file }) => file),
    dependencies,
  } satisfies DomainEventConsumerEvidence
  return { consumer, eventTypes }
}

function consumerEventTypes(
  statement: ts.FunctionDeclaration,
  eventTypeArrays: ReadonlyMap<string, readonly string[]>,
  identifiers: ReadonlySet<string>,
) {
  const eventTypes = new Set<string>()
  for (const [name, types] of eventTypeArrays) {
    if (!identifiers.has(name)) continue
    for (const eventType of types) eventTypes.add(eventType)
  }
  for (const eventType of directEventTypesIn(statement)) eventTypes.add(eventType)
  return eventTypes
}

function variableDeclarations(sourceFile: ts.SourceFile) {
  const declarations = new Map<string, string>()
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name))
        declarations.set(declaration.name.text, statement.getText(sourceFile))
    }
  }
  return declarations
}

function stringArrayVariables(sourceFile: ts.SourceFile) {
  const arrays = new Map<string, string[]>()
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue
      const value = unwrapExpression(declaration.initializer)
      if (!value || !ts.isArrayLiteralExpression(value)) continue
      const strings = value.elements.flatMap((element) => {
        const item = unwrapExpression(element)
        return item && ts.isStringLiteralLike(item) ? [item.text] : []
      })
      if (strings.length > 0) arrays.set(declaration.name.text, strings)
    }
  }
  return arrays
}

function importedSymbols(sourceFile: ts.SourceFile, file: string) {
  const imports = new Map<string, { file: string; symbol: string }>()
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier))
      continue
    const specifier = statement.moduleSpecifier.text
    if (!specifier.startsWith('.')) continue
    const importedFile = normalize(join(dirname(file), specifier.replace(/\.js$/, '.ts')))
    const bindings = statement.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    for (const element of bindings.elements)
      imports.set(element.name.text, {
        file: importedFile,
        symbol: element.propertyName?.text ?? element.name.text,
      })
  }
  return imports
}

function namedDeclarationCode(file: string, source: string, symbol: string) {
  if (!source) return null
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === symbol)
      return statement.getText(sourceFile)
    if (!ts.isVariableStatement(statement)) continue
    if (
      statement.declarationList.declarations.some(
        (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === symbol,
      )
    )
      return statement.getText(sourceFile)
  }
  return null
}

function importedBindings(
  sourceFile: ts.SourceFile,
  matchesModule: (specifier: string) => boolean,
  importedName: string,
) {
  const bindings = new Set<string>()
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      !matchesModule(statement.moduleSpecifier.text)
    )
      continue
    const named = statement.importClause?.namedBindings
    if (!named || !ts.isNamedImports(named)) continue
    for (const element of named.elements) {
      if ((element.propertyName?.text ?? element.name.text) === importedName)
        bindings.add(element.name.text)
    }
  }
  return bindings
}

function eventTypesFrom(value: ts.Expression, registeredEventTypes: readonly string[]) {
  if (ts.isStringLiteralLike(value)) return [value.text]
  if (!ts.isTemplateExpression(value)) return []
  const staticParts = [value.head.text, ...value.templateSpans.map(({ literal }) => literal.text)]
  return registeredEventTypes.filter((eventType) => matchesTemplate(eventType, staticParts))
}

function matchesTemplate(eventType: string, staticParts: readonly string[]) {
  const first = staticParts[0] ?? ''
  if (!eventType.startsWith(first)) return false
  let offset = first.length
  for (const part of staticParts.slice(1)) {
    if (!part) continue
    const index = eventType.indexOf(part, offset)
    if (index === -1) return false
    offset = index + part.length
  }
  const last = staticParts.at(-1) ?? ''
  return !last || eventType.endsWith(last)
}

function directEventTypesIn(node: ts.Node) {
  const eventTypes = new Set<string>()
  visit(node, (child) => {
    if (!ts.isPropertyAssignment(child) || propertyName(child.name) !== 'eventType') return
    const value = unwrapExpression(child.initializer)
    if (value && ts.isStringLiteralLike(value)) eventTypes.add(value.text)
  })
  return eventTypes
}

function identifiersIn(node: ts.Node) {
  const identifiers = new Set<string>()
  visit(node, (child) => {
    if (ts.isIdentifier(child)) identifiers.add(child.text)
  })
  return identifiers
}

function firstStringProperty(node: ts.Node, name: string) {
  let result: string | null = null
  visit(node, (child) => {
    if (result || !ts.isPropertyAssignment(child) || propertyName(child.name) !== name) return
    const value = unwrapExpression(child.initializer)
    if (value && ts.isStringLiteralLike(value)) result = value.text
  })
  return result
}

function enclosingFunctionName(node: ts.Node) {
  let current: ts.Node | undefined = node.parent
  while (current) {
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      ts.isVariableDeclaration(current.parent) &&
      ts.isIdentifier(current.parent.name)
    )
      return current.parent.name.text
    current = current.parent
  }
  return null
}

function objectVariable(sourceFile: ts.SourceFile, name: string) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue
      const value = unwrapExpression(declaration.initializer)
      if (value && ts.isObjectLiteralExpression(value)) return value
    }
  }
  return null
}

function propertyCode(sourceFile: ts.SourceFile, object: ts.ObjectLiteralExpression, name: string) {
  return propertyValue(object, name)?.getText(sourceFile) ?? null
}

function numericProperty(object: ts.ObjectLiteralExpression, name: string) {
  const value = propertyValue(object, name)
  return value && ts.isNumericLiteral(value) ? Number(value.text) : null
}

function propertyText(object: ts.ObjectLiteralExpression, name: string) {
  const value = propertyValue(object, name)
  return value && ts.isStringLiteralLike(value) ? value.text : null
}

function objectProperty(object: ts.ObjectLiteralExpression, name: string) {
  const value = propertyValue(object, name)
  return value && ts.isObjectLiteralExpression(value) ? value : null
}

function propertyValue(object: ts.ObjectLiteralExpression, name: string) {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) || propertyName(property.name) !== name) continue
    return unwrapExpression(property.initializer)
  }
  return null
}

function propertyName(name: ts.PropertyName) {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)
    ? name.text
    : null
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

function excerptAround(lines: readonly string[], line: number) {
  return lines
    .slice(Math.max(0, line - CONTEXT_LINES_BEFORE), line + CONTEXT_LINES_AFTER)
    .join('\n')
    .trim()
}

function definitionKey(eventType: string, payloadVersion: number) {
  return `${eventType}:${payloadVersion}`
}

function visit(node: ts.Node, operation: (node: ts.Node) => void) {
  operation(node)
  ts.forEachChild(node, (child) => visit(child, operation))
}
