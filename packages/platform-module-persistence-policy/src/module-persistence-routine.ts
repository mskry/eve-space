import { createHash } from 'node:crypto'
import type { PlatformPersistenceOperationMode } from '@eve-space/platform-module-contract/persistence'
import {
  parsePostgres17Migration,
  type PostgresAstObject,
  type PostgresAstValue,
  type PostgresMigrationAst,
} from './postgres17-parser.js'
import {
  modulePersistenceNames,
  modulePersistenceRoutineName,
} from './module-persistence-identity.js'

interface PersistenceRoutineDefinitionIdentity {
  readonly moduleId: string
  readonly operationId: string
  readonly revision: number
  readonly mode: PlatformPersistenceOperationMode
  readonly schemaName: string
  readonly routineName: string
}

export interface CanonicalPersistenceRoutine {
  readonly identity: PersistenceRoutineDefinitionIdentity
  readonly canonicalDefinition: string
  readonly definitionFingerprint: string
}

export async function canonicalizePersistenceRoutineSql(input: {
  readonly moduleId: string
  readonly operationId: string
  readonly revision: number
  readonly mode: PlatformPersistenceOperationMode
  readonly sql: string
}): Promise<CanonicalPersistenceRoutine> {
  const ast = await parsePostgres17Migration(input.sql)
  return canonicalizePersistenceRoutineAst({ ...input, ast })
}

function canonicalizePersistenceRoutineAst(input: {
  readonly moduleId: string
  readonly operationId: string
  readonly revision: number
  readonly mode: PlatformPersistenceOperationMode
  readonly ast: PostgresMigrationAst
}): CanonicalPersistenceRoutine {
  const { schemaName } = modulePersistenceNames(input.moduleId)
  const routineName = modulePersistenceRoutineName(input.operationId)
  const routines = input.ast.statements.filter(
    (statement) =>
      statement.kind === 'CreateFunctionStmt' &&
      hasRoutineIdentity(statement.node, schemaName, routineName),
  )
  if (routines.length !== 1) {
    throw new Error(
      `Persistence routine definition mismatch: ${input.moduleId}/${input.operationId}`,
    )
  }
  const routine = routines[0]!.node
  const parameterNames = routineParameterNames(routine.parameters)
  const identity = {
    moduleId: input.moduleId,
    operationId: input.operationId,
    revision: input.revision,
    mode: input.mode,
    schemaName,
    routineName,
  } as const
  // Canonical key order is part of the persisted routine fingerprint.
  const canonicalDefinition = JSON.stringify({
    identity,
    signature: {
      parameters: normalizeRoutineParameters(routine.parameters),
      returnType: normalizeAst(routine.returnType ?? null),
    },
    attributes: {
      language: routineOption(routine, 'language'),
      parallel: routineOption(routine, 'parallel') ?? 'unsafe',
      volatility: routineOption(routine, 'volatility') ?? 'volatile',
    },
    body: normalizeRoutineBody(routine.sql_body ?? null, schemaName, routineName, parameterNames),
  })
  return {
    canonicalDefinition,
    definitionFingerprint: createHash('sha256').update(canonicalDefinition).digest('hex'),
    identity,
  }
}

function hasRoutineIdentity(node: PostgresAstObject, schemaName: string, routineName: string) {
  const names = astStringList(node.funcname)
  return names.length === 2 && names[0] === schemaName && names[1] === routineName
}

function normalizeRoutineParameters(value: PostgresAstValue | undefined) {
  if (!Array.isArray(value)) {
    return normalizeAst(value ?? [])
  }
  return value.map((entry) => {
    if (!isAstObject(entry) || !isAstObject(entry.FunctionParameter)) {
      return normalizeAst(entry)
    }
    const parameter = entry.FunctionParameter
    return {
      name: parameter.name ?? null,
      type: normalizeAst(parameter.argType ?? null),
      mode:
        parameter.mode === 'FUNC_PARAM_DEFAULT' || parameter.mode === 'FUNC_PARAM_IN'
          ? 'in'
          : parameter.mode,
      defaultExpression: parameter.defexpr === undefined ? null : normalizeAst(parameter.defexpr),
    }
  })
}

