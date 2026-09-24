import type postgres from 'postgres'
import { createModulePersistenceContractFingerprint } from './module-persistence-contract.js'
import {
  modulePersistenceNames,
  modulePersistenceRoutineName,
} from './module-persistence-identity.js'
import { canonicalizePersistenceRoutineSql } from './module-persistence-routine.js'
import type { ModulePersistenceRoutineDescriptor } from './module-persistence-routine-provisioner.js'

type AttestationFailure =
  | 'authority'
  | 'contract'
  | 'definition'
  | 'grants'
  | 'inventory'
  | 'metadata'
  | 'signature'

interface ContractRow {
  readonly contract_fingerprint: string
  readonly operation_count: number
}

interface OperationAttestationRow {
  readonly definition_fingerprint: string
  readonly migration_name: string
  readonly mode: string
  readonly module_id: string
  readonly operation_id: string
  readonly revision: number
  readonly routine_name: string
  readonly schema_name: string
}

interface RoutineRow {
  readonly definition: string
  readonly oid: string
  readonly owner: string
  readonly parallel: string
  readonly routine_name: string
  readonly schema_name: string
  readonly security_definer: boolean
  readonly settings: string[] | null
  readonly signature_valid: boolean
  readonly volatility: string
}

interface RoutineGrantRow {
  readonly grantable: boolean
  readonly grantee: string
  readonly oid: string
  readonly privilege: string
}

interface RoleRow {
  readonly platform_role: string
  readonly rolbypassrls: boolean
  readonly rolcanlogin: boolean
  readonly rolcreatedb: boolean
  readonly rolcreaterole: boolean
  readonly rolinherit: boolean
  readonly rolname: string
  readonly rolreplication: boolean
  readonly rolsuper: boolean
}

interface MembershipRow {
  readonly admin_option: boolean
  readonly inherit_option: boolean
  readonly member: string
  readonly parent: string
  readonly set_option: boolean
}

interface SchemaAccessRow {
  readonly create_access: boolean
  readonly role_name: string
  readonly schema_name: string
  readonly usage_access: boolean
}

interface RelationAccessRow {
  readonly role_name: string
  readonly schema_name: string
}

export class ModulePersistenceAttestationError extends Error {
  constructor(
    readonly moduleId: string,
    readonly operationId: string,
    readonly failure: AttestationFailure,
  ) {
    super(`Module persistence attestation ${moduleId}/${operationId} rejected: ${failure}`)
    this.name = 'ModulePersistenceAttestationError'
  }
}

export async function assertInstalledModulePersistenceContract(
  connection: postgres.Sql,
  contractFingerprint: string,
  operations: readonly ModulePersistenceRoutineDescriptor[],
  moduleIds: readonly string[] = operationModuleIds(operations),
) {
  const contract = await loadContract(connection)
  if (
    contract.length !== 1 ||
    contract[0]!.contract_fingerprint !== contractFingerprint ||
    contract[0]!.operation_count !== operations.length
  ) {
    throw attestationError('platform', 'catalog', 'contract')
  }
  await assertInstalledModulePersistenceState(connection, operations, moduleIds)
}

export async function assertInstalledModulePersistenceContractWhenCurrent(
  connection: postgres.Sql,
  contractFingerprint: string,
  operations: readonly ModulePersistenceRoutineDescriptor[],
  moduleIds: readonly string[] = operationModuleIds(operations),
) {
  const contract = await loadContract(connection)
  if (
    contract.length !== 1 ||
    contract[0]!.contract_fingerprint !== contractFingerprint ||
    contract[0]!.operation_count !== operations.length
  ) {
    return false
  }
  await assertInstalledModulePersistenceState(connection, operations, moduleIds)
  return true
}

export async function reconcileInstalledModulePersistenceContract(
  connection: postgres.Sql,
  contractFingerprint: string,
  operations: readonly ModulePersistenceRoutineDescriptor[],
  moduleIds: readonly string[] = operationModuleIds(operations),
) {
  await assertInstalledModulePersistenceState(connection, operations, moduleIds)
  await connection`
    insert into public.module_persistence_contract (
      singleton,
      contract_fingerprint,
      operation_count,
      reconciled_at
    ) values (true, ${contractFingerprint}, ${operations.length}, now())
    on conflict (singleton) do update
    set contract_fingerprint = excluded.contract_fingerprint,
        operation_count = excluded.operation_count,
        reconciled_at = excluded.reconciled_at
  `
}

export function persistenceContractFingerprintFor(
  operations: readonly ModulePersistenceRoutineDescriptor[],
  moduleIds: readonly string[] = operationModuleIds(operations),
) {
  return createModulePersistenceContractFingerprint(operations, moduleIds)
}

