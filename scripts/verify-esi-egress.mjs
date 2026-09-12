import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { moduleServerSourceExtensions } from './module-registry/source-extensions.mjs'

const executionOwnerPath = 'api/src/esi-gateway/internal/execution-runtime.ts'
const runtimeSdkOwnerPaths = new Set([
  executionOwnerPath,
  'api/src/esi-gateway/internal/failure-policy.ts',
  'api/src/esi-gateway/internal/response-error-metadata.ts',
])
const genericMutationPropertyNames = new Set(['allowGenericMutations', 'confirmMutation'])
const rawResourcePropertyNames = new Set(['revalidation', 'transport'])

const root = resolveRoot(process.argv.slice(2))
const apiSourceRoot = join(root, 'api', 'src')
const apiSources = await loadSources(root, apiSourceRoot, new Set(['.ts']))
const moduleSources = await loadInstalledModuleSources(root)
const catalog = await readFile(join(apiSourceRoot, 'esi-gateway', 'internal', 'catalog.ts'), 'utf8')
const generatedCatalog = await readFile(
  join(apiSourceRoot, 'generated', 'platform', 'installed-module-esi.ts'),
  'utf8',
)
const platformCatalog = await readFile(
  join(apiSourceRoot, 'esi-gateway', 'catalog-interface.ts'),
  'utf8',
).catch(() => '')
const installedOperationRegistry = new Set([
  ...[...catalog.matchAll(/defineContract\('([^']+)'/g)].map((match) => match[1]),
  ...generatedOperationIds(generatedCatalog),
])
const egressViolations = [
  ...coreEgressViolations(apiSources),
  ...moduleEgressViolations(moduleSources, installedOperationRegistry),
  ...executionPathCompletenessViolations(
    installedOperationRegistry,
    callableOperationRegistrations(apiSources),
    platformOperationRegistrations(platformCatalog, generatedCatalog),
  ),
].toSorted((left, right) => left.localeCompare(right))

if (egressViolations.length > 0)
  throw new Error(`ESI egress verification failed:\n${egressViolations.join('\n')}`)

function resolveRoot(arguments_) {
  const rootIndex = arguments_.indexOf('--root')
  if (rootIndex === -1) return resolve(fileURLToPath(new URL('..', import.meta.url)))
  const value = arguments_[rootIndex + 1]
  if (!value) throw new Error('--root requires a repository path')
  return resolve(value)
}

function coreEgressViolations(sources) {
  return [
    ...sources.flatMap(({ path, source }) => coreSourceEgressViolations(path, source)),
    ...duplicateRepresentationViolations(sources),
  ]
}

function executionPathCompletenessViolations(
  catalogOperations,
  callableOperations,
  platformOperations,
) {
  const findings = []
  for (const operation of catalogOperations) {
    const callable = callableOperations.has(operation)
    const platform = platformOperations.has(operation)
    if (callable && platform)
      findings.push(`ESI operation ${operation} has duplicate callable and platform registrations`)
    if (!callable && !platform)
      findings.push(`ESI operation ${operation} has no callable or platform registration`)
  }
  return findings
}

function callableOperationRegistrations(sources) {
  const operations = new Set()
  for (const { path, source } of sources) {
    const sourceFile = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      scriptKind(path),
    )
    const declarations = variableInitializers(sourceFile)
    const factories = callableFactoryFunctionsFor(sourceFile)
    visit(sourceFile, (node) => {
      if (!ts.isCallExpression(node) || !factories.has(calledFunctionName(node.expression))) return
      const definition = resolveInitializer(node.arguments[0], declarations)
      if (!definition || !ts.isObjectLiteralExpression(definition)) return
      const operation = objectStringProperty(definition, 'operation', declarations)
      if (operation) operations.add(operation)
    })
  }
  return operations
}

function platformOperationRegistrations(platformSource, generatedSource) {
  return new Set([
    ...objectKeysFromVariable(platformSource, 'corePlatformEsiOperationDefinitions'),
    ...generatedOperationIds(generatedSource),
  ])
}

function objectKeysFromVariable(source, variableName) {
  const sourceFile = ts.createSourceFile(variableName, source, ts.ScriptTarget.Latest)
  const keys = []
  visit(sourceFile, (node) => {
    if (
      !ts.isVariableDeclaration(node) ||
      !ts.isIdentifier(node.name) ||
      node.name.text !== variableName ||
      !node.initializer
    )
      return
    const object = unwrapExpression(node.initializer)
    if (!ts.isObjectLiteralExpression(object)) return
    for (const property of object.properties)
      if (ts.isPropertyAssignment(property)) {
        const name = stringLiteralValue(property.name)
        if (name) keys.push(name)
      }
  })
  return keys
}