function routineOption(node: PostgresAstObject, name: string) {
  if (!Array.isArray(node.options)) {
    return null
  }
  for (const option of node.options) {
    if (!isAstObject(option) || !isAstObject(option.DefElem)) {
      continue
    }
    if (option.DefElem.defname !== name) {
      continue
    }
    const argument = option.DefElem.arg
    if (!isAstObject(argument) || !isAstObject(argument.String)) {
      return null
    }
    return typeof argument.String.sval === 'string' ? argument.String.sval : null
  }
  return null
}

function astStringList(value: PostgresAstValue | undefined) {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((entry) => {
    if (!isAstObject(entry) || !isAstObject(entry.String)) {
      return []
    }
    return typeof entry.String.sval === 'string' ? [entry.String.sval] : []
  })
}

function routineParameterNames(value: PostgresAstValue | undefined) {
  if (!Array.isArray(value)) {
    return new Set<string>()
  }
  return new Set(
    value.flatMap((entry) => {
      if (!isAstObject(entry) || !isAstObject(entry.FunctionParameter)) {
        return []
      }
      const name = entry.FunctionParameter.name
      return typeof name === 'string' ? [name] : []
    }),
  )
}

function normalizeRoutineBody(
  value: PostgresAstValue,
  schemaName: string,
  routineName: string,
  parameterNames: ReadonlySet<string>,
) {
  return normalizeRoutineAst(value, {
    parameterNames,
    routineName,
    schemaName,
  })
}

function normalizeRoutineAst(
  value: PostgresAstValue,
  routine: {
    readonly parameterNames: ReadonlySet<string>
    readonly routineName: string
    readonly schemaName: string
  },
  parentKind?: string,
  parentField?: string,
  defaultRelationName?: string,
  implicitRelationAliases: ReadonlyMap<string, string> = new Map(),
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      normalizeRoutineAst(
        entry,
        routine,
        parentKind,
        parentField,
        defaultRelationName,
        implicitRelationAliases,
      ),
    )
  }
  if (!isAstObject(value)) {
    return value
  }
  const relationScope = statementRelationScope(
    value,
    parentKind,
    parentField,
    defaultRelationName,
    implicitRelationAliases,
  )
  const scopedRelationName = relationScope.defaultRelationName
  const scopedRelationAliases = relationScope.implicitAliases

  if (parentKind === 'TypeCast' && parentField === 'typeName') {
    return normalizeRoutineAst(
      normalizeRoutineTypeName(value),
      routine,
      'TypeName',
      undefined,
      scopedRelationName,
      scopedRelationAliases,
    )
  }
  if (isAstObject(value.ColumnRef)) {
    return {
      ColumnRef: normalizeRoutineAst(
        normalizeRoutineColumnReference(
          value.ColumnRef,
          routine,
          scopedRelationName,
          scopedRelationAliases,
        ),
        routine,
        'ColumnRef',
        undefined,
        scopedRelationName,
        scopedRelationAliases,
      ),
    }
  }
  if (
    ((parentKind === 'SelectStmt' && parentField === 'targetList') ||
      ((parentKind === 'InsertStmt' || parentKind === 'DeleteStmt') &&
        parentField === 'returningList')) &&
    isAstObject(value.ResTarget)
  ) {
    return {
      ResTarget: normalizeRoutineAst(
        removeImplicitSelectTargetName(value.ResTarget),
        routine,
        'ResTarget',
        undefined,
        scopedRelationName,
        scopedRelationAliases,
      ),
    }
  }

  const relationNormalizedValue = removeImplicitRelationAlias(value, scopedRelationAliases)
  const normalizedValue =
    typeof relationNormalizedValue.relname === 'string'
      ? removeOwningSchemaQualification(relationNormalizedValue, routine.schemaName)
      : relationNormalizedValue
  return Object.fromEntries(
    Object.entries(normalizedValue)
      .filter(
        ([key, entry]) =>
          entry !== undefined && !['location', 'stmt_len', 'stmt_location'].includes(key),
      )
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => {
        const wrappedKind = /^[A-Z]/.test(key) && isAstObject(entry) ? key : parentKind
        return [
          key,
          normalizeRoutineAst(
            entry!,
            routine,
            wrappedKind,
            wrappedKind === key ? undefined : key,
            scopedRelationName,
            scopedRelationAliases,
          ),
        ]
      }),
  )
}