async function assertInstalledModulePersistenceState(
  connection: postgres.Sql,
  operations: readonly ModulePersistenceRoutineDescriptor[],
  moduleIds: readonly string[],
) {
  assertExpectedInventory(operations, moduleIds)
  const schemaNames = moduleIds.map((moduleId) => modulePersistenceNames(moduleId).schemaName)
  const [attestations, routines, grants] = await Promise.all([
    loadOperationAttestations(connection, moduleIds),
    loadPersistenceRoutines(connection, schemaNames),
    loadPersistenceRoutineGrants(connection, schemaNames),
  ])
  assertOperationAttestations(operations, attestations)
  await assertRoutines(operations, routines, grants)
  await assertRoleAuthority(connection, moduleIds)
}

function assertExpectedInventory(
  operations: readonly ModulePersistenceRoutineDescriptor[],
  moduleIds: readonly string[],
) {
  const identities = new Set<string>()
  const expectedModuleIds = new Set(moduleIds)
  if (expectedModuleIds.size !== moduleIds.length) {
    throw attestationError('platform', 'catalog', 'inventory')
  }
  for (const operation of operations) {
    const names = modulePersistenceNames(operation.moduleId)
    const identity = operationIdentity(operation)
    if (
      identities.has(identity) ||
      !expectedModuleIds.has(operation.moduleId) ||
      operation.schemaName !== names.schemaName ||
      operation.routineName !== modulePersistenceRoutineName(operation.operationId)
    ) {
      throw attestationError(operation.moduleId, operation.operationId, 'inventory')
    }
    identities.add(identity)
  }
}

function assertOperationAttestations(
  operations: readonly ModulePersistenceRoutineDescriptor[],
  rows: readonly OperationAttestationRow[],
) {
  const expected = new Map(operations.map((operation) => [operationIdentity(operation), operation]))
  if (rows.length !== expected.size) {
    throw attestationError('platform', 'catalog', 'inventory')
  }
  for (const row of rows) {
    const operation = expected.get(`${row.module_id}/${row.operation_id}`)
    if (!operation) {
      throw attestationError(row.module_id, row.operation_id, 'inventory')
    }
    if (
      row.revision !== operation.revision ||
      row.mode !== operation.mode ||
      row.migration_name !== operation.migration ||
      row.schema_name !== operation.schemaName ||
      row.routine_name !== operation.routineName ||
      row.definition_fingerprint !== operation.definitionFingerprint
    ) {
      throw attestationError(operation.moduleId, operation.operationId, 'metadata')
    }
  }
}

async function assertRoutines(
  operations: readonly ModulePersistenceRoutineDescriptor[],
  rows: readonly RoutineRow[],
  grants: readonly RoutineGrantRow[],
) {
  const expected = new Map(
    operations.map((operation) => [
      routineIdentity(operation.schemaName, operation.routineName),
      operation,
    ]),
  )
  if (rows.length !== expected.size) {
    throw attestationError('platform', 'catalog', 'inventory')
  }
  await Promise.all(
    rows.map(async (routine) => {
      const operation = expected.get(routineIdentity(routine.schema_name, routine.routine_name))
      if (!operation) {
        throw attestationError('platform', 'catalog', 'inventory')
      }
      assertRoutineMetadata(operation, routine)
      await assertRoutineDefinition(operation, routine.definition)
      assertRoutineGrants(operation, routine.oid, grants)
    }),
  )
}

function assertRoutineMetadata(operation: ModulePersistenceRoutineDescriptor, routine: RoutineRow) {
  const names = modulePersistenceNames(operation.moduleId)
  const expectedSettings = `search_path=pg_catalog, ${names.schemaName}, pg_temp`
  if (!routine.signature_valid) {
    throw attestationError(operation.moduleId, operation.operationId, 'signature')
  }
  if (
    routine.owner !== names.migrationRoleName ||
    !routine.security_definer ||
    routine.volatility !== (operation.mode === 'read' ? 's' : 'v') ||
    routine.parallel !== 'u' ||
    routine.settings?.length !== 1 ||
    routine.settings[0] !== expectedSettings
  ) {
    throw attestationError(operation.moduleId, operation.operationId, 'metadata')
  }
}

async function assertRoutineDefinition(
  operation: ModulePersistenceRoutineDescriptor,
  definition: string,
) {
  try {
    const canonical = await canonicalizePersistenceRoutineSql({
      mode: operation.mode,
      moduleId: operation.moduleId,
      operationId: operation.operationId,
      revision: operation.revision,
      sql: definition,
    })
    if (canonical.definitionFingerprint !== operation.definitionFingerprint) {
      throw attestationError(operation.moduleId, operation.operationId, 'definition')
    }
  } catch (error) {
    if (error instanceof ModulePersistenceAttestationError) {
      throw error
    }
    throw attestationError(operation.moduleId, operation.operationId, 'definition')
  }
}