function coreSourceEgressViolations(path, source) {
  return [
    ...executionOwnerBoundaryViolations(path, source),
    ...featureCapabilityViolations(path, source),
    ...legacyStateViolations(path, source),
  ]
}

function executionOwnerBoundaryViolations(path, source) {
  const findings = []
  findings.push(...sdkClientConstructionViolations(path, source, 'core'))
  if (!runtimeSdkOwnerPaths.has(path) && hasRuntimeEsiExecutionImport(path, source))
    findings.push(
      `${path}: runtime ESI SDK imports are reserved for the registered execution owner`,
    )
  if (path !== executionOwnerPath && hasNonLiteralDynamicImport(path, source))
    findings.push(`${path}: production code uses a dynamic import that cannot be verified`)
  if (path !== executionOwnerPath && hasNamedProperty(path, source, genericMutationPropertyNames))
    findings.push(
      `${path}: generic mutation approval is reserved for the registered execution owner`,
    )
  if (hasDirectEsiFetch(path, source))
    findings.push(`${path}: direct ESI fetch bypasses the shared transport`)
  if (importsResilienceExecutionInternals(path, source))
    findings.push(`${path}: production code imports ESI resilience execution internals`)
  return findings
}

function featureCapabilityViolations(path, source) {
  const findings = []
  if (!path.startsWith('api/src/esi-gateway/') && usesRepresentationExecution(path, source)) {
    if (hasSensitiveEsiCapabilityProperty(path, source))
      findings.push(`${path}: feature ESI code supplies credentials or principals`)
    if (hasConditionalRevalidationHeader(path, source))
      findings.push(`${path}: feature ESI code supplies conditional revalidation headers`)
  }
  return findings
}

function legacyStateViolations(path, source) {
  if (
    !path.includes('/esi-gateway/') &&
    /(?:esi.*(?:cache|cooldown)|(?:cache|cooldown).*esi)\w*\s*=\s*new Map/i.test(source)
  )
    return [`${path}: legacy ESI cache or cooldown state is retained outside esi-gateway`]
  return []
}

function duplicateRepresentationViolations(sources) {
  const firstPathByName = new Map()
  const findings = []
  for (const { path, source } of sources) {
    const sourceFile = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      scriptKind(path),
    )
    for (const name of registeredRepresentationNames(sourceFile)) {
      const firstPath = firstPathByName.get(name)
      if (firstPath)
        findings.push(
          `${path}: ESI representation ${name} duplicates its registration in ${firstPath}`,
        )
      else firstPathByName.set(name, path)
    }
  }
  return findings
}

function registeredRepresentationNames(sourceFile) {
  const declarations = variableInitializers(sourceFile)
  const definitionFunctions = representationDefinitionFunctions(sourceFile)
  const registrationFunctions = representationRegistrationFunctions(sourceFile)
  const callableFactoryFunctions = callableFactoryFunctionsFor(sourceFile)
  const names = []
  visit(sourceFile, (node) => {
    const name = registeredRepresentationName(
      node,
      definitionFunctions,
      registrationFunctions,
      callableFactoryFunctions,
      declarations,
    )
    if (name) names.push(name)
  })
  return names
}

function registeredRepresentationName(
  node,
  definitionFunctions,
  registrationFunctions,
  callableFactoryFunctions,
  declarations,
) {
  if (!ts.isCallExpression(node)) return undefined
  if (callableFactoryFunctions.has(calledFunctionName(node.expression)))
    return objectStringProperty(
      resolveInitializer(node.arguments[0], declarations),
      'name',
      declarations,
    )
  if (!registrationFunctions.has(calledFunctionName(node.expression))) return undefined
  const definition = resolveInitializer(node.arguments[0], declarations)
  if (
    !definition ||
    !ts.isCallExpression(definition) ||
    !definitionFunctions.has(calledFunctionName(definition.expression))
  )
    return undefined
  const options = resolveInitializer(definition.arguments[0], declarations)
  if (!options || !ts.isObjectLiteralExpression(options)) return undefined
  return objectStringProperty(options, 'name', declarations)
}

