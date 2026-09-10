import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { moduleServerSourceExtensions } from './module-registry/source-extensions.mjs'

/**
 * Core modules still reaching ESI through the pre-representation seam.
 *
 * This list may only shrink. A module that no longer imports the seam is reported as a stale
 * entry, so a completed migration must delete its line, and a module that starts importing the
 * seam without being listed is rejected. When the list empties, the seam itself can be deleted.
 */
const legacyEsiEgressModules = [
  'api/src/characters/affiliation-sync.ts',
  'api/src/characters/assets.ts',
  'api/src/characters/attributes.ts',
  'api/src/characters/clones.ts',
  'api/src/characters/contracts.ts',
  'api/src/characters/corporation-roles.ts',
  'api/src/characters/history.ts',
  'api/src/characters/market.ts',
  'api/src/characters/overview.ts',
  'api/src/characters/profile.ts',
  'api/src/characters/skill-queue.ts',
  'api/src/characters/wallet.ts',
  'api/src/corporations/public-data.ts',
  'api/src/deployment/organization.ts',
  'api/src/mail/mailbox.ts',
  'api/src/organization/authority.ts',
  'api/src/platform/resource-batch.ts',
  'api/src/platform/resource-operation-executor.ts',
  'api/src/system/status.ts',
  'api/src/universe/locations.ts',
]
const legacyLayerMethods = new Set([
  'executeCharacterMutation',
  'executeCharacterRepresentation',
  'executeCharacterUncachedRead',
  'executeNoValue',
  'getCharacter',
  'getCharacterWithAuthorization',
  'getPublic',
])
const genericEsiClientOwnerPaths = new Set([
  'api/src/esi-resilience/approved-mutation-adapter.ts',
  'api/src/esi-resilience/execute.ts',
  'api/src/esi-resilience/module-operation-dispatcher.ts',
])
const approvedMutationAdapterPath = 'api/src/esi-resilience/approved-mutation-adapter.ts'

const root = resolveRoot(process.argv.slice(2))
const apiSourceRoot = join(root, 'api', 'src')
const apiSources = await loadSources(root, apiSourceRoot, new Set(['.ts']))
const moduleSources = await loadInstalledModuleSources(root)
const catalog = await readFile(join(apiSourceRoot, 'esi-resilience', 'catalog.ts'), 'utf8')
const generatedCatalog = await readFile(
  join(apiSourceRoot, 'generated', 'platform', 'installed-module-esi.ts'),
  'utf8',
)
const installedOperationRegistry = new Set([
  ...[...catalog.matchAll(/defineContract\('([^']+)'/g)].map((match) => match[1]),
  ...generatedOperationIds(generatedCatalog),
])
const coreCharacterExecutorPolicies = characterExecutorPolicies(catalog)
const egressViolations = [
  ...coreEgressViolations(apiSources, installedOperationRegistry, coreCharacterExecutorPolicies),
  ...moduleEgressViolations(moduleSources, installedOperationRegistry),
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

function coreEgressViolations(sources, operationIds, executorPolicies) {
  return [
    ...sources.flatMap(({ path, source }) =>
      coreSourceEgressViolations(path, source, operationIds, executorPolicies),
    ),
    ...legacyEgressAllowlistViolations(sources),
  ]
}

function legacyEgressAllowlistViolations(sources) {
  const allowed = new Set(legacyEsiEgressModules)
  const remaining = sources.filter(
    ({ path, source }) =>
      !path.startsWith('api/src/esi-resilience/') && usesLegacyEsiEgress(path, source),
  )
  const remainingPaths = new Set(remaining.map(({ path }) => path))

  return [
    ...remaining
      .filter(({ path }) => !allowed.has(path))
      .map((entry) => `${entry.path}: ESI egress outside the representation seam is not allowed`),
    ...legacyEsiEgressModules
      .filter((path) => !remainingPaths.has(path))
      .map((path) => `${path}: stale legacy ESI egress allowlist entry, delete it`),
  ]
}

function usesLegacyEsiEgress(path, source) {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(path),
  )
  let importsLegacyLayer = false
  let callsLegacyLayer = false
  let importsLegacyEgress = false
  const recordImport = (specifier) => {
    if (
      specifier.endsWith('/request-transport.js') ||
      specifier.startsWith('@evespace/esi-client/domains/')
    )
      importsLegacyEgress = true
    if (specifier.endsWith('/esi-resilience/layer.js')) importsLegacyLayer = true
  }
  visit(sourceFile, (node) => {
    if (ts.isImportDeclaration(node) && hasRuntimeImportClause(node.importClause)) {
      const specifier = stringLiteralValue(node.moduleSpecifier)
      if (specifier) recordImport(specifier)
    }
    if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier) {
      const specifier = stringLiteralValue(node.moduleSpecifier)
      if (specifier) recordImport(specifier)
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      ts.isStringLiteral(node.arguments[0])
    )
      recordImport(node.arguments[0].text)
    if (
      ts.isCallExpression(node) &&
      legacyLayerMethods.has(calledFunctionName(node.expression) ?? '')
    )
      callsLegacyLayer = true
  })
  return importsLegacyEgress || (importsLegacyLayer && callsLegacyLayer)
}

