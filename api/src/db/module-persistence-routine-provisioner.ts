import type { PlatformInstalledPersistenceOperationDescriptor } from '@eve-space/platform-module-server'
import type postgres from 'postgres'
import { canonicalizePersistenceRoutineSql } from './module-persistence-routine.js'
import { modulePersistenceNames } from './module-persistence-identity.js'

export type ModulePersistenceRoutineDescriptor = Pick<
  PlatformInstalledPersistenceOperationDescriptor,
  | 'definitionFingerprint'
  | 'migration'
  | 'mode'
  | 'moduleId'
  | 'operationId'
  | 'revision'
  | 'routineName'
  | 'schemaName'
>

type RoutineProvisioningFailure = 'definition' | 'grants' | 'metadata' | 'signature'

interface RoutineMetadata {
  readonly definition: string
  readonly oid: string
  readonly owner: string
  readonly parallel: string
  readonly securityDefiner: boolean
  readonly settings: string[] | null
  readonly signatureValid: boolean
  readonly volatility: string
}

interface RoutineGrant {
  readonly grantable: boolean
  readonly grantee: string
  readonly privilege: string
}

export async function finalizeModulePersistenceRoutines(
  connection: postgres.ReservedSql,
  moduleId: string,
  migrationName: string,
  operations: readonly ModulePersistenceRoutineDescriptor[],
) {
  for (const operation of operations) {
    if (operation.moduleId !== moduleId || operation.migration !== migrationName)
      throw routineError(moduleId, operation.operationId, 'metadata')
    // oxlint-disable-next-line no-await-in-loop
    await finalizeModulePersistenceRoutine(connection, operation)
  }
}

export async function reconcileModulePersistenceRoutineGrants(
  connection: postgres.ReservedSql,
  moduleId: string,
  operations: readonly ModulePersistenceRoutineDescriptor[],
  requireAll: boolean,
) {
  const names = modulePersistenceNames(moduleId)
  for (const operation of operations) {
    if (operation.moduleId !== moduleId || operation.schemaName !== names.schemaName)
      throw routineError(moduleId, operation.operationId, 'metadata')
    // oxlint-disable-next-line no-await-in-loop
    const exists = await routineExists(connection, operation)
    if (!exists) {
      if (requireAll) throw routineError(moduleId, operation.operationId, 'signature')
      continue
    }
    // oxlint-disable-next-line no-await-in-loop
    const routine = await loadRoutine(connection, operation)
    if (!routine.signatureValid) throw routineError(moduleId, operation.operationId, 'signature')
    // oxlint-disable-next-line no-await-in-loop
    await reconcileRoutineGrants(connection, routine.oid, routineSqlIdentity(operation), names)
  }
}

export class ModulePersistenceRoutineProvisioningError extends Error {
  constructor(
    readonly moduleId: string,
    readonly operationId: string,
    readonly failure: RoutineProvisioningFailure,
  ) {
    super(`Module persistence routine ${moduleId}/${operationId} rejected: ${failure}`)
    this.name = 'ModulePersistenceRoutineProvisioningError'
  }
}

async function finalizeModulePersistenceRoutine(
  connection: postgres.ReservedSql,
  operation: ModulePersistenceRoutineDescriptor,
) {
  const names = modulePersistenceNames(operation.moduleId)
  if (operation.schemaName !== names.schemaName)
    throw routineError(operation.moduleId, operation.operationId, 'metadata')

  const routine = await loadRoutine(connection, operation)
  if (!routine.signatureValid)
    throw routineError(operation.moduleId, operation.operationId, 'signature')

  const identity = routineSqlIdentity(operation)
  await connection
    .unsafe(`alter function ${identity} owner to ${quoteIdentifier(names.migrationRoleName)}`)
    .simple()
  await connection.unsafe(`alter function ${identity} security definer`).simple()
  await connection
    .unsafe(`alter function ${identity} ${operation.mode === 'read' ? 'stable' : 'volatile'}`)
    .simple()
  await connection.unsafe(`alter function ${identity} parallel unsafe`).simple()
  await connection
    .unsafe(
      `alter function ${identity} set search_path to pg_catalog, ${quoteIdentifier(names.schemaName)}, pg_temp`,
    )
    .simple()

  await reconcileRoutineGrants(connection, routine.oid, identity, names)
  await attestRoutine(connection, operation, names)
}

async function loadRoutine(
  connection: postgres.ReservedSql,
  operation: ModulePersistenceRoutineDescriptor,
) {
  const routines = await connection<RoutineMetadata[]>`
    select
      routine.oid::text as oid,
      pg_get_userbyid(routine.proowner) as owner,
      routine.prosecdef as "securityDefiner",
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
      ) as "signatureValid"
    from pg_proc routine
    join pg_namespace namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = ${operation.schemaName}
      and routine.proname = ${operation.routineName}
  `
  if (routines.length !== 1)
    throw routineError(operation.moduleId, operation.operationId, 'signature')
  return routines[0]!
}

