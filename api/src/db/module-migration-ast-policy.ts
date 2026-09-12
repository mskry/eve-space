import type {
  PostgresAstObject,
  PostgresAstValue,
  PostgresMigrationAst,
} from './postgres17-parser.js'

const allowedRootStatements = new Set([
  'AlterDomainStmt',
  'AlterEnumStmt',
  'AlterPolicyStmt',
  'AlterSeqStmt',
  'AlterTableStmt',
  'AlterTypeStmt',
  'CommentStmt',
  'CompositeTypeStmt',
  'CreateDomainStmt',
  'CreateEnumStmt',
  'CreatePolicyStmt',
  'CreateRangeStmt',
  'CreateSeqStmt',
  'CreateStmt',
  'CreateTableAsStmt',
  'CreateTrigStmt',
  'DefineStmt',
  'DeleteStmt',
  'DropStmt',
  'IndexStmt',
  'InsertStmt',
  'RenameStmt',
  'SelectStmt',
  'TruncateStmt',
  'UpdateStmt',
  'ViewStmt',
])
const allowedNestedStatements = new Set(['DeleteStmt', 'InsertStmt', 'SelectStmt', 'UpdateStmt'])
const allowedAstNodeKinds = new Set([
  ...allowedNestedStatements,
  'A_ArrayExpr',
  'A_Const',
  'A_Expr',
  'A_Indices',
  'A_Indirection',
  'A_Star',
  'Alias',
  'AlterTableCmd',
  'BitString',
  'Boolean',
  'BooleanTest',
  'BoolExpr',
  'CaseExpr',
  'CaseWhen',
  'CollateClause',
  'ColumnDef',
  'ColumnRef',
  'CommonTableExpr',
  'CoalesceExpr',
  'Constraint',
  'CTECycleClause',
  'CTESearchClause',
  'DefElem',
  'Float',
  'FuncCall',
  'GroupingFunc',
  'GroupingSet',
  'InferClause',
  'IndexElem',
  'Integer',
  'IntoClause',
  'JsonAggConstructor',
  'JsonArgument',
  'JsonArrayAgg',
  'JsonArrayConstructor',
  'JsonArrayQueryConstructor',
  'JsonBehavior',
  'JsonExpr',
  'JsonFormat',
  'JsonFuncExpr',
  'JsonIsPredicate',
  'JsonKeyValue',
  'JsonObjectAgg',
  'JsonObjectConstructor',
  'JsonOutput',
  'JsonParseExpr',
  'JsonReturning',
  'JsonScalarExpr',
  'JsonSerializeExpr',
  'JsonTable',
  'JsonTableColumn',
  'JsonTablePathSpec',
  'JsonValueExpr',
  'JoinExpr',
  'List',
  'LockingClause',
  'MinMaxExpr',
  'MultiAssignRef',
  'NamedArgExpr',
  'NullTest',
  'NullIfExpr',
  'OnConflictClause',
  'ParamRef',
  'PartitionBoundSpec',
  'PartitionCmd',
  'PartitionElem',
  'PartitionRangeDatum',
  'PartitionSpec',
  'RangeFunction',
  'RangeSubselect',
  'RangeTableFunc',
  'RangeTableFuncCol',
  'RangeTableSample',
  'RangeVar',
  'ReplicaIdentityStmt',
  'ResTarget',
  'RoleSpec',
  'RowExpr',
  'SetToDefault',
  'SinglePartitionSpec',
  'SortBy',
  'SQLValueFunction',
  'String',
  'SubLink',
  'TableFunc',
  'TableLikeClause',
  'TriggerTransition',
  'TypeCast',
  'TypeName',
  'WindowDef',
  'WithClause',
  'XmlExpr',
  'XmlSerialize',
])
const prohibitedStatements = new Set([
  'AlterDatabaseRefreshCollStmt',
  'AlterDatabaseSetStmt',
  'AlterDatabaseStmt',
  'AlterDefaultPrivilegesStmt',
  'AlterEventTrigStmt',
  'AlterExtensionContentsStmt',
  'AlterExtensionStmt',
  'AlterFdwStmt',
  'AlterForeignServerStmt',
  'AlterObjectSchemaStmt',
  'AlterOwnerStmt',
  'AlterPublicationStmt',
  'AlterRoleSetStmt',
  'AlterRoleStmt',
  'AlterSubscriptionStmt',
  'AlterSystemStmt',
  'AlterTableMoveAllStmt',
  'AlterTableSpaceOptionsStmt',
  'CallStmt',
  'CheckPointStmt',
  'ClusterStmt',
  'CopyStmt',
  'CreateAmStmt',
  'CreateEventTrigStmt',
  'CreateExtensionStmt',
  'CreateFdwStmt',
  'CreateForeignServerStmt',
  'CreateForeignTableStmt',
  'CreateFunctionStmt',
  'CreatePLangStmt',
  'CreatePublicationStmt',
  'CreateRoleStmt',
  'CreateSchemaStmt',
  'CreateSubscriptionStmt',
  'CreateTableSpaceStmt',
  'CreateUserMappingStmt',
  'CreatedbStmt',
  'DiscardStmt',
  'DoStmt',
  'DropOwnedStmt',
  'DropRoleStmt',
  'DropSubscriptionStmt',
  'DropTableSpaceStmt',
  'DropUserMappingStmt',
  'DropdbStmt',
  'GrantRoleStmt',
  'GrantStmt',
  'ImportForeignSchemaStmt',
  'LoadStmt',
  'LockStmt',
  'PrepareStmt',
  'ReassignOwnedStmt',
  'TransactionStmt',
  'VariableSetStmt',
  'VacuumStmt',
])
const allowedAlterObjectTypes = new Set([
  'OBJECT_DOMAIN',
  'OBJECT_INDEX',
  'OBJECT_MATVIEW',
  'OBJECT_SEQUENCE',
  'OBJECT_TABLE',
  'OBJECT_TYPE',
  'OBJECT_VIEW',
])
const allowedDropObjectTypes = new Set([
  ...allowedAlterObjectTypes,
  'OBJECT_POLICY',
  'OBJECT_TRIGGER',
])
const allowedRenameObjectTypes = new Set([
  ...allowedDropObjectTypes,
  'OBJECT_ATTRIBUTE',
  'OBJECT_COLUMN',
  'OBJECT_DOMCONSTRAINT',
  'OBJECT_TABCONSTRAINT',
])
const rangeVarFields = new Set(['rel', 'relation', 'sequence', 'table', 'typevar', 'view'])
const allowedCommentObjectTypes = new Set([
  ...allowedDropObjectTypes,
  'OBJECT_COLUMN',
  'OBJECT_CONSTRAINT',
  'OBJECT_DOMCONSTRAINT',
  'OBJECT_TABCONSTRAINT',
])
const relationMemberObjectTypes = new Set([
  'OBJECT_COLUMN',
  'OBJECT_CONSTRAINT',
  'OBJECT_POLICY',
  'OBJECT_RULE',
  'OBJECT_TABCONSTRAINT',
  'OBJECT_TRIGGER',
])
const prohibitedAlterTableCommands = new Set(['AT_ChangeOwner', 'AT_SetSchema', 'AT_SetTableSpace'])
const prohibitedFunctions = new Set([
  'dblink',
  'dblink_exec',
  'loread',
  'lowrite',
  'pg_backup_start',
  'pg_backup_stop',
  'pg_cancel_backend',
  'pg_create_restore_point',
  'pg_log_backend_memory_contexts',
  'pg_ls_archive_statusdir',
  'pg_ls_dir',
  'pg_ls_logdir',
  'pg_ls_waldir',
  'pg_promote',
  'pg_read_binary_file',
  'pg_read_file',
  'pg_reload_conf',
  'pg_rotate_logfile',
  'pg_sleep',
  'pg_sleep_for',
  'pg_sleep_until',
  'pg_stat_file',
  'pg_switch_wal',
  'pg_terminate_backend',
  'pg_write_file',
  'set_config',
])

