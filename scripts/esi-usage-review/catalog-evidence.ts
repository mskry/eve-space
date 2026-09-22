import ts from 'typescript'

export interface EsiCatalogEvidence {
  readonly contract: string | null
  readonly cacheKind: EsiCatalogCacheKind
  readonly metadata: string | null
  readonly previousContract: string | null
  readonly previousMetadata: string | null
}

type EsiCatalogCacheKind = 'none' | 'public' | 'private' | 'unknown'

interface IndexedContract {
  readonly source: string
  readonly cacheKind: EsiCatalogCacheKind
}

export function indexEsiCatalogEvidence(
  catalogSource: string,
  metadataSource: string,
  previousCatalogSource = '',
  previousMetadataSource = '',
) {
  const currentContracts = contractEntries(catalogSource)
  const currentMetadata = metadataEntries(metadataSource)
  const previousContracts = contractEntries(previousCatalogSource)
  const previousMetadata = metadataEntries(previousMetadataSource)
  const operations = new Set([
    ...currentContracts.keys(),
    ...currentMetadata.keys(),
    ...previousContracts.keys(),
    ...previousMetadata.keys(),
  ])

  return new Map<string, EsiCatalogEvidence>(
    [...operations].map((operation) => [
      operation,
      {
        contract: currentContracts.get(operation)?.source ?? null,
        cacheKind: currentContracts.get(operation)?.cacheKind ?? 'unknown',
        metadata: currentMetadata.get(operation) ?? null,
        previousContract: previousContracts.get(operation)?.source ?? null,
        previousMetadata: previousMetadata.get(operation) ?? null,
      } satisfies EsiCatalogEvidence,
    ]),
  )
}

function contractEntries(source: string) {
  const entries = new Map<string, IndexedContract>()
  if (!source) return entries
  const sourceFile = ts.createSourceFile('catalog.ts', source, ts.ScriptTarget.Latest, true)
  visit(sourceFile, (node) => {
    if (!isNamedCall(node, 'defineContract')) return
    const operation = node.arguments[0]
    if (operation && ts.isStringLiteralLike(operation))
      entries.set(operation.text, {
        source: node.getText(sourceFile),
        cacheKind: cacheKindIn(node),
      })
  })
  return entries
}

function cacheKindIn(contract: ts.CallExpression): EsiCatalogCacheKind {
  const options = contract.arguments[1]
  if (!options || !ts.isObjectLiteralExpression(options)) return 'unknown'
  const cache = options.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && propertyName(property.name) === 'cache',
  )
  if (!cache) return 'unknown'
  if (ts.isCallExpression(cache.initializer) && ts.isIdentifier(cache.initializer.expression)) {
    if (cache.initializer.expression.text === 'sharedPublicCache') return 'public'
    if (cache.initializer.expression.text === 'sharedPrivateCache') return 'private'
  }
  if (!ts.isObjectLiteralExpression(cache.initializer)) return 'unknown'
  const kind = cache.initializer.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && propertyName(property.name) === 'kind',
  )
  return kind && ts.isStringLiteralLike(kind.initializer) && kind.initializer.text === 'none'
    ? 'none'
    : 'unknown'
}

function metadataEntries(source: string) {
  const entries = new Map<string, string>()
  if (!source) return entries
  const sourceFile = ts.createSourceFile(
    'operation-metadata.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
  )
  visit(sourceFile, (node) => {
    if (!isNamedCall(node, 'defineOperationMetadata')) return
    const metadata = node.arguments[0]
    if (!metadata || !ts.isObjectLiteralExpression(metadata)) return
    for (const property of metadata.properties) {
      if (!ts.isPropertyAssignment(property)) continue
      const operation = propertyName(property.name)
      if (operation) entries.set(operation, property.getText(sourceFile))
    }
  })
  return entries
}

function isNamedCall(node: ts.Node, name: string): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name
  )
}

function propertyName(name: ts.PropertyName) {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : null
}

function visit(node: ts.Node, operation: (node: ts.Node) => void) {
  operation(node)
  ts.forEachChild(node, (child) => visit(child, operation))
}