function assertRoutineGrants(
  operation: ModulePersistenceRoutineDescriptor,
  routineOid: string,
  rows: readonly RoutineGrantRow[],
) {
  const names = modulePersistenceNames(operation.moduleId)
  const routineGrants = rows.filter(({ oid }) => oid === routineOid)
  const migrationGrant = routineGrants.filter(
    ({ grantee, privilege }) => grantee === names.migrationRoleName && privilege === 'EXECUTE',
  )
  const runtimeGrant = routineGrants.filter(
    ({ grantee, privilege }) => grantee === names.runtimeRoleName && privilege === 'EXECUTE',
  )
  if (
    routineGrants.length !== 2 ||
    migrationGrant.length !== 1 ||
    runtimeGrant.length !== 1 ||
    runtimeGrant[0]!.grantable
  ) {
    throw attestationError(operation.moduleId, operation.operationId, 'grants')
  }
}

async function assertRoleAuthority(connection: postgres.Sql, moduleIds: readonly string[]) {
  if (moduleIds.length === 0) {
    return
  }
  const expectedRoles = moduleIds.flatMap((moduleId) => {
    const { migrationRoleName, runtimeRoleName } = modulePersistenceNames(moduleId)
    return [migrationRoleName, runtimeRoleName]
  })
  const [roles, memberships, schemaAccess, relationAccess] = await Promise.all([
    loadRoles(connection, expectedRoles),
    loadRoleMemberships(connection, expectedRoles),
    loadSchemaAccess(connection, expectedRoles),
    loadRelationAccess(connection, expectedRoles),
  ])
  if (roles.length !== expectedRoles.length) {
    throw attestationError('platform', 'catalog', 'authority')
  }
  const platformRole = roles[0]!.platform_role
  for (const moduleId of moduleIds) {
    const names = modulePersistenceNames(moduleId)
    for (const roleName of [names.migrationRoleName, names.runtimeRoleName]) {
      const role = roles.find(({ rolname }) => rolname === roleName)
      if (!role || !isRestrictedRole(role)) {
        throw attestationError(moduleId, 'catalog', 'authority')
      }
      const roleMemberships = memberships.filter(
        ({ member, parent }) => member === roleName || parent === roleName,
      )
      if (
        roleMemberships.length !== 1 ||
        roleMemberships[0]!.member !== platformRole ||
        roleMemberships[0]!.parent !== roleName ||
        roleMemberships[0]!.admin_option ||
        roleMemberships[0]!.inherit_option ||
        !roleMemberships[0]!.set_option
      ) {
        throw attestationError(moduleId, 'catalog', 'authority')
      }
    }
    assertSchemaAuthority(moduleId, names, schemaAccess)
    if (
      relationAccess.some(
        ({ role_name, schema_name }) =>
          role_name === names.runtimeRoleName ||
          (role_name === names.migrationRoleName && schema_name !== names.schemaName),
      )
    ) {
      throw attestationError(moduleId, 'catalog', 'authority')
    }
  }
}

function operationModuleIds(operations: readonly ModulePersistenceRoutineDescriptor[]) {
  return [...new Set(operations.map(({ moduleId }) => moduleId))]
}

function assertSchemaAuthority(
  moduleId: string,
  names: ReturnType<typeof modulePersistenceNames>,
  rows: readonly SchemaAccessRow[],
) {
  const runtimeRows = rows.filter(({ role_name }) => role_name === names.runtimeRoleName)
  const migrationRows = rows.filter(({ role_name }) => role_name === names.migrationRoleName)
  const runtimeOwn = runtimeRows.find(({ schema_name }) => schema_name === names.schemaName)
  const migrationOwn = migrationRows.find(({ schema_name }) => schema_name === names.schemaName)
  if (
    !runtimeOwn?.usage_access ||
    runtimeOwn.create_access ||
    !migrationOwn?.usage_access ||
    !migrationOwn.create_access ||
    runtimeRows.some(
      ({ schema_name, usage_access, create_access }) =>
        schema_name !== names.schemaName && (usage_access || create_access),
    ) ||
    migrationRows.some(
      ({ schema_name, usage_access, create_access }) =>
        schema_name !== names.schemaName && (usage_access || create_access),
    )
  ) {
    throw attestationError(moduleId, 'catalog', 'authority')
  }
}

function isRestrictedRole(role: RoleRow) {
  return (
    !role.rolcanlogin &&
    !role.rolcreatedb &&
    !role.rolcreaterole &&
    !role.rolinherit &&
    !role.rolreplication &&
    !role.rolsuper &&
    !role.rolbypassrls
  )
}

function loadContract(connection: postgres.Sql) {
  return connection<ContractRow[]>`
    select contract_fingerprint, operation_count
    from public.module_persistence_contract
  `
}

