import type { Migration } from './migration-validation.js'
import { maskSqlLiteralsAndComments } from './sql-validation.js'

const identifier = String.raw`(?:"(?:""|[^"])+"|[A-Za-z_][A-Za-z0-9_$]*)`
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
    pattern:
      /\b(?:grant|revoke)\b|\b(?:create|alter|drop)\s+(?:role|user|group)\b|\balter\s+default\s+privileges\b|\bowner\s+to\b/i,
  },
  {
    name: 'role or session authorization changes',
    pattern:
      /\b(?:set|reset)\s+(?:local\s+|session\s+)?role\b|\b(?:set|reset)\s+session\s+authorization\b|\bset_config\s*\(/i,
  },
  {
    name: 'extension management',
    pattern: /\b(?:create|alter|drop)\s+extension\b/i,
  },
  {
    name: 'deployment-wide operations',
    pattern:
      /\b(?:create|alter|drop)\s+(?:schema|database|tablespace|subscription|publication|server|foreign\s+data\s+wrapper|user\s+mapping|event\s+trigger|language|access\s+method)\b|\balter\s+system\b|\bset\s+schema\b|\btablespace\b|\b(?:copy|vacuum|cluster|discard|do|call)\b|\b(?:create|alter|drop)\s+(?:function|procedure|routine|aggregate)\b/i,
  },
  {
    name: 'temporary object operations',
    pattern:
      /\bcreate\s+(?:global\s+|local\s+)?temp(?:orary)?\b|\binto\s+(?:global\s+|local\s+)?temp(?:orary)?\b/i,
  },
]

export function assertModuleMigrationSql(
  moduleId: string,
  schemaName: string,
  migration: Migration,
) {
  const policySql = maskSqlLiteralsAndComments(migration.sql, { rejectUnterminated: true })
  const prohibited = prohibitedOperations.find(({ pattern }) => pattern.test(policySql))
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
  return qualifiers
}

function normalizeIdentifier(value: string) {
  return value.startsWith('"') ? value.slice(1, -1).replaceAll('""', '"') : value.toLowerCase()
}

function violation(moduleId: string, migrationName: string, reason: string) {
  return new Error(
    `Module migration ${moduleId}/${migrationName} is not schema-contained: ${reason}`,
  )
}