function importsResilienceExecutionInternals(path, source) {
  return hasRuntimeModuleImport(path, source, (specifier) => {
    const value = stringLiteralValue(specifier)
    return Boolean(
      value?.endsWith('/esi-gateway/internal/execution-runtime.js') ||
      value?.endsWith('/esi-gateway/internal/request-transport.js') ||
      value?.endsWith('/esi-gateway/internal/module-operation-dispatcher.js') ||
      value?.endsWith('/esi-gateway/internal/approved-mutation-adapter.js'),
    )
  })
}

function usesRepresentationExecution(path, source) {
  return hasRuntimeModuleImport(path, source, (specifier) => {
    const value = stringLiteralValue(specifier)
    return Boolean(
      value?.endsWith('/esi-gateway/feature-execution.js') ||
      value?.endsWith('/esi-gateway/internal/representations.js') ||
      value?.endsWith('/esi-gateway/internal/representation-registry.js'),
    )
  })
}

function hasSensitiveEsiCapabilityProperty(path, source) {
  return hasNamedProperty(path, source, new Set(['accessToken', 'credentials', 'principal']))
}

function hasConditionalRevalidationHeader(path, source) {
  return hasNamedProperty(
    path,
    source,
    new Set(['ifnonematch', 'ifmodifiedsince', 'if-none-match', 'if-modified-since']),
    true,
  )
}

function calledFunctionName(expression) {
  const value = unwrapExpression(expression)
  if (ts.isIdentifier(value)) return value.text
  if (ts.isPropertyAccessExpression(value)) return value.name.text
  if (ts.isElementAccessExpression(value)) return stringLiteralValue(value.argumentExpression)
  return undefined
}

function stringLiteralValue(node) {
  if (!node) return undefined
  const value = unwrapExpression(node)
  return ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)
    ? value.text
    : undefined
}

function variableInitializers(sourceFile) {
  const declarations = new Map()
  visit(sourceFile, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer)
      declarations.set(node.name.text, node.initializer)
  })
  return declarations
}

function resolveInitializer(node, declarations, seen = new Set()) {
  if (!node) return undefined
  const value = unwrapExpression(node)
  if (!ts.isIdentifier(value) || seen.has(value.text)) return value
  const initializer = declarations.get(value.text)
  if (!initializer) return value
  seen.add(value.text)
  return resolveInitializer(initializer, declarations, seen)
}

function representationDefinitionFunctions(sourceFile) {
  const canonical = new Set([
    'definePublicEsiRepresentation',
    'defineCharacterEsiRepresentation',
    'defineCharacterEsiMutation',
  ])
  const functions = new Set(canonical)
  const declarations = variableInitializers(sourceFile)
  collectRepresentationDefinitionImports(sourceFile, canonical, functions)
  resolveAliases(declarations, ([name, initializer]) =>
    registerRepresentationDefinitionAlias(name, initializer, functions),
  )
  return functions
}

function representationRegistrationFunctions(sourceFile) {
  const functions = new Set(['registerCallableEsiRepresentation'])
  const declarations = variableInitializers(sourceFile)
  visit(sourceFile, (node) => {
    if (!ts.isImportDeclaration(node)) return
    const specifier = stringLiteralValue(node.moduleSpecifier)
    const bindings = node.importClause?.namedBindings
    if (!specifier?.endsWith('/esi-gateway/internal/representation-registry.js') || !bindings)
      return
    if (!ts.isNamedImports(bindings)) return
    for (const element of bindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text
      if (!element.isTypeOnly && imported === 'registerCallableEsiRepresentation')
        functions.add(element.name.text)
    }
  })
  resolveAliases(declarations, ([name, initializer]) =>
    registerRepresentationDefinitionAlias(name, initializer, functions),
  )
  return functions
}

function callableFactoryFunctionsFor(sourceFile) {
  const canonical = new Set([
    'createPublicEsiRead',
    'createCharacterEsiRead',
    'createCharacterEsiMutation',
  ])
  const functions = new Set(canonical)
  const declarations = variableInitializers(sourceFile)
  visit(sourceFile, (node) => {
    if (!ts.isImportDeclaration(node)) return
    const specifier = stringLiteralValue(node.moduleSpecifier)
    const bindings = node.importClause?.namedBindings
    if (!specifier?.endsWith('/esi-gateway/feature-execution.js') || !bindings) return
    if (!ts.isNamedImports(bindings)) return
    for (const element of bindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text
      if (!element.isTypeOnly && canonical.has(imported)) functions.add(element.name.text)
    }
  })
  resolveAliases(declarations, ([name, initializer]) =>
    registerRepresentationDefinitionAlias(name, initializer, functions),
  )
  return functions
}