export type ModuleMigrationPolicyCategory =
  | 'cross-schema'
  | 'prohibited-operation'
  | 'unsupported-statement'

export function assertModuleMigrationAstPolicy(schemaName: string, ast: PostgresMigrationAst) {
  for (const statement of ast.statements) {
    assertRootStatement(statement.kind, statement.node)
    validateStatementNames(statement.kind, statement.node, schemaName)
    visitValue(statement.node, schemaName, collectLocalQualifiers(statement.node))
  }
}

export class ModuleMigrationPolicyError extends Error {
  constructor(readonly category: ModuleMigrationPolicyCategory) {
    super(`Module migration policy rejected SQL: ${category}`)
    this.name = 'ModuleMigrationPolicyError'
  }
}

function assertRootStatement(kind: string, node: PostgresAstObject) {
  if (prohibitedStatements.has(kind)) throw policyError('prohibited-operation')
  if (!allowedRootStatements.has(kind)) throw policyError('unsupported-statement')

  assertRootStatementOptions(kind, node)
}

function assertRootStatementOptions(kind: string, node: PostgresAstObject) {
  if (
    kind === 'CreateTableAsStmt' &&
    node.objtype !== 'OBJECT_MATVIEW' &&
    node.objtype !== 'OBJECT_TABLE'
  )
    throw policyError('unsupported-statement')
  if (kind === 'DefineStmt' && node.kind !== 'OBJECT_TYPE')
    throw policyError('unsupported-statement')
  if (kind === 'AlterTableStmt' && !allowedAlterObjectTypes.has(stringValue(node.objtype)))
    throw policyError('unsupported-statement')
  if (kind === 'RenameStmt' && !allowedRenameObjectTypes.has(stringValue(node.renameType)))
    throw policyError('unsupported-statement')
  if (kind === 'DropStmt' && !allowedDropObjectTypes.has(stringValue(node.removeType)))
    throw policyError('unsupported-statement')
  if (kind === 'CommentStmt' && !allowedCommentObjectTypes.has(stringValue(node.objtype)))
    throw policyError('unsupported-statement')
  if ((kind === 'IndexStmt' || kind === 'DropStmt') && node.concurrent === true)
    throw policyError('prohibited-operation')
}