function statementRelationScope(
  node: PostgresAstObject,
  kind: string | undefined,
  field: string | undefined,
  inherited: string | undefined,
  inheritedAliases: ReadonlyMap<string, string>,
) {
  if (field !== undefined) {
    return { defaultRelationName: inherited, implicitAliases: inheritedAliases }
  }
  if (kind === 'SelectStmt' && Array.isArray(node.fromClause) && node.fromClause.length > 0) {
    return {
      defaultRelationName: soleRelationName(node.fromClause),
      implicitAliases: statementImplicitAliases(node.fromClause),
    }
  }
  if (kind === 'DeleteStmt' || kind === 'UpdateStmt') {
    return {
      defaultRelationName: relationName(node.relation),
      implicitAliases: statementImplicitAliases(node.relation),
    }
  }
  return { defaultRelationName: inherited, implicitAliases: inheritedAliases }
}

function soleRelationName(value: PostgresAstValue | undefined) {
  if (!Array.isArray(value) || value.length !== 1) {
    return
  }
  return relationName(value[0])
}

function relationName(value: PostgresAstValue | undefined): string | undefined {
  if (!isAstObject(value)) {
    return undefined
  }
  if (typeof value.relname === 'string') {
    return rangeVariableName(value)
  }
  if (isAstObject(value.RangeVar)) {
    return rangeVariableName(value.RangeVar)
  }
  if (isAstObject(value.RangeSubselect) && isAstObject(value.RangeSubselect.alias)) {
    const alias = value.RangeSubselect.alias.aliasname
    return typeof alias === 'string' ? alias : undefined
  }
  if (isAstObject(value.RangeFunction) && isAstObject(value.RangeFunction.alias)) {
    const alias = value.RangeFunction.alias.aliasname
    return typeof alias === 'string' ? alias : undefined
  }
  return undefined
}

function rangeVariableName(relation: PostgresAstObject) {
  if (typeof relation.relname !== 'string') {
    return
  }
  if (!isAstObject(relation.alias) || typeof relation.alias.aliasname !== 'string') {
    return relation.relname
  }
  return relation.alias.aliasname === `${relation.relname}_1`
    ? relation.relname
    : relation.alias.aliasname
}

function statementImplicitAliases(value: PostgresAstValue | undefined) {
  const implicitAliases = new Map<string, string>()
  visit(value)
  return implicitAliases

  function visit(candidate: PostgresAstValue | undefined) {
    if (Array.isArray(candidate)) {
      for (const entry of candidate) {
        visit(entry)
      }
      return
    }
    if (!isAstObject(candidate)) {
      return
    }
    if (isAstObject(candidate.RangeVar)) {
      record(candidate.RangeVar)
      return
    }
    if (typeof candidate.relname === 'string') {
      record(candidate)
      return
    }
    if (isAstObject(candidate.JoinExpr)) {
      visit(candidate.JoinExpr.larg)
      visit(candidate.JoinExpr.rarg)
    }
  }

  function record(relation: PostgresAstObject) {
    if (
      typeof relation.relname !== 'string' ||
      !isAstObject(relation.alias) ||
      relation.alias.aliasname !== `${relation.relname}_1`
    ) {
      return
    }
    implicitAliases.set(String(relation.alias.aliasname), relation.relname)
  }
}

