import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { moduleServerSourceExtensions } from './module-registry/source-extensions.mjs'

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
const egressViolations = [
  ...coreEgressViolations(apiSources, installedOperationRegistry),
  ...moduleEgressViolations(moduleSources, installedOperationRegistry),
].toSorted()

if (egressViolations.length > 0)
  throw new Error(`ESI egress verification failed:\n${egressViolations.join('\n')}`)

function resolveRoot(arguments_) {
  const rootIndex = arguments_.indexOf('--root')
  if (rootIndex === -1) return resolve(fileURLToPath(new URL('..', import.meta.url)))
  const value = arguments_[rootIndex + 1]
  if (!value) throw new Error('--root requires a repository path')
  return resolve(value)
}

function coreEgressViolations(sources, operationIds) {
  const findings = []
  for (const { path, source } of sources) {
    findings.push(...sdkClientConstructionViolations(path, source, 'core'))

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
      findings.push(
        `${path}: legacy ESI cache or cooldown state is retained outside esi-resilience`,
      )
  }
  return findings
}

function moduleEgressViolations(sources, operationIds) {
  const findings = []
  for (const { path, source } of sources) {
    const operations = operationProperties(source)
    for (const operation of operations) {
      if (!operationIds.has(operation))
        findings.push(`${path}: unregistered ESI operation ${operation}`)
    }

    if (hasRuntimeEsiSdkImport(source) && operations.size === 0)
      findings.push(`${path}: ESI SDK usage is not associated with a registered operation`)
    if (hasRuntimeEsiSdkImport(source))
      findings.push(
        `${path}: feature server code imports the ESI SDK at runtime instead of using platform dispatch`,
      )
    findings.push(...sdkClientConstructionViolations(path, source, 'module'))
    if (/(?:^|[^\w$])(?:globalThis\.)?fetch\s*\(/m.test(source))
      findings.push(
        `${path}: feature server code performs direct fetch instead of shared ESI egress`,
      )
    if (
      /\bcreateEsiTransport\b|(?:class|function)\s+\w*Esi\w*Transport\w*|(?:const|let|var)\s+\w*(?:esi\w*transport|transport\w*esi)\w*/i.test(
        source,
      ) ||
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
  }
  return findings
}

function operationArguments(source, functionName) {
  return [...source.matchAll(new RegExp(`${functionName}\\(\\s*['"]([^'"]+)['"]`, 'g'))].map(
    (match) => match[1],
  )
}

function operationProperties(source) {
  return new Set([...source.matchAll(/\boperation:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]))
}

function hasRuntimeEsiSdkImport(source) {
  return (
    /(?:^|\n)\s*import\s+(?!type\b)(?:\{[^}]*\}|\*\s+as\s+\w+|[\w$]+(?:\s*,\s*\{[^}]*\})?)\s+from\s*['"]@evespace\/esi-client(?:\/[^'"]*)?['"]/.test(
      source,
    ) ||
    /(?:^|\n)\s*import\s*['"]@evespace\/esi-client(?:\/[^'"]*)?['"]/.test(source) ||
    /\bimport\(\s*['"]@evespace\/esi-client(?:\/[^'"]*)?['"]\s*\)/.test(source)
  )
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
  const factories = new Set()
  const namespaces = new Set()
  const declarations = []

  visit(sourceFile, (node) => {
    if (ts.isImportDeclaration(node) && isEsiSdkSpecifier(node.moduleSpecifier)) {
      const clause = node.importClause
      if (!clause || clause.isTypeOnly) return
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings))
        namespaces.add(clause.namedBindings.name.text)
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings))
        for (const element of clause.namedBindings.elements) {
          const imported = element.propertyName?.text ?? element.name.text
          if (!element.isTypeOnly && isSdkClientFactoryName(imported))
            factories.add(element.name.text)
        }
    }
    if (ts.isVariableDeclaration(node)) declarations.push(node)
  })

  let changed = true
  while (changed) {
    changed = false
    for (const declaration of declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.initializer &&
        isSdkClientFactoryExpression(declaration.initializer, factories, namespaces) &&
        !factories.has(declaration.name.text)
      ) {
        factories.add(declaration.name.text)
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
            isSdkClientFactoryName(imported) &&
            ts.isIdentifier(element.name) &&
            !factories.has(element.name.text)
          ) {
            factories.add(element.name.text)
            changed = true
          }
        }
    }
  }

  const findings = []
  visit(sourceFile, (node) => {
    if (
      ts.isCallExpression(node) &&
      isSdkClientFactoryExpression(node.expression, factories, namespaces) &&
      (owner === 'module' || !usesRequiredTransport(node, owner))
    )
      findings.push(
        owner === 'core'
          ? `${path}: ESI client bypasses createEsiTransport`
          : `${path}: feature server code constructs an ESI SDK client instead of platform dispatch`,
      )
  })
  return findings
}

function usesRequiredTransport(call, owner) {
  const options = call.arguments[0]
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
  const entries = source.match(
    /installedModuleEsiOperationCatalog\s*=\s*\{([\s\S]*?)\}\s*as const/,
  )?.[1]
  return entries ? [...entries.matchAll(/^\s*['"]([^'"]+)['"]:/gm)].map((match) => match[1]) : []
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