function validateStatementNames(kind: string, node: PostgresAstObject, schemaName: string) {
  if (kind === 'CreateTrigStmt') validateQualifiedName(node.funcname, schemaName)
  if (kind === 'DefineStmt') validateQualifiedName(node.defnames, schemaName)
  if (kind === 'CreateEnumStmt' || kind === 'CreateRangeStmt')
    validateQualifiedName(node.typeName, schemaName)
  if (kind === 'CreateDomainStmt') validateQualifiedName(node.domainname, schemaName)
  if (kind === 'AlterDomainStmt' || kind === 'AlterEnumStmt' || kind === 'AlterTypeStmt')
    validateQualifiedName(node.typeName, schemaName)
  if (kind === 'DropStmt')
    validateObjectList(node.objects, schemaName, stringValue(node.removeType))
  if (kind === 'CommentStmt') validateObjectName(node.object, schemaName, stringValue(node.objtype))
  if (kind === 'RenameStmt')
    validateObjectName(node.object, schemaName, stringValue(node.renameType))
}

function visitValue(
  value: PostgresAstValue | undefined,
  schemaName: string,
  localQualifiers: ReadonlySet<string>,
  allowExcluded = false,
) {
  if (Array.isArray(value)) {
    for (const item of value) visitValue(item, schemaName, localQualifiers, allowExcluded)
    return
  }
  if (!isAstObject(value)) return

  if (isRangeVarPayload(value)) validateRangeVar(value, schemaName)
  if (isTypeNamePayload(value)) validateQualifiedName(value.names, schemaName, true)

  for (const [kind, node] of Object.entries(value)) {
    validateAstNode(kind, node, schemaName, localQualifiers, allowExcluded)

    visitValue(
      node,
      schemaName,
      localQualifiers,
      allowExcluded || kind === 'OnConflictClause' || kind === 'onConflictClause',
    )
  }

  for (const [field, child] of Object.entries(value)) {
    if (/tablespace/i.test(field) && child) throw policyError('prohibited-operation')
  }
}

type AstNodeValidator = (
  node: PostgresAstObject,
  schemaName: string,
  localQualifiers: ReadonlySet<string>,
  allowExcluded: boolean,
) => void