function collectRepresentationDefinitionImports(sourceFile, canonical, functions) {
  visit(sourceFile, (node) => {
    collectRepresentationDefinitionImport(node, canonical, functions)
  })
}

function collectRepresentationDefinitionImport(node, canonical, functions) {
  if (!ts.isImportDeclaration(node)) return
  const specifier = stringLiteralValue(node.moduleSpecifier)
  const bindings = node.importClause?.namedBindings
  if (!specifier?.endsWith('/esi-gateway/internal/representations.js') || !bindings) return
  if (!ts.isNamedImports(bindings)) return
  for (const element of bindings.elements)
    registerRepresentationDefinitionImport(element, canonical, functions)
}

function registerRepresentationDefinitionImport(element, canonical, functions) {
  if (element.isTypeOnly) return
  const imported = element.propertyName?.text ?? element.name.text
  if (canonical.has(imported)) functions.add(element.name.text)
}

function registerRepresentationDefinitionAlias(name, initializer, functions) {
  const value = unwrapExpression(initializer)
  if (!ts.isIdentifier(value) || !functions.has(value.text) || functions.has(name)) return false
  functions.add(name)
  return true
}

function objectStringProperty(object, name, declarations) {
  const property = object.properties.find(
    (candidate) =>
      (ts.isPropertyAssignment(candidate) || ts.isShorthandPropertyAssignment(candidate)) &&
      staticPropertyName(candidate.name, declarations) === name,
  )
  if (!property) return undefined
  if (ts.isPropertyAssignment(property))
    return staticStringValue(resolveInitializer(property.initializer, declarations), declarations)
  return staticStringValue(resolveInitializer(property.name, declarations), declarations)
}

function staticPropertyName(name, declarations = new Map()) {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  if (ts.isComputedPropertyName(name)) return staticStringValue(name.expression, declarations)
  return undefined
}

function staticStringValue(node, declarations, seen = new Set()) {
  if (!node) return undefined
  const value = unwrapExpression(node)
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text
  if (ts.isIdentifier(value)) {
    if (seen.has(value.text)) return undefined
    const initializer = declarations.get(value.text)
    if (!initializer) return undefined
    seen.add(value.text)
    return staticStringValue(initializer, declarations, seen)
  }
  if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticStringValue(value.left, declarations, new Set(seen))
    const right = staticStringValue(value.right, declarations, new Set(seen))
    return left === undefined || right === undefined ? undefined : left + right
  }
  return undefined
}

function hasNamedProperty(path, source, names, ignoreCase = false) {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(path),
  )
  const declarations = variableInitializers(sourceFile)
  let found = false
  visit(sourceFile, (node) => {
    let name
    if (
      ts.isPropertyAssignment(node) ||
      ts.isShorthandPropertyAssignment(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isPropertyAccessExpression(node)
    )
      name = staticPropertyName(node.name, declarations)
    else if (ts.isElementAccessExpression(node))
      name = staticStringValue(node.argumentExpression, declarations)
    if (name && names.has(ignoreCase ? name.toLowerCase() : name)) found = true
  })
  return found
}

function hasNonLiteralDynamicImport(path, source) {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(path),
  )
  let found = false
  visit(sourceFile, (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      !stringLiteralValue(node.arguments[0])
    )
      found = true
  })
  return found
}

function moduleEgressViolations(sources, operationIds) {
  return sources.flatMap(({ path, source }) =>
    moduleSourceEgressViolations(path, source, operationIds),
  )
}

function moduleSourceEgressViolations(path, source, operationIds) {
  const operations = operationProperties(path, source)
  const hasEsiSdkImport = hasRuntimeEsiSdkImport(path, source)
  return [
    ...unregisteredOperationViolations(path, operations, operationIds),
    ...moduleSdkViolations(path, source, operations, hasEsiSdkImport),
    ...moduleTransportViolations(path, source),
    ...moduleResourceBoundaryViolations(path, source),
  ]
}

function unregisteredOperationViolations(path, operations, operationIds) {
  const findings = []
  for (const operation of operations) {
    if (!operationIds.has(operation))
      findings.push(`${path}: unregistered ESI operation ${operation}`)
  }
  return findings
}