function coreSourceEgressViolations(path, source, operationIds, executorPolicies) {
  const findings = []
  findings.push(
    ...sdkClientConstructionViolations(path, source, 'core'),
    ...characterExecutorViolations(path, source, executorPolicies),
  )
  if (!genericEsiClientOwnerPaths.has(path) && hasRuntimeEsiRootImport(path, source))
    findings.push(`${path}: runtime ESI SDK root imports are reserved for shared executors`)
  if (
    path !== approvedMutationAdapterPath &&
    /\b(?:allowGenericMutations|confirmMutation)\b/.test(source)
  )
    findings.push(
      `${path}: generic mutation approval is reserved for the approved mutation adapter`,
    )
  if (hasDirectEsiFetch(path, source))
    findings.push(`${path}: direct ESI fetch bypasses the shared transport`)

  const transportOperations = operationArguments(source, 'createEsiTransport')
  const executorOperations = operationProperties(source)
  for (const operation of transportOperations) {
    if (!operationIds.has(operation))
      findings.push(`${path}: unregistered ESI operation ${operation}`)
    if (!executorOperations.has(operation))
      findings.push(`${path}: ESI operation ${operation} bypasses the shared executor`)
  }

  if (
    !path.includes('/esi-resilience/') &&
    /(?:esi.*(?:cache|cooldown)|(?:cache|cooldown).*esi)\w*\s*=\s*new Map/i.test(source)
  )
    findings.push(`${path}: legacy ESI cache or cooldown state is retained outside esi-resilience`)

  return findings
}

function characterExecutorViolations(path, source, executorPolicies) {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(path),
  )
  const findings = []
  visit(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || calledFunctionName(node.expression) !== 'createEsiTransport')
      return
    const operation = stringLiteralValue(node.arguments[0])
    const expectedExecutor = operation && executorPolicies.get(operation)
    if (!operation || !expectedExecutor) return

    const association = enclosingCharacterExecutor(node)
    if (association?.executor !== expectedExecutor || association.operation !== operation)
      findings.push(
        `${path}: ESI operation ${operation} bypasses ${expectedExecutor} executor/cache policy`,
      )
  })
  return findings
}

function characterExecutorPolicies(source) {
  const sourceFile = ts.createSourceFile(
    'catalog.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const policies = new Map()
  visit(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || calledFunctionName(node.expression) !== 'defineContract')
      return
    const operation = stringLiteralValue(node.arguments[0])
    const contract = node.arguments[1] && unwrapExpression(node.arguments[1])
    if (!operation || !contract || !ts.isObjectLiteralExpression(contract)) return
    if (!objectProperty(contract, 'resourceRevision')) return

    const cache = objectProperty(contract, 'cache')
    const cacheValue =
      cache && ts.isPropertyAssignment(cache) && unwrapExpression(cache.initializer)
    const cacheKind =
      cacheValue && ts.isObjectLiteralExpression(cacheValue)
        ? stringLiteralValue(propertyInitializer(cacheValue, 'kind'))
        : undefined
    policies.set(
      operation,
      cacheKind === 'none'
        ? objectProperty(contract, 'mutation')
          ? 'executeCharacterMutation'
          : 'executeCharacterUncachedRead'
        : 'getCharacter',
    )
  })
  return policies
}

function enclosingCharacterExecutor(node) {
  let current = node.parent
  while (current) {
    if (ts.isObjectLiteralExpression(current) && ts.isCallExpression(current.parent)) {
      const call = current.parent
      const executor = calledFunctionName(call.expression)
      if (
        (executor === 'getCharacter' ||
          executor === 'executeCharacterMutation' ||
          executor === 'executeCharacterUncachedRead') &&
        call.arguments.some((argument) => unwrapExpression(argument) === current)
      )
        return {
          executor,
          operation: stringLiteralValue(propertyInitializer(current, 'operation')),
        }
    }
    current = current.parent
  }
  return undefined
}

function calledFunctionName(expression) {
  const value = unwrapExpression(expression)
  if (ts.isIdentifier(value)) return value.text
  if (ts.isPropertyAccessExpression(value)) return value.name.text
  if (ts.isElementAccessExpression(value)) return stringLiteralValue(value.argumentExpression)
  return undefined
}