async function routineExists(
  connection: postgres.ReservedSql,
  operation: ModulePersistenceRoutineDescriptor,
) {
  const identity = `${operation.schemaName}.${operation.routineName}(jsonb)`
  const [result] = await connection<{ exists: boolean }[]>`
    select to_regprocedure(${identity}) is not null as exists
  `
  return result?.exists === true
}

async function reconcileRoutineGrants(
  connection: postgres.ReservedSql,
  routineOid: string,
  identity: string,
  names: ReturnType<typeof modulePersistenceNames>,
) {
  const grants = await loadRoutineGrants(connection, routineOid)
  for (const { grantee } of grants) {
    if (grantee === names.migrationRoleName) continue
    // oxlint-disable-next-line no-await-in-loop
    await connection
      .unsafe(`revoke all privileges on function ${identity} from ${quoteRole(grantee)}`)
      .simple()
  }
  await connection
    .unsafe(`grant execute on function ${identity} to ${quoteIdentifier(names.runtimeRoleName)}`)
    .simple()
}

async function attestRoutine(
  connection: postgres.ReservedSql,
  operation: ModulePersistenceRoutineDescriptor,
  names: ReturnType<typeof modulePersistenceNames>,
) {
  const routine = await loadRoutine(connection, operation)
  const expectedVolatility = operation.mode === 'read' ? 's' : 'v'
  const expectedSettings = `search_path=pg_catalog, ${names.schemaName}, pg_temp`
  if (
    routine.owner !== names.migrationRoleName ||
    !routine.securityDefiner ||
    routine.volatility !== expectedVolatility ||
    routine.parallel !== 'u' ||
    routine.settings?.length !== 1 ||
    routine.settings[0] !== expectedSettings ||
    !routine.signatureValid
  )
    throw routineError(operation.moduleId, operation.operationId, 'metadata')

  const canonical = await canonicalizePersistenceRoutineSql({
    moduleId: operation.moduleId,
    operationId: operation.operationId,
    revision: operation.revision,
    mode: operation.mode,
    sql: routine.definition,
  })
  if (canonical.definitionFingerprint !== operation.definitionFingerprint)
    throw routineError(operation.moduleId, operation.operationId, 'definition')

  const grants = await loadRoutineGrants(connection, routine.oid)
  if (
    grants.some(
      ({ grantable, grantee, privilege }) =>
        privilege !== 'EXECUTE' ||
        (grantee !== names.migrationRoleName && grantee !== names.runtimeRoleName) ||
        (grantee === names.runtimeRoleName && grantable),
    ) ||
    !grants.some(
      ({ grantee, privilege }) => grantee === names.runtimeRoleName && privilege === 'EXECUTE',
    )
  )
    throw routineError(operation.moduleId, operation.operationId, 'grants')

  await connection`
    insert into public.module_persistence_operation_attestations (
      module_id,
      operation_id,
      revision,
      mode,
      migration_name,
      schema_name,
      routine_name,
      definition_fingerprint,
      attested_at
    ) values (
      ${operation.moduleId},
      ${operation.operationId},
      ${operation.revision},
      ${operation.mode},
      ${operation.migration},
      ${operation.schemaName},
      ${operation.routineName},
      ${operation.definitionFingerprint},
      now()
    )
    on conflict (module_id, operation_id) do update
    set revision = excluded.revision,
        mode = excluded.mode,
        migration_name = excluded.migration_name,
        schema_name = excluded.schema_name,
        routine_name = excluded.routine_name,
        definition_fingerprint = excluded.definition_fingerprint,
        attested_at = excluded.attested_at
  `
}

async function loadRoutineGrants(connection: postgres.ReservedSql, routineOid: string) {
  return connection<RoutineGrant[]>`
    select
      coalesce(grantee.rolname, 'PUBLIC') as grantee,
      privilege.privilege_type as privilege,
      privilege.is_grantable as grantable
    from pg_proc routine
    cross join lateral aclexplode(coalesce(routine.proacl, acldefault('f', routine.proowner))) privilege
    left join pg_roles grantee on grantee.oid = privilege.grantee
    where routine.oid = ${routineOid}::oid
    order by grantee, privilege
  `
}

function routineSqlIdentity(operation: ModulePersistenceRoutineDescriptor) {
  return `${quoteIdentifier(operation.schemaName)}.${quoteIdentifier(operation.routineName)}(jsonb)`
}

function quoteRole(role: string) {
  return role === 'PUBLIC' ? 'public' : quoteIdentifier(role)
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`
}

function routineError(moduleId: string, operationId: string, failure: RoutineProvisioningFailure) {
  return new ModulePersistenceRoutineProvisioningError(moduleId, operationId, failure)
}