function normalizeRoutineColumnReference(
  node: PostgresAstObject,
  routine: {
    readonly parameterNames: ReadonlySet<string>
    readonly routineName: string
  },
  defaultRelationName?: string,
  implicitRelationAliases: ReadonlyMap<string, string> = new Map(),
) {
  const parameterNormalized = normalizeRoutineParameterReference(node, routine)
  const fields = astStringList(parameterNormalized.fields)
  if (
    fields.length === 1 &&
    defaultRelationName !== undefined &&
    !routine.parameterNames.has(fields[0]!)
  ) {
    return {
      ...parameterNormalized,
      fields: [{ String: { sval: defaultRelationName } }, { String: { sval: fields[0]! } }],
    }
  }
  if (fields.length !== 2) {
    return parameterNormalized
  }
  const canonicalRelationName = implicitRelationAliases.get(fields[0]!)
  if (!canonicalRelationName) {
    return parameterNormalized
  }
  return {
    ...parameterNormalized,
    fields: [{ String: { sval: canonicalRelationName } }, { String: { sval: fields[1]! } }],
  }
}

function removeImplicitRelationAlias(
  node: PostgresAstObject,
  implicitAliases: ReadonlyMap<string, string>,
) {
  if (
    !isAstObject(node.alias) ||
    typeof node.alias.aliasname !== 'string' ||
    !implicitAliases.has(node.alias.aliasname)
  ) {
    return node
  }
  const { alias: _alias, ...withoutAlias } = node
  return withoutAlias
}

function removeOwningSchemaQualification(node: PostgresAstObject, schemaName: string) {
  if (node.schemaname !== schemaName) {
    return node
  }
  const { schemaname: _schemaname, ...unqualified } = node
  return unqualified
}

function normalizeRoutineTypeName(node: PostgresAstObject) {
  const names = astStringList(node.names)
  if (names.length !== 1 || names[0] !== 'timestamptz') {
    return node
  }
  return {
    ...node,
    names: [{ String: { sval: 'pg_catalog' } }, { String: { sval: 'timestamptz' } }],
  }
}

function normalizeRoutineParameterReference(
  node: PostgresAstObject,
  routine: { readonly parameterNames: ReadonlySet<string>; readonly routineName: string },
) {
  const fields = astStringList(node.fields)
  if (
    fields.length !== 2 ||
    fields[0] !== routine.routineName ||
    !routine.parameterNames.has(fields[1]!)
  ) {
    return node
  }
  return { ...node, fields: [{ String: { sval: fields[1]! } }] }
}

function removeImplicitSelectTargetName(node: PostgresAstObject) {
  const name = node.name
  if (
    typeof name !== 'string' ||
    (name !== '?column?' && name !== inferredSelectTargetName(node.val))
  ) {
    return node
  }
  const { name: _, ...withoutName } = node
  return withoutName
}

function inferredSelectTargetName(value: PostgresAstValue | undefined): string | undefined {
  if (!isAstObject(value)) {
    return undefined
  }
  if (isAstObject(value.CoalesceExpr)) {
    return 'coalesce'
  }
  if (isAstObject(value.FuncCall)) {
    return astStringList(value.FuncCall.funcname).at(-1)
  }
  if (isAstObject(value.ColumnRef)) {
    return astStringList(value.ColumnRef.fields).at(-1)
  }
  if (isAstObject(value.TypeCast)) {
    const argumentName = inferredSelectTargetName(value.TypeCast.arg)
    if (argumentName) {
      return argumentName
    }
    const typeName = value.TypeCast.typeName
    if (isAstObject(typeName)) {
      return astStringList(typeName.names).at(-1)
    }
  }
  return undefined
}

function normalizeAst(value: PostgresAstValue): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeAst)
  }
  if (!isAstObject(value)) {
    return value
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key, entry]) =>
          entry !== undefined && !['location', 'stmt_len', 'stmt_location'].includes(key),
      )
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, normalizeAst(entry!)]),
  )
}

function isAstObject(value: PostgresAstValue | undefined): value is PostgresAstObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