function loadOperationAttestations(connection: postgres.Sql, moduleIds: readonly string[]) {
  return connection<OperationAttestationRow[]>`
    select
      module_id,
      operation_id,
      revision,
      mode,
      migration_name,
      schema_name,
      routine_name,
      definition_fingerprint
    from public.module_persistence_operation_attestations
    where module_id = any(${moduleIds})
  `
}

function loadPersistenceRoutines(connection: postgres.Sql, schemaNames: readonly string[]) {
  return connection<RoutineRow[]>`
    select
      routine.oid::text as oid,
      namespace.nspname as schema_name,
      routine.proname as routine_name,
      pg_get_userbyid(routine.proowner) as owner,
      routine.prosecdef as security_definer,
      routine.provolatile as volatility,
      routine.proparallel as parallel,
      routine.proconfig as settings,
      pg_get_functiondef(routine.oid) as definition,
      (
        routine.prokind = 'f'
        and routine.pronargs = 1
        and routine.pronargdefaults = 0
        and routine.provariadic = 0
        and routine.proargmodes is null
        and routine.proallargtypes is null
        and routine.proargtypes::text = ('jsonb'::regtype::oid)::text
        and routine.prorettype = 'jsonb'::regtype
        and not routine.proretset
      ) as signature_valid
    from pg_proc routine
    join pg_namespace namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = any(${schemaNames})
      and routine.proname like 'persist\_%' escape '\'
  `
}

function loadPersistenceRoutineGrants(connection: postgres.Sql, schemaNames: readonly string[]) {
  return connection<RoutineGrantRow[]>`
    select
      routine.oid::text as oid,
      coalesce(grantee.rolname, 'PUBLIC') as grantee,
      privilege.privilege_type as privilege,
      privilege.is_grantable as grantable
    from pg_proc routine
    join pg_namespace namespace on namespace.oid = routine.pronamespace
    cross join lateral aclexplode(
      coalesce(routine.proacl, acldefault('f', routine.proowner))
    ) privilege
    left join pg_roles grantee on grantee.oid = privilege.grantee
    where namespace.nspname = any(${schemaNames})
      and routine.proname like 'persist\_%' escape '\'
  `
}

function loadRoles(connection: postgres.Sql, roleNames: readonly string[]) {
  return connection<RoleRow[]>`
    select
      current_user as platform_role,
      rolname,
      rolcanlogin,
      rolcreatedb,
      rolcreaterole,
      rolinherit,
      rolreplication,
      rolsuper,
      rolbypassrls
    from pg_roles
    where rolname = any(${roleNames})
  `
}

function loadRoleMemberships(connection: postgres.Sql, roleNames: readonly string[]) {
  return connection<MembershipRow[]>`
    select
      member.rolname as member,
      parent.rolname as parent,
      membership.admin_option,
      membership.inherit_option,
      membership.set_option
    from pg_auth_members membership
    join pg_roles member on member.oid = membership.member
    join pg_roles parent on parent.oid = membership.roleid
    where member.rolname = any(${roleNames})
       or parent.rolname = any(${roleNames})
  `
}

function loadSchemaAccess(connection: postgres.Sql, roleNames: readonly string[]) {
  return connection<SchemaAccessRow[]>`
    select
      role.rolname as role_name,
      namespace.nspname as schema_name,
      has_schema_privilege(role.rolname, namespace.oid, 'USAGE') as usage_access,
      has_schema_privilege(role.rolname, namespace.oid, 'CREATE') as create_access
    from pg_roles role
    cross join pg_namespace namespace
    where role.rolname = any(${roleNames})
      and (namespace.nspname = 'public' or namespace.nspname like 'eve_module\_%' escape '\')
  `
}

function loadRelationAccess(connection: postgres.Sql, roleNames: readonly string[]) {
  return connection<RelationAccessRow[]>`
    select distinct
      role.rolname as role_name,
      namespace.nspname as schema_name
    from pg_roles role
    cross join pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where role.rolname = any(${roleNames})
      and (namespace.nspname = 'public' or namespace.nspname like 'eve_module\_%' escape '\')
      and (
        (
          relation.relkind in ('r', 'p', 'v', 'm', 'f')
          and has_table_privilege(
            role.rolname,
            relation.oid,
            'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
          )
        )
        or (
          relation.relkind = 'S'
          and has_sequence_privilege(role.rolname, relation.oid, 'USAGE, SELECT, UPDATE')
        )
      )
  `
}

function operationIdentity(operation: ModulePersistenceRoutineDescriptor) {
  return `${operation.moduleId}/${operation.operationId}`
}

function routineIdentity(schemaName: string, routineName: string) {
  return `${schemaName}.${routineName}`
}

function attestationError(moduleId: string, operationId: string, failure: AttestationFailure) {
  return new ModulePersistenceAttestationError(moduleId, operationId, failure)
}
