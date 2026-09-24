import { readdir, readFile } from 'node:fs/promises'
import { clientRequestIn } from './client-request.js'

const DEFINITION_DIRECTORIES = ['app/queries/']
const DECLARATION_PATTERN = /^(?:export )?(?:const|function) (\w+)/gm
const DEFINITION_LINES = 40
const SPREAD_PATTERN = /\.\.\.(\w+)\s*\(/g
const CALL_PATTERN = /\b(\w+)\s*\(/g

export interface QueryDefinition {
  name: string
  source: string
  method: string
  requestPath: string
  excerpt: string
}

export const indexQueryDefinitions = async (root: URL): Promise<Map<string, QueryDefinition>> => {
  const listings = await Promise.all(
    DEFINITION_DIRECTORIES.map((directory) => listTypeScriptFiles(root, directory)),
  )
  const files = listings.flat()
  const sources = await Promise.all(files.map((file) => readFile(new URL(file, root), 'utf8')))

  const declarations = files.flatMap((file, index) => declarationsIn(file, sources[index]))
  const definitions = new Map(
    declarations
      .filter((declaration) => declaration.definition)
      .map((declaration) => [declaration.name, declaration.definition!] as const),
  )

  indexDelegatedDefinitions(declarations, definitions)

  return definitions
}

export const referencedDefinition = (
  excerpt: string,
  definitions: ReadonlyMap<string, QueryDefinition>,
) =>
  firstDefinition(excerpt, SPREAD_PATTERN, definitions) ??
  firstDefinition(excerpt, CALL_PATTERN, definitions)

const firstDefinition = (
  excerpt: string,
  pattern: RegExp,
  definitions: ReadonlyMap<string, QueryDefinition>,
) =>
  [...excerpt.matchAll(pattern)]
    .map(([, name]) => definitions.get(name))
    .find((definition) => definition !== undefined) ?? null

const indexDelegatedDefinitions = (
  declarations: readonly Declaration[],
  definitions: Map<string, QueryDefinition>,
) => {
  const unresolved = declarations.filter((declaration) => declaration.definition === null)

  for (const declaration of unresolved) {
    indexDelegatedDefinition(declaration, definitions)
  }
}

const indexDelegatedDefinition = (
  declaration: Declaration,
  definitions: Map<string, QueryDefinition>,
) => {
  const delegate = firstDefinition(declaration.body, CALL_PATTERN, definitions)

  if (delegate) {
    definitions.set(declaration.name, { ...delegate, name: declaration.name })
  }
}

const listTypeScriptFiles = async (root: URL, directory: string) => {
  try {
    const entries = await readdir(new URL(directory, root), { withFileTypes: true })

    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
      .map((entry) => `${directory}${entry.name}`)
  } catch {
    return []
  }
}

interface Declaration {
  name: string
  body: string
  definition: QueryDefinition | null
}

const declarationsIn = (source: string, contents: string): Declaration[] => {
  const declarations = [...contents.matchAll(DECLARATION_PATTERN)]

  return declarations.map((match, index) => {
    const body = contents.slice(match.index, declarations[index + 1]?.index ?? contents.length)

    return {
      body,
      definition: queryDefinitionIn(match[1], source, body),
      name: match[1],
    }
  })
}

const queryDefinitionIn = (name: string, source: string, body: string) => {
  const request = clientRequestIn(body)

  if (!request) {
    return null
  }

  return {
    excerpt: body.split('\n').slice(0, DEFINITION_LINES).join('\n').trim(),
    method: request.method,
    name,
    requestPath: request.requestPath,
    source,
  }
}
