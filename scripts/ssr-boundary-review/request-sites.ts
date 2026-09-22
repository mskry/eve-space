import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { changedRepositoryFiles } from '../jev/changed-files.js'
import { clientRequestIn } from './client-request.js'
import { indexQueryDefinitions, referencedDefinition } from './query-definitions.js'

const REVIEWED_DIRECTORIES = ['app/', 'layers/']
const REVIEWED_EXTENSIONS = ['.ts', '.vue']
const EXCERPT_LINES_BEFORE = 14
const HELPER_LINES = 20
const EXCERPT_LINES_AFTER = 10
const HELPER_ENTRY_PATTERN =
  /\b(useQuery|useFetch|useAsyncData|prefetchQuery|prefetchProtectedQuery|ensureQuery|refetchQueries)\s*[(<]/
const FETCH_ENTRY_PATTERN = /\$fetch\s*[(<]/
const SIBLING_PATTERN = /^\s*(?:const|let|var|function|async function|return)\b/
const FETCH_REQUEST_PATTERN = /\$fetch\s*\(\s*['"]([^'"]+)['"]/
const FETCH_METHOD_PATTERN = /\bmethod\s*:\s*['"](get|post|put|patch|delete)['"]/i
const ENTRY_HELPER_DECLARATIONS = new Map([
  [
    'prefetchProtectedQuery',
    [
      { source: 'app/queries/query-cache.ts', name: 'prefetchProtectedQuery' },
      {
        source: 'app/queries/protected-character-query-access.ts',
        name: 'canRunProtectedCharacterQuery',
      },
    ],
  ],
])

export interface RequestSite {
  id: string
  file: string
  line: number
  entry: string
  excerpt: string
  method: string | null
  requestPath: string | null
  definitionSource: string | null
  definitionExcerpt: string | null
  localHelpers: string | null
}

export const changedFrontendFiles = async (root: string, base: string) => {
  return (await changedRepositoryFiles(root, base)).filter(isReviewedFile)
}

export const collectRequestSites = async (root: URL, files: readonly string[]) => {
  const [definitions, entryHelpers] = await Promise.all([
    indexQueryDefinitions(root),
    indexEntryHelpers(root),
  ])
  const sources = await Promise.all(files.map((file) => readSource(root, file)))

  return files.flatMap((file, index) =>
    sitesInSource(file, sources[index], definitions, entryHelpers),
  )
}

const isReviewedFile = (file: string) =>
  REVIEWED_DIRECTORIES.some((directory) => file.startsWith(directory)) &&
  REVIEWED_EXTENSIONS.some((extension) => file.endsWith(extension))

const readSource = async (root: URL, file: string) => {
  try {
    return await readFile(new URL(file, root), 'utf8')
  } catch {
    return ''
  }
}

type DefinitionIndex = Awaited<ReturnType<typeof indexQueryDefinitions>>
type EntryHelperIndex = ReadonlyMap<string, string>

const sitesInSource = (
  file: string,
  source: string,
  definitions: DefinitionIndex,
  entryHelpers: EntryHelperIndex,
): RequestSite[] => {
  const lines = source.split('\n')
  const excludedLines = inlineMutationCallbackLines(file, source)

  return lines.flatMap((line, index) => {
    if (excludedLines.has(index)) return []
    return requestSiteOnLine(file, lines, line, index, definitions, entryHelpers)
  })
}

const inlineMutationCallbackLines = (file: string, source: string) => {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const excludedLines = new Set<number>()

  const visit = (node: ts.Node) => {
    if (isUseMutationCall(node)) {
      const callback = inlineMutationCallback(node.arguments[0])
      if (callback) addNodeLines(excludedLines, sourceFile, callback)
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return excludedLines
}

const isUseMutationCall = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === 'useMutation'

const inlineMutationCallback = (argument: ts.Expression | undefined) => {
  if (!argument || !ts.isObjectLiteralExpression(argument)) return null

  const property = argument.properties.find((candidate) => propertyName(candidate) === 'mutation')
  if (property && ts.isMethodDeclaration(property)) return property
  if (!property || !ts.isPropertyAssignment(property)) return null

  const { initializer } = property
  return ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)
    ? initializer
    : null
}

const propertyName = (property: ts.ObjectLiteralElementLike) => {
  const { name } = property
  return name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? name.text : null
}

const addNodeLines = (lines: Set<number>, sourceFile: ts.SourceFile, node: ts.Node) => {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line
  const end = sourceFile.getLineAndCharacterOfPosition(
    Math.max(node.getStart(sourceFile), node.end - 1),
  ).line

  for (let line = start; line <= end; line += 1) lines.add(line)
}

const requestSiteOnLine = (
  file: string,
  lines: readonly string[],
  line: string,
  index: number,
  definitions: DefinitionIndex,
  entryHelpers: EntryHelperIndex,
): RequestSite[] => {
  const entry = entryIn(line)

  if (!entry) return []

  return [
    {
      id: `${file}:${index + 1}`,
      file,
      line: index + 1,
      entry,
      excerpt: excerptAround(lines, index),
      localHelpers: combineHelperEvidence(localHelpersFor(lines, index), entryHelpers.get(entry)),
      ...resolveRequest(resolutionScope(lines, index), definitions),
    },
  ]
}

const indexEntryHelpers = async (root: URL): Promise<EntryHelperIndex> => {
  const entries = await Promise.all(
    [...ENTRY_HELPER_DECLARATIONS].map(async ([entry, declarations]) => {
      const excerpts = await Promise.all(
        declarations.map(async ({ source, name }) =>
          declarationIn(source, await readSource(root, source), name),
        ),
      )
      return [entry, excerpts.filter(Boolean).join('\n\n')] as const
    }),
  )

  return new Map(entries)
}

const declarationIn = (file: string, source: string, name: string) => {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const declaration = sourceFile.statements.find(
    (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  )

  return declaration?.getText(sourceFile) ?? ''
}

const combineHelperEvidence = (...evidence: Array<string | null | undefined>) => {
  const combined = evidence.filter(Boolean).join('\n\n').trim()
  return combined.length > 0 ? combined : null
}

const entryIn = (line: string) =>
  HELPER_ENTRY_PATTERN.exec(line)?.[1] ?? fetchEntryIn(line) ?? clientEntryIn(line)

const fetchEntryIn = (line: string) => (FETCH_ENTRY_PATTERN.test(line) ? '$fetch' : null)

const clientEntryIn = (line: string) => {
  const request = clientRequestIn(line)
  return request ? `$${request.method.toLowerCase()}` : null
}

const excerptAround = (lines: readonly string[], index: number) =>
  lines
    .slice(Math.max(0, index - EXCERPT_LINES_BEFORE), index + EXCERPT_LINES_AFTER)
    .join('\n')
    .trim()

const resolutionScope = (lines: readonly string[], index: number) => {
  const window = lines.slice(index, index + EXCERPT_LINES_AFTER)
  const indent = indentOf(window[0])
  const sibling = window.findIndex((line, offset) => isScopeSibling(line, offset, indent))

  return (sibling === -1 ? window : window.slice(0, sibling)).join('\n')
}

const isScopeSibling = (line: string, offset: number, indent: number) =>
  offset > 0 && indentOf(line) <= indent && (SIBLING_PATTERN.test(line) || entryIn(line) !== null)

const indentOf = (line: string) => /^(\s*)\S/.exec(line)?.[1].length ?? 0

const localHelpersFor = (lines: readonly string[], index: number) => {
  const referenced = new Set(
    [...resolutionScope(lines, index).matchAll(/\b([a-z]\w*)\s*\(/g)].map((match) => match[1]),
  )
  const captured = [...referenced]
    .flatMap((name) => declarationLines(lines, name, index))
    .join('\n')
    .trim()

  return captured.length > 0 ? captured : null
}

const declarationLines = (lines: readonly string[], name: string, before: number) => {
  const pattern = new RegExp(String.raw`^\s*(?:const|let|function)\s+${name}\b`)
  const start = lines.findIndex((line, offset) => offset < before && pattern.test(line))

  if (start === -1) return []

  return lines.slice(start, declarationEnd(lines, start, before))
}

const declarationEnd = (lines: readonly string[], start: number, before: number) => {
  const indent = indentOf(lines[start])
  const end = lines.findIndex((line, offset) => declarationEndsAt(line, offset, start, indent))

  return end === -1 ? Math.min(start + HELPER_LINES, before) : end
}

const declarationEndsAt = (line: string, offset: number, start: number, indent: number) =>
  offset > start && line.trim().length > 0 && indentOf(line) <= indent && !/^\s*[)\]}]/.test(line)

const resolveRequest = (scope: string, definitions: DefinitionIndex) =>
  resolveDefinitionRequest(scope, definitions) ??
  resolveClientRequest(scope) ??
  resolveFetchRequest(scope) ?? {
    method: null,
    requestPath: null,
    definitionSource: null,
    definitionExcerpt: null,
  }

const resolveDefinitionRequest = (scope: string, definitions: DefinitionIndex) => {
  const definition = referencedDefinition(scope, definitions)

  if (!definition) return null

  return {
    method: definition.method,
    requestPath: definition.requestPath,
    definitionSource: `${definition.source} (${definition.name})`,
    definitionExcerpt: definition.excerpt,
  }
}

const resolveClientRequest = (scope: string) => {
  const request = clientRequestIn(scope)

  if (!request) return null

  return {
    method: request.method,
    requestPath: request.requestPath,
    definitionSource: null,
    definitionExcerpt: null,
  }
}

const resolveFetchRequest = (scope: string) => {
  const fetch = FETCH_REQUEST_PATTERN.exec(scope)

  if (!fetch) return null

  return {
    method: FETCH_METHOD_PATTERN.exec(scope)?.[1]?.toUpperCase() ?? 'GET',
    requestPath: fetch[1],
    definitionSource: null,
    definitionExcerpt: null,
  }
}