function moduleSdkViolations(path, source, operations, hasEsiSdkImport) {
  const findings = []
  if (hasEsiSdkImport && operations.size === 0)
    findings.push(`${path}: ESI SDK usage is not associated with a registered operation`)
  if (hasEsiSdkImport)
    findings.push(
      `${path}: feature server code imports the ESI SDK at runtime instead of using platform dispatch`,
    )
  findings.push(...sdkClientConstructionViolations(path, source, 'module'))
  return findings
}

function moduleTransportViolations(path, source) {
  const findings = []
  if (hasNonLiteralDynamicImport(path, source))
    findings.push(`${path}: feature server code uses a dynamic import that cannot be verified`)
  if (/(?:^|[^\w$])(?:globalThis\.)?fetch\s*\(/m.test(source))
    findings.push(`${path}: feature server code performs direct fetch instead of shared ESI egress`)
  if (
    source.includes('createEsiTransport') ||
    /(?:class|function)\s+\w*Esi\w*Transport\w*/i.test(source) ||
    /(?:const|let|var)\s+\w*esi\w*transport\w*/i.test(source) ||
    /(?:const|let|var)\s+\w*transport\w*esi\w*/i.test(source) ||
    /(?:from\s*|import\s*\(?)['"](?:node-fetch|undici|axios|got)['"]/.test(source)
  )
    findings.push(`${path}: feature server code defines or imports a duplicate ESI transport`)
  if (
    /(?:class|function|const|let|var)\s+\w*(?:esi\w*(?:cache|cooldown)|(?:cache|cooldown)\w*esi)\w*/i.test(
      source,
    )
  )
    findings.push(`${path}: feature server code defines module-local ESI cache or cooldown state`)
  return findings
}

function moduleResourceBoundaryViolations(path, source) {
  const findings = []
  if (
    hasSensitiveEsiCapabilityProperty(path, source) ||
    hasNamedProperty(path, source, rawResourcePropertyNames)
  )
    findings.push(`${path}: feature resource code accesses raw ESI authorization or transport`)
  if (hasConditionalRevalidationHeader(path, source))
    findings.push(`${path}: feature server code supplies conditional ESI revalidation headers`)
  if (importsResilienceExecutionInternals(path, source))
    findings.push(`${path}: feature server code imports ESI resilience execution internals`)
  if (hasNamedProperty(path, source, genericMutationPropertyNames))
    findings.push(`${path}: feature server code attempts generic ESI mutation execution`)
  if (
    source.includes('definePlatformResourceOperation') &&
    /\b(?:identity|cacheKey|representationKey)\s*:/.test(source)
  )
    findings.push(`${path}: feature resource code defines an independent ESI identity`)

  return findings
}

function operationProperties(path, source) {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(path),
  )
  const declarations = variableInitializers(sourceFile)
  const operations = new Set()
  visit(sourceFile, (node) => {
    if (
      (!ts.isPropertyAssignment(node) && !ts.isShorthandPropertyAssignment(node)) ||
      staticPropertyName(node.name, declarations) !== 'operation'
    )
      return
    const operation = ts.isPropertyAssignment(node)
      ? staticStringValue(node.initializer, declarations)
      : staticStringValue(resolveInitializer(node.name, declarations), declarations)
    if (operation) operations.add(operation)
  })
  return operations
}

function hasRuntimeEsiSdkImport(path, source) {
  return hasRuntimeModuleImport(path, source, isEsiSdkSpecifier)
}

function hasRuntimeEsiExecutionImport(path, source) {
  return hasRuntimeModuleImport(
    path,
    source,
    (specifier) =>
      isEsiSdkSpecifier(specifier) &&
      stringLiteralValue(specifier) !== '@evespace/esi-client/operations',
  )
}

function hasRuntimeModuleImport(path, source, matches) {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(path),
  )
  let found = false

  visit(sourceFile, (node) => {
    if (
      ts.isImportDeclaration(node) &&
      hasRuntimeImportClause(node.importClause) &&
      matches(node.moduleSpecifier)
    )
      found = true
    if (
      ts.isExportDeclaration(node) &&
      hasRuntimeExportClause(node) &&
      node.moduleSpecifier &&
      matches(node.moduleSpecifier)
    )
      found = true
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      stringLiteralValue(node.arguments[0]) !== undefined &&
      matches(node.arguments[0])
    )
      found = true
  })

  return found
}

