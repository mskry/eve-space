import { createRequire } from 'node:module'

const postgresMajorVersion = 17
const postgresVersionFloor = postgresMajorVersion * 10_000
const postgresVersionCeiling = (postgresMajorVersion + 1) * 10_000

export type PostgresAstValue =
  | boolean
  | number
  | string
  | null
  | readonly PostgresAstValue[]
  | PostgresAstObject

export interface PostgresAstObject {
  readonly [key: string]: PostgresAstValue | undefined
}

interface PostgresAstStatement {
  readonly kind: string
  readonly node: PostgresAstObject
}

export interface PostgresMigrationAst {
  readonly grammarMajorVersion: typeof postgresMajorVersion
  readonly parserVersion: number
  readonly statements: readonly PostgresAstStatement[]
}

interface Postgres17ParserModule {
  parse(sql: string): Promise<unknown>
}

type Postgres17ParserLoader = () => Postgres17ParserModule

export async function parsePostgres17Migration(
  sql: string,
  loadParser: Postgres17ParserLoader = loadPostgres17Parser,
): Promise<PostgresMigrationAst> {
  let parser: Postgres17ParserModule
  try {
    parser = loadParser()
  } catch {
    throw new PostgresMigrationParseError('load')
  }

  let result: unknown
  try {
    result = await parser.parse(sql)
  } catch {
    throw new PostgresMigrationParseError('syntax')
  }

  return normalizeParseResult(result)
}

export type PostgresMigrationParseFailure = 'load' | 'result' | 'syntax' | 'version'

export class PostgresMigrationParseError extends Error {
  constructor(readonly failure: PostgresMigrationParseFailure) {
    super(`PostgreSQL 17 migration parse failed: ${failure}`)
    this.name = 'PostgresMigrationParseError'
  }
}

function loadPostgres17Parser() {
  const require = createRequire(import.meta.url)
  return require('@pgsql/parser/v17') as Postgres17ParserModule
}

function normalizeParseResult(value: unknown): PostgresMigrationAst {
  if (!isObject(value)) throw new PostgresMigrationParseError('result')
  const parserVersion = value.version
  if (
    typeof parserVersion !== 'number' ||
    !Number.isInteger(parserVersion) ||
    parserVersion < postgresVersionFloor ||
    parserVersion >= postgresVersionCeiling
  )
    throw new PostgresMigrationParseError('version')
  if (!Array.isArray(value.stmts)) throw new PostgresMigrationParseError('result')

  return {
    grammarMajorVersion: postgresMajorVersion,
    parserVersion,
    statements: value.stmts.map(normalizeStatement),
  }
}

function normalizeStatement(value: unknown): PostgresAstStatement {
  if (!isObject(value) || !isObject(value.stmt)) throw new PostgresMigrationParseError('result')
  const entries = Object.entries(value.stmt)
  if (entries.length !== 1) throw new PostgresMigrationParseError('result')
  const [kind, node] = entries[0]!
  if (!kind || !isObject(node)) throw new PostgresMigrationParseError('result')
  return { kind, node: node as PostgresAstObject }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
