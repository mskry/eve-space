import type { Migration } from './migration-validation.js'
import { maskSqlLiteralsAndComments } from './sql-validation.js'

const identifier = `(?:"(?:""|[^"])+"|[A-Za-z_][A-Za-z0-9_$]*)`
const qualifiedIdentifierPattern = new RegExp(
  String.raw`(${identifier})\s*\.\s*(?:${identifier}|\*)`,
  'g',
)
const relationReferencePattern = new RegExp(
  String.raw`\b(?:from|join|update|into|references|truncate(?:\s+table)?)\s+(?:only\s+)?(?:(${identifier})\s*\.\s*)?(${identifier})`,
  'gi',
)
const relationAliasPattern = new RegExp(
  String.raw`\b(?:from|join|update|into)\s+(?:only\s+)?(?:(${identifier})\s*\.\s*)?(${identifier})(?=\s+(?:as\s+)?(${identifier}))`,
  'gi',
)
const derivedRelationStartPattern = /\b(?:from|join)\s+(?:lateral\s+)?/gi
const identifierPattern = new RegExp(`^${identifier}`)
const ctePattern = new RegExp(String.raw`(?:\bwith|,)\s*(${identifier})\s+as\s*\(`, 'gi')
const reservedAliasKeywords = new Set([
  'cross',
  'full',
  'group',
  'inner',
  'join',
  'left',
  'limit',
  'on',
  'order',
  'outer',
  'returning',
  'right',
  'set',
  'using',
  'values',
  'where',
])
const allowedStatements = [
  /^create\s+(?:unlogged\s+)?table\b/i,
  /^create\s+(?:unique\s+)?index\b/i,
  /^create\s+sequence\b/i,
  /^create\s+type\b/i,
  /^create\s+domain\b/i,
  /^create\s+(?:or\s+replace\s+)?view\b/i,
  /^create\s+materialized\s+view\b/i,
  /^create\s+trigger\b/i,
  /^create\s+policy\b/i,
  /^alter\s+(?:table|index|sequence|type|domain|view|materialized\s+view|trigger|policy)\b/i,
  /^drop\s+(?:table|index|sequence|type|domain|view|materialized\s+view|trigger|policy)\b/i,
  /^(?:insert|update|delete|truncate|select|with)\b/i,
  /^comment\s+on\b/i,
]
const prohibitedOperations = [
  {
    name: 'role, privilege, or ownership changes',
    patterns: [
      /\b(?:grant|revoke)\b|\b(?:create|alter|drop)\s+(?:role|user|group)\b|\balter\s+default\s+privileges\b|\bowner\s+to\b/i,
    ],
  },
  {
    name: 'role or session authorization changes',
    patterns: [
      /\b(?:set|reset)\s+(?:(?:local|session)\s+)?role\b/i,
      /\b(?:set|reset)\s+session\s+authorization\b/i,
      /\bset_config\s*\(/i,
    ],
  },
  {
    name: 'extension management',
    patterns: [/\b(?:create|alter|drop)\s+extension\b/i],
  },
  {
    name: 'deployment-wide operations',
    patterns: [
      /\b(?:create|alter|drop)\s+(?:schema|database|tablespace|subscription|publication|server|language)\b/i,
      /\b(?:create|alter|drop)\s+foreign\s+data\s+wrapper\b/i,
      /\b(?:create|alter|drop)\s+user\s+mapping\b/i,
      /\b(?:create|alter|drop)\s+event\s+trigger\b/i,
      /\b(?:create|alter|drop)\s+access\s+method\b/i,
      /\balter\s+system\b/i,
      /\bset\s+schema\b/i,
      /\btablespace\b/i,
      /\b(?:copy|vacuum|cluster|discard|do|call)\b/i,
      /\b(?:create|alter|drop)\s+(?:function|procedure|routine|aggregate)\b/i,
    ],
  },
  {
    name: 'temporary object operations',
    patterns: [/\b(?:create|into)\s+(?:(?:global|local)\s+)?temp(?:orary)?\b/i],
  },
]

export function assertModuleMigrationSql(
  moduleId: string,
  schemaName: string,
  migration: Migration,
) {
  const policySql = maskSqlLiteralsAndComments(migration.sql, { rejectUnterminated: true })
  const prohibited = prohibitedOperations.find(({ patterns }) =>
    patterns.some((pattern) => pattern.test(policySql)),
  )
  if (prohibited) throw violation(moduleId, migration.name, prohibited.name)

  const qualificationSql = maskSqlLiteralsAndComments(migration.sql, {
    preserveQuotedIdentifiers: true,
    rejectUnterminated: true,
  })
  for (const { policy, qualification } of splitStatements(policySql, qualificationSql)) {
    const localQualifiers = collectLocalQualifiers(qualification, schemaName)
    for (const match of qualification.matchAll(qualifiedIdentifierPattern)) {
      const qualifier = normalizeIdentifier(match[1]!)
      if (qualifier !== schemaName && !localQualifiers.has(qualifier))
        throw violation(moduleId, migration.name, `cross-schema reference ${qualifier}`)
    }

    const statement = policy.trim()
    if (!statement) continue
    if (!allowedStatements.some((pattern) => pattern.test(statement)))
      throw violation(moduleId, migration.name, 'unsupported SQL statement')
  }
}

function splitStatements(policySql: string, qualificationSql: string) {
  const statements: { policy: string; qualification: string }[] = []
  let start = 0
  for (let index = 0; index < policySql.length; index += 1) {
    if (policySql[index] !== ';') continue
    statements.push({
      policy: policySql.slice(start, index),
      qualification: qualificationSql.slice(start, index),
    })
    start = index + 1
  }
  statements.push({ policy: policySql.slice(start), qualification: qualificationSql.slice(start) })
  return statements
}

function collectLocalQualifiers(statement: string, schemaName: string) {
  const qualifiers = new Set<string>()
  for (const match of statement.matchAll(ctePattern)) qualifiers.add(normalizeIdentifier(match[1]!))
  for (const match of statement.matchAll(relationReferencePattern)) {
    const referencedSchema = match[1] ? normalizeIdentifier(match[1]) : undefined
    if (!referencedSchema || referencedSchema === schemaName)
      qualifiers.add(normalizeIdentifier(match[2]!))
  }

  for (const match of statement.matchAll(relationAliasPattern)) {
    const referencedSchema = match[1] ? normalizeIdentifier(match[1]) : undefined
    const alias = match[3] ? normalizeIdentifier(match[3]) : undefined
    if (
      (!referencedSchema || referencedSchema === schemaName) &&
      alias &&
      !reservedAliasKeywords.has(alias)
    )
      qualifiers.add(alias)
  }
  for (const alias of collectDerivedRelationAliases(statement)) qualifiers.add(alias)
  return qualifiers
}

function collectDerivedRelationAliases(statement: string) {
  const aliases = new Set<string>()
  for (const match of statement.matchAll(derivedRelationStartPattern)) {
    const alias = readDerivedRelationAlias(statement, match.index + match[0].length)
    if (alias) aliases.add(alias)
  }
  return aliases
}

function readDerivedRelationAlias(statement: string, start: number) {
  let index = skipWhitespace(statement, start)
  if (statement[index] === '(')
    return readRelationAlias(statement, skipParenthesizedExpression(statement, index))

  const relation = readIdentifier(statement, index)
  if (!relation) return undefined
  index = skipWhitespace(statement, relation.end)
  if (statement[index] === '.') {
    const member = readIdentifier(statement, skipWhitespace(statement, index + 1))
    if (!member) return undefined
    index = skipWhitespace(statement, member.end)
  }
  if (statement[index] !== '(') return undefined
  return readRelationAlias(statement, skipParenthesizedExpression(statement, index))
}

function readRelationAlias(statement: string, index: number) {
  index = skipWhitespace(statement, index)
  if (/^as\b/i.test(statement.slice(index))) index = skipWhitespace(statement, index + 2)
  const alias = readIdentifier(statement, index)
  if (!alias) return undefined
  const normalized = normalizeIdentifier(alias.value)
  return reservedAliasKeywords.has(normalized) ? undefined : normalized
}

function skipParenthesizedExpression(statement: string, start: number) {
  let depth = 0
  for (let index = start; index < statement.length; index = skipExpressionToken(statement, index)) {
    if (statement[index] === '(') depth += 1
    if (statement[index] !== ')') continue
    depth -= 1
    if (depth === 0) return index + 1
  }
  return statement.length
}

function skipExpressionToken(statement: string, start: number) {
  if (statement[start] !== '"') return start + 1
  for (let index = start + 1; index < statement.length; index += 1) {
    if (statement[index] !== '"') continue
    if (statement[index + 1] === '"') {
      index += 1
      continue
    }
    return index + 1
  }
  return statement.length
}

function readIdentifier(statement: string, index: number) {
  const value = identifierPattern.exec(statement.slice(index))?.[0]
  return value ? { value, end: index + value.length } : undefined
}

function skipWhitespace(statement: string, index: number) {
  while (/\s/.test(statement[index] ?? '')) index += 1
  return index
}

function normalizeIdentifier(value: string) {
  return value.startsWith('"') ? value.slice(1, -1).replaceAll('""', '"') : value.toLowerCase()
}

function violation(moduleId: string, migrationName: string, reason: string) {
  return new Error(
    `Module migration ${moduleId}/${migrationName} is not schema-contained: ${reason}`,
  )
}