function hasDirectEsiFetch(path, source) {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(path),
  )
  let found = false
  visit(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || calledFunctionName(node.expression) !== 'fetch') return
    const target = stringLiteralValue(node.arguments[0])
    if (target?.includes('esi.evetech.net')) found = true
  })
  return found
}

function hasRuntimeImportClause(importClause) {
  if (!importClause) return true
  const typeOnly = importClause.phaseModifier === ts.SyntaxKind.TypeKeyword
  if (typeOnly || importClause.name) return !typeOnly
  if (!importClause.namedBindings) return false
  if (ts.isNamespaceImport(importClause.namedBindings)) return true
  return importClause.namedBindings.elements.some((element) => !element.isTypeOnly)
}

function hasRuntimeExportClause(declaration) {
  if (declaration.isTypeOnly) return false
  if (!declaration.exportClause || ts.isNamespaceExport(declaration.exportClause)) return true
  return declaration.exportClause.elements.some((element) => !element.isTypeOnly)
}

function sdkClientConstructionViolations(path, source, owner) {
  if (!source.includes('@evespace/esi-client')) return []
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(path),
  )
  const { factories, classes, namespaces, declarations } = collectSdkClientReferences(sourceFile)
  resolveSdkClientFactoryAliases(sourceFile, declarations, factories, namespaces)
  resolveSdkClientClassAliases(sourceFile, declarations, classes, namespaces)
  return findSdkClientConstructionViolations(
    sourceFile,
    path,
    owner,
    factories,
    classes,
    namespaces,
  )
}

function collectSdkClientReferences(sourceFile) {
  const factories = new Set()
  const classes = new Set()
  const namespaces = new Set()
  const declarations = []

  visit(sourceFile, (node) =>
    collectSdkClientReference(node, factories, classes, namespaces, declarations),
  )
  return { factories, classes, namespaces, declarations }
}

function collectSdkClientReference(node, factories, classes, namespaces, declarations) {
  if (ts.isVariableDeclaration(node)) declarations.push(node)
  if (!ts.isImportDeclaration(node) || !isEsiSdkSpecifier(node.moduleSpecifier)) return

  const clause = node.importClause
  if (!clause || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return
  if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings))
    namespaces.add(clause.namedBindings.name.text)
  if (!clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) return

  for (const element of clause.namedBindings.elements)
    collectNamedSdkClientImport(element, factories, classes)
}

function collectNamedSdkClientImport(element, factories, classes) {
  if (element.isTypeOnly) return
  const imported = element.propertyName?.text ?? element.name.text
  if (isSdkClientFactoryName(imported)) factories.add(element.name.text)
  if (imported === 'EsiClient') classes.add(element.name.text)
}

function resolveSdkClientFactoryAliases(sourceFile, declarations, factories, namespaces) {
  resolveAliases(declarations, (declaration) =>
    registerSdkClientFactoryAlias(sourceFile, declaration, factories, namespaces),
  )
}

function resolveSdkClientClassAliases(sourceFile, declarations, classes, namespaces) {
  resolveAliases(declarations, (declaration) =>
    registerSdkClientClassAlias(sourceFile, declaration, classes, namespaces),
  )
}

function resolveAliases(declarations, registerAlias) {
  let changed = true
  while (changed) {
    changed = false
    for (const declaration of declarations) changed = registerAlias(declaration) || changed
  }
}

function registerSdkClientFactoryAlias(sourceFile, declaration, factories, namespaces) {
  if (registerIdentifierFactoryAlias(declaration, factories, namespaces)) return true
  return registerDestructuredFactoryAliases(sourceFile, declaration, factories, namespaces)
}

function registerSdkClientClassAlias(sourceFile, declaration, classes, namespaces) {
  if (registerIdentifierClassAlias(declaration, classes, namespaces)) return true
  return registerDestructuredClassAliases(sourceFile, declaration, classes, namespaces)
}

function registerIdentifierFactoryAlias(declaration, factories, namespaces) {
  if (
    !ts.isIdentifier(declaration.name) ||
    !declaration.initializer ||
    !isSdkClientFactoryExpression(declaration.initializer, factories, namespaces) ||
    factories.has(declaration.name.text)
  )
    return false

  factories.add(declaration.name.text)
  return true
}

function registerIdentifierClassAlias(declaration, classes, namespaces) {
  if (
    !ts.isIdentifier(declaration.name) ||
    !declaration.initializer ||
    !isSdkClientClassExpression(declaration.initializer, classes, namespaces) ||
    classes.has(declaration.name.text)
  )
    return false

  classes.add(declaration.name.text)
  return true
}