function validateAstNode(
  kind: string,
  node: PostgresAstValue | undefined,
  schemaName: string,
  localQualifiers: ReadonlySet<string>,
  allowExcluded: boolean,
) {
  if (node === undefined) return
  assertSupportedAstNodeKind(kind, node)
  validateRangeVarField(kind, node, schemaName)
  validateAstNodePayload(kind, node, schemaName, localQualifiers, allowExcluded)
}

function assertSupportedAstNodeKind(kind: string, node: PostgresAstValue) {
  if (/^[A-Z]/.test(kind) && !allowedAstNodeKinds.has(kind)) {
    if (isNestedStatementPayload(kind, node)) assertNestedStatement(kind, node)
    throw policyError('unsupported-statement')
  }
  if (isNestedStatementPayload(kind, node) && kind !== 'ReplicaIdentityStmt')
    assertNestedStatement(kind, node)
}

function isNestedStatementPayload(kind: string, node: PostgresAstValue): node is PostgresAstObject {
  return /^[A-Z].*Stmt$/.test(kind) && isAstObject(node)
}

function validateRangeVarField(kind: string, node: PostgresAstValue, schemaName: string) {
  if (!rangeVarFields.has(kind)) return
  if (!isAstObject(node)) throw policyError('unsupported-statement')
  validateRangeVar(node, schemaName)
}

function validateAstNodePayload(
  kind: string,
  node: PostgresAstValue,
  schemaName: string,
  localQualifiers: ReadonlySet<string>,
  allowExcluded: boolean,
) {
  const validator = getAstNodeValidator(kind)
  if (validator) validateAstObject(node, schemaName, localQualifiers, allowExcluded, validator)
}

function getAstNodeValidator(kind: string): AstNodeValidator | undefined {
  switch (kind) {
    case 'RangeVar':
      return validateRangeVar
    case 'TypeName':
      return validateTypeName
    case 'FuncCall':
      return validateFunction
    case 'A_Expr':
      return validateExpressionOperator
    case 'SortBy':
      return validateSortOperator
    case 'RangeTableSample':
      return validateTableSampleMethod
    case 'IndexElem':
    case 'PartitionElem':
      return validateIndexOrPartitionElement
    case 'Constraint':
      return validateConstraint
    case 'ColumnRef':
      return validateColumnReference
    case 'ObjectWithArgs':
      return validateObjectWithArguments
    case 'CollateClause':
      return validateCollation
    case 'AlterTableCmd':
      return validateAlterTableCommand
    case 'DefElem':
      return validateDefinitionElement
    default:
      return undefined
  }
}

function validateAstObject(
  value: PostgresAstValue,
  schemaName: string,
  localQualifiers: ReadonlySet<string>,
  allowExcluded: boolean,
  validator: AstNodeValidator,
) {
  if (isAstObject(value)) validator(value, schemaName, localQualifiers, allowExcluded)
}

function validateTypeName(node: PostgresAstObject, schemaName: string) {
  validateQualifiedName(node.names, schemaName, true)
}

function validateExpressionOperator(node: PostgresAstObject, schemaName: string) {
  validateQualifiedNameIfPresent(node.name, schemaName)
}

function validateSortOperator(node: PostgresAstObject, schemaName: string) {
  validateQualifiedNameIfPresent(node.useOp, schemaName)
}

function validateTableSampleMethod(node: PostgresAstObject, schemaName: string) {
  validateQualifiedName(node.method, schemaName)
}

function validateIndexOrPartitionElement(node: PostgresAstObject, schemaName: string) {
  validateQualifiedNameIfPresent(node.opclass, schemaName)
  validateQualifiedNameIfPresent(node.collation, schemaName)
}

function validateConstraint(node: PostgresAstObject, schemaName: string) {
  if (node.contype === 'CONSTR_EXCLUSION') validateExclusionOperators(node.exclusions, schemaName)
}

function validateObjectWithArguments(node: PostgresAstObject, schemaName: string) {
  validateQualifiedName(node.objname, schemaName)
}

function validateCollation(node: PostgresAstObject, schemaName: string) {
  validateQualifiedName(node.collname, schemaName)
}

function validateDefinitionElement(node: PostgresAstObject, schemaName: string) {
  if (node.defname === 'tablespace') throw policyError('prohibited-operation')
  if (node.defname === 'owned_by') validateObjectName(node.arg, schemaName, 'OBJECT_COLUMN')
}