function objectProperty(object, name) {
  return object.properties.find(
    (property) =>
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      property.name.getText().replaceAll(/['"]/g, '') === name,
  )
}

function propertyInitializer(object, name) {
  const property = objectProperty(object, name)
  return property && ts.isPropertyAssignment(property) ? property.initializer : undefined
}

function stringLiteralValue(node) {
  if (!node) return undefined
  const value = unwrapExpression(node)
  return ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)
    ? value.text
    : undefined
}

function moduleEgressViolations(sources, operationIds) {
  return sources.flatMap(({ path, source }) =>
    moduleSourceEgressViolations(path, source, operationIds),
  )
}

function moduleSourceEgressViolations(path, source, operationIds) {
  const findings = []
  const operations = operationProperties(source)
  const hasEsiSdkImport = hasRuntimeEsiSdkImport(path, source)
  for (const operation of operations) {
    if (!operationIds.has(operation))
      findings.push(`${path}: unregistered ESI operation ${operation}`)
  }

  if (hasEsiSdkImport && operations.size === 0)
    findings.push(`${path}: ESI SDK usage is not associated with a registered operation`)
  if (hasEsiSdkImport)
    findings.push(
      `${path}: feature server code imports the ESI SDK at runtime instead of using platform dispatch`,
    )
  findings.push(...sdkClientConstructionViolations(path, source, 'module'))
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
  if (
    source.includes('definePlatformResourceOperation') &&
    /\b(?:accessToken|revalidation|transport)\b/.test(source)
  )
    findings.push(`${path}: feature resource code accesses raw ESI authorization or transport`)
  if (
    source.includes('definePlatformResourceOperation') &&
    /\b(?:identity|cacheKey|representationKey)\s*:/.test(source)
  )
    findings.push(`${path}: feature resource code defines an independent ESI identity`)

  return findings
}

function operationArguments(source, functionName) {
  return [
    ...source.matchAll(new RegExp(String.raw`${functionName}\(\s*['"]([^'"]+)['"]`, 'g')),
  ].map((match) => match[1])
}

function operationProperties(source) {
  return new Set([...source.matchAll(/\boperation:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]))
}

function hasRuntimeEsiSdkImport(path, source) {
  return hasRuntimeModuleImport(path, source, isEsiSdkSpecifier)
}

function hasRuntimeEsiRootImport(path, source) {
  return hasRuntimeModuleImport(
    path,
    source,
    (specifier) => stringLiteralValue(specifier) === '@evespace/esi-client',
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
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      ts.isStringLiteral(node.arguments[0]) &&
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

  for (const element of clause.namedBindings.elements) {
    const imported = element.propertyName?.text ?? element.name.text
    if (!element.isTypeOnly && isSdkClientFactoryName(imported)) factories.add(element.name.text)
    if (!element.isTypeOnly && imported === 'EsiClient') classes.add(element.name.text)
  }
}

function resolveSdkClientFactoryAliases(sourceFile, declarations, factories, namespaces) {
  let changed = true
  while (changed) {
    changed = false
    for (const declaration of declarations)
      changed =
        registerSdkClientFactoryAlias(sourceFile, declaration, factories, namespaces) || changed
  }
}

function resolveSdkClientClassAliases(sourceFile, declarations, classes, namespaces) {
  let changed = true
  while (changed) {
    changed = false
    for (const declaration of declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.initializer &&
        isSdkClientClassExpression(declaration.initializer, classes, namespaces) &&
        !classes.has(declaration.name.text)
      ) {
        classes.add(declaration.name.text)
        changed = true
      }
      if (
        ts.isObjectBindingPattern(declaration.name) &&
        declaration.initializer &&
        ts.isIdentifier(unwrapExpression(declaration.initializer)) &&
        namespaces.has(unwrapExpression(declaration.initializer).text)
      )
        for (const element of declaration.name.elements) {
          const imported =
            element.propertyName?.getText(sourceFile) ?? element.name.getText(sourceFile)
          if (
            imported === 'EsiClient' &&
            ts.isIdentifier(element.name) &&
            !classes.has(element.name.text)
          ) {
            classes.add(element.name.text)
            changed = true
          }
        }
    }
  }
}

function registerSdkClientFactoryAlias(sourceFile, declaration, factories, namespaces) {
  if (registerIdentifierFactoryAlias(declaration, factories, namespaces)) return true
  return registerDestructuredFactoryAliases(sourceFile, declaration, factories, namespaces)
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
    if (!genericEsiClientOwnerPaths.has(path)) {
      findings.push(`${path}: generic ESI SDK client construction is reserved for shared executors`)
      return
    }
    const transportOwner = path.endsWith('/module-operation-dispatcher.ts') ? 'module' : owner
    if (usesRequiredTransport(node, transportOwner)) return
  }
  if (owner === 'core' && usesRequiredTransport(node, owner)) return

  findings.push(
    owner === 'core'
      ? `${path}: ESI client bypasses createEsiTransport`
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
      ts.isCallExpression(transport) &&
      ts.isIdentifier(unwrapExpression(transport.expression)) &&
      unwrapExpression(transport.expression).text === 'createEsiTransport'
    )
  return (
    (ts.isIdentifier(transport) && transport.text === 'transport') ||
    (ts.isPropertyAccessExpression(transport) && transport.name.text === 'transport')
  )
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
  return (
    ts.isStringLiteral(node) &&
    (node.text === '@evespace/esi-client' || node.text.startsWith('@evespace/esi-client/'))
  )
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