function registerDestructuredFactoryAliases(sourceFile, declaration, factories, namespaces) {
  if (
    !ts.isObjectBindingPattern(declaration.name) ||
    !declaration.initializer ||
    !ts.isIdentifier(unwrapExpression(declaration.initializer)) ||
    !namespaces.has(unwrapExpression(declaration.initializer).text)
  )
    return false

  let changed = false
  for (const element of declaration.name.elements) {
    const imported = element.propertyName?.getText(sourceFile) ?? element.name.getText(sourceFile)
    if (
      isSdkClientFactoryName(imported) &&
      ts.isIdentifier(element.name) &&
      !factories.has(element.name.text)
    ) {
      factories.add(element.name.text)
      changed = true
    }
  }
  return changed
}

function registerDestructuredClassAliases(sourceFile, declaration, classes, namespaces) {
  if (
    !ts.isObjectBindingPattern(declaration.name) ||
    !declaration.initializer ||
    !ts.isIdentifier(unwrapExpression(declaration.initializer)) ||
    !namespaces.has(unwrapExpression(declaration.initializer).text)
  )
    return false

  let changed = false
  for (const element of declaration.name.elements) {
    const imported = element.propertyName?.getText(sourceFile) ?? element.name.getText(sourceFile)
    if (
      imported === 'EsiClient' &&
      ts.isIdentifier(element.name) &&
      !classes.has(element.name.text)
    ) {
      classes.add(element.name.text)
      changed = true
    }
  }
  return changed
}

function findSdkClientConstructionViolations(
  sourceFile,
  path,
  owner,
  factories,
  classes,
  namespaces,
) {
  const findings = []
  visit(sourceFile, (node) =>
    collectSdkClientConstructionViolation(
      node,
      path,
      owner,
      factories,
      classes,
      namespaces,
      findings,
    ),
  )
  return findings
}

function collectSdkClientConstructionViolation(
  node,
  path,
  owner,
  factories,
  classes,
  namespaces,
  findings,
) {
  const isFactoryCall =
    ts.isCallExpression(node) &&
    isSdkClientFactoryExpression(node.expression, factories, namespaces)
  const isGenericConstruction =
    ts.isNewExpression(node) && isSdkClientClassExpression(node.expression, classes, namespaces)
  if (!isFactoryCall && !isGenericConstruction) return
  if (owner === 'core' && isGenericConstruction) {
    if (path !== executionOwnerPath) {
      findings.push(`${path}: generic ESI SDK client construction is reserved for shared executors`)
      return
    }
    if (usesRequiredTransport(node, owner)) return
  }
  if (owner === 'core' && usesRequiredTransport(node, owner)) return

  findings.push(
    owner === 'core'
      ? `${path}: ESI client bypasses the resilience-owned transport`
      : `${path}: feature server code constructs an ESI SDK client instead of platform dispatch`,
  )
}