function collectLocalQualifiers(value: PostgresAstValue) {
  const qualifiers = new Set<string>()
  collect(value, qualifiers)
  return qualifiers
}

function collect(value: PostgresAstValue | undefined, qualifiers: Set<string>) {
  if (Array.isArray(value)) {
    for (const item of value) collect(item, qualifiers)
    return
  }
  if (!isAstObject(value)) return

  const alias = aliasName(value.alias)
  if (alias) qualifiers.add(normalizeIdentifier(alias))
  if (typeof value.relname === 'string' && !alias)
    qualifiers.add(normalizeIdentifier(value.relname))
  if (typeof value.ctename === 'string') qualifiers.add(normalizeIdentifier(value.ctename))

  for (const child of Object.values(value)) collect(child, qualifiers)
}

function assertNestedStatement(kind: string, node: PostgresAstObject) {
  if (prohibitedStatements.has(kind)) throw policyError('prohibited-operation')
  if (!allowedNestedStatements.has(kind)) throw policyError('unsupported-statement')
  if (kind === 'SelectStmt' && isAstObject(node.intoClause)) {
    const relation = node.intoClause.rel
    if (!isWrappedNode(relation, 'RangeVar')) throw policyError('unsupported-statement')
  }
}

function validateRangeVar(node: PostgresAstObject, schemaName: string) {
  if (
    typeof node.relname !== 'string' ||
    (node.relpersistence !== 'p' && node.relpersistence !== 'u' && node.relpersistence !== 't') ||
    (node.catalogname !== undefined && typeof node.catalogname !== 'string') ||
    (node.schemaname !== undefined && typeof node.schemaname !== 'string')
  )
    throw policyError('unsupported-statement')
  if (node.catalogname !== undefined) throw policyError('cross-schema')
  if (typeof node.schemaname === 'string' && normalizeIdentifier(node.schemaname) !== schemaName)
    throw policyError('cross-schema')
  if (node.relpersistence === 't') throw policyError('prohibited-operation')
}

function validateFunction(node: PostgresAstObject, schemaName: string) {
  const names = stringList(node.funcname)
  if (!names) throw policyError('unsupported-statement')
  validateNameParts(names, schemaName)
  const functionName = normalizeIdentifier(names.at(-1)!)
  if (
    prohibitedFunctions.has(functionName) ||
    functionName.startsWith('lo_') ||
    functionName.startsWith('pg_advisory_') ||
    functionName.startsWith('pg_try_advisory_')
  )
    throw policyError('prohibited-operation')
}

function validateColumnReference(
  node: PostgresAstObject,
  schemaName: string,
  localQualifiers: ReadonlySet<string>,
  allowExcluded: boolean,
) {
  const names = columnReferenceParts(node.fields)
  if (!names) throw policyError('unsupported-statement')
  if (names.length <= 1) return
  if (names.length >= 3) {
    if (normalizeIdentifier(names[0]!) !== schemaName) throw policyError('cross-schema')
    return
  }

  const qualifier = names[0]!
  if (qualifier === 'excluded' && allowExcluded) return
  if (!localQualifiers.has(normalizeIdentifier(qualifier))) throw policyError('cross-schema')
}

function validateAlterTableCommand(node: PostgresAstObject) {
  if (prohibitedAlterTableCommands.has(stringValue(node.subtype)))
    throw policyError('prohibited-operation')
}

function validateExclusionOperators(value: PostgresAstValue | undefined, schemaName: string) {
  if (!Array.isArray(value)) throw policyError('unsupported-statement')
  for (const exclusion of value) {
    if (!isWrappedNode(exclusion, 'List') || !Array.isArray(exclusion.List.items))
      throw policyError('unsupported-statement')
    const operator = exclusion.List.items[1]
    if (!isWrappedNode(operator, 'List')) throw policyError('unsupported-statement')
    validateQualifiedName(operator.List.items, schemaName)
  }
}

function validateObjectList(
  value: PostgresAstValue | undefined,
  schemaName: string,
  objectType: string,
) {
  if (!Array.isArray(value)) throw policyError('unsupported-statement')
  for (const object of value) validateObjectName(object, schemaName, objectType)
}

function validateObjectName(
  value: PostgresAstValue | undefined,
  schemaName: string,
  objectType: string,
) {
  if (
    (objectType === 'OBJECT_DOMAIN' || objectType === 'OBJECT_TYPE') &&
    isWrappedNode(value, 'TypeName')
  ) {
    validateQualifiedName(value.TypeName.names, schemaName)
    return
  }
  const list = isWrappedNode(value, 'List') ? value.List.items : value
  if (
    objectType === 'OBJECT_DOMCONSTRAINT' &&
    Array.isArray(list) &&
    isWrappedNode(list[0], 'TypeName')
  ) {
    const domain = list[0]
    const constraint = list[1]
    if (
      list.length !== 2 ||
      !isWrappedNode(domain, 'TypeName') ||
      !isWrappedNode(constraint, 'String')
    )
      throw policyError('unsupported-statement')
    validateQualifiedName(domain.TypeName.names, schemaName)
    return
  }
  const names = stringList(list)
  if (!names) {
    if (value === undefined) return
    throw policyError('unsupported-statement')
  }
  const unqualifiedLength = relationMemberObjectTypes.has(objectType) ? 2 : 1
  if (names.length <= unqualifiedLength) return
  if (names.length !== unqualifiedLength + 1) throw policyError('cross-schema')
  if (normalizeIdentifier(names[0]!) !== schemaName) throw policyError('cross-schema')
}

function validateQualifiedName(
  value: PostgresAstValue | undefined,
  schemaName: string,
  allowParserCatalog = false,
) {
  const names = stringList(value)
  if (!names) throw policyError('unsupported-statement')
  validateNameParts(names, schemaName, allowParserCatalog)
}

function validateQualifiedNameIfPresent(value: PostgresAstValue | undefined, schemaName: string) {
  if (value !== undefined) validateQualifiedName(value, schemaName)
}

function validateNameParts(
  names: readonly string[],
  schemaName: string,
  allowParserCatalog = false,
) {
  if (names.length <= 1) return
  if (names.length !== 2) throw policyError('cross-schema')
  const qualifier = normalizeIdentifier(names[0]!)
  if (qualifier !== schemaName && !(allowParserCatalog && qualifier === 'pg_catalog'))
    throw policyError('cross-schema')
}

function stringList(value: PostgresAstValue | undefined) {
  if (!Array.isArray(value)) return undefined
  const strings: string[] = []
  for (const item of value) {
    if (!isWrappedNode(item, 'String') || typeof item.String.sval !== 'string') return undefined
    strings.push(item.String.sval)
  }
  return strings
}

function columnReferenceParts(value: PostgresAstValue | undefined) {
  if (!Array.isArray(value)) return undefined
  const parts: string[] = []
  for (const item of value) {
    if (isWrappedNode(item, 'String') && typeof item.String.sval === 'string') {
      parts.push(item.String.sval)
      continue
    }
    if (isWrappedNode(item, 'A_Star')) {
      parts.push('*')
      continue
    }
    return undefined
  }
  return parts
}

function aliasName(value: PostgresAstValue | undefined) {
  if (!isAstObject(value)) return undefined
  const alias = isWrappedNode(value, 'Alias') ? value.Alias : value
  return typeof alias.aliasname === 'string' ? alias.aliasname : undefined
}

function stringValue(value: PostgresAstValue | undefined) {
  return typeof value === 'string' ? value : ''
}

function normalizeIdentifier(value: string) {
  return value
}

function isRangeVarPayload(value: PostgresAstObject) {
  return typeof value.relname === 'string' && typeof value.relpersistence === 'string'
}

function isTypeNamePayload(value: PostgresAstObject) {
  return Array.isArray(value.names) && typeof value.typemod === 'number'
}

function isWrappedNode<K extends string>(
  value: PostgresAstValue | undefined,
  kind: K,
): value is PostgresAstObject & Record<K, PostgresAstObject> {
  return isAstObject(value) && isAstObject(value[kind])
}

function isAstObject(value: PostgresAstValue | undefined): value is PostgresAstObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function policyError(category: ModuleMigrationPolicyCategory) {
  return new ModuleMigrationPolicyError(category)
}