function usesRequiredTransport(call, owner) {
  const options = call.arguments?.[0]
  if (!options || !ts.isObjectLiteralExpression(unwrapExpression(options))) return false
  const fetchProperty = unwrapExpression(options).properties.find(
    (property) =>
      ts.isPropertyAssignment(property) &&
      property.name.getText().replaceAll(/['"]/g, '') === 'fetch',
  )
  if (!fetchProperty || !ts.isPropertyAssignment(fetchProperty)) return false
  const transport = unwrapExpression(fetchProperty.initializer)
  if (owner === 'core')
    return (
      (ts.isCallExpression(transport) &&
        ['createTransport', '#createTransport'].includes(
          calledFunctionName(transport.expression),
        )) ||
      isAttemptScopedTransport(call, transport)
    )
  return (
    (ts.isIdentifier(transport) && transport.text === 'transport') ||
    (ts.isPropertyAccessExpression(transport) && transport.name.text === 'transport')
  )
}

function isAttemptScopedTransport(construction, transport) {
  if (!ts.isIdentifier(transport) || transport.text !== 'transport') return false
  for (let current = construction.parent; current; current = current.parent) {
    if (!ts.isArrowFunction(current) && !ts.isFunctionExpression(current)) continue
    const ownsTransport = current.parameters.some(
      (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === transport.text,
    )
    if (!ownsTransport) continue
    return (
      ts.isCallExpression(current.parent) &&
      current.parent.arguments.includes(current) &&
      calledFunctionName(current.parent.expression) === '#executeSdkAttempt'
    )
  }
  return false
}

function isSdkClientClassExpression(expression, classes, namespaces) {
  const value = unwrapExpression(expression)
  if (ts.isIdentifier(value)) return classes.has(value.text)
  if (
    ts.isPropertyAccessExpression(value) &&
    ts.isIdentifier(unwrapExpression(value.expression)) &&
    namespaces.has(unwrapExpression(value.expression).text) &&
    value.name.text === 'EsiClient'
  )
    return true
  return (
    ts.isElementAccessExpression(value) &&
    ts.isIdentifier(unwrapExpression(value.expression)) &&
    namespaces.has(unwrapExpression(value.expression).text) &&
    stringLiteralValue(value.argumentExpression) === 'EsiClient'
  )
}

function isSdkClientFactoryExpression(expression, factories, namespaces) {
  const value = unwrapExpression(expression)
  if (ts.isIdentifier(value)) return factories.has(value.text)
  if (ts.isPropertyAccessExpression(value))
    return (
      ts.isIdentifier(unwrapExpression(value.expression)) &&
      namespaces.has(unwrapExpression(value.expression).text) &&
      isSdkClientFactoryName(value.name.text)
    )
  if (ts.isElementAccessExpression(value)) {
    const target = unwrapExpression(value.expression)
    const key = value.argumentExpression && unwrapExpression(value.argumentExpression)
    return (
      ts.isIdentifier(target) &&
      namespaces.has(target.text) &&
      !!key &&
      ts.isStringLiteral(key) &&
      isSdkClientFactoryName(key.text)
    )
  }
  return false
}

function unwrapExpression(expression) {
  let value = expression
  while (
    ts.isParenthesizedExpression(value) ||
    ts.isAsExpression(value) ||
    ts.isTypeAssertionExpression(value) ||
    ts.isNonNullExpression(value) ||
    ts.isSatisfiesExpression(value)
  )
    value = value.expression
  return value
}

function isEsiSdkSpecifier(node) {
  const value = stringLiteralValue(node)
  return value === '@evespace/esi-client' || value?.startsWith('@evespace/esi-client/')
}

function isSdkClientFactoryName(value) {
  return /^create[A-Za-z0-9_$]*Client$/.test(value)
}

function visit(node, operation) {
  operation(node)
  ts.forEachChild(node, (child) => visit(child, operation))
}

function scriptKind(path) {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (path.endsWith('.js') || path.endsWith('.mjs')) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function generatedOperationIds(source) {
  const sourceFile = ts.createSourceFile('installed-module-esi.ts', source, ts.ScriptTarget.Latest)
  const operationIds = []

  visit(sourceFile, (node) => {
    if (
      !ts.isVariableDeclaration(node) ||
      !ts.isIdentifier(node.name) ||
      node.name.text !== 'installedModuleEsiOperationCatalog' ||
      !node.initializer
    )
      return

    const entries = unwrapExpression(node.initializer)
    if (!ts.isObjectLiteralExpression(entries)) return

    for (const property of entries.properties) {
      if (ts.isPropertyAssignment(property) && ts.isStringLiteral(property.name))
        operationIds.push(property.name.text)
    }
  })

  return operationIds
}

async function loadInstalledModuleSources(repositoryRoot) {
  const installed = JSON.parse(
    await readFile(join(repositoryRoot, 'features', 'installed-modules.json'), 'utf8'),
  )
  if (
    !Array.isArray(installed.modules) ||
    !installed.modules.every((moduleId) => typeof moduleId === 'string')
  )
    throw new Error('features/installed-modules.json must contain a string modules array')

  const extensions = new Set(moduleServerSourceExtensions)
  const sources = await Promise.all(
    installed.modules.map((moduleId) =>
      loadSources(
        repositoryRoot,
        join(repositoryRoot, 'features', moduleId, 'server', 'src'),
        extensions,
        true,
      ),
    ),
  )
  return sources.flat()
}

async function loadSources(repositoryRoot, directory, extensions, allowMissing = false) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (allowMissing && error?.code === 'ENOENT') return []
    throw error
  }
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return loadSources(repositoryRoot, path, extensions)
      if (!entry.isFile() || !extensions.has(extname(entry.name))) return []
      return [
        {
          path: relative(repositoryRoot, path).replaceAll('\\', '/'),
          source: await readFile(path, 'utf8'),
        },
      ]
    }),
  )
  return nested.flat()
}
