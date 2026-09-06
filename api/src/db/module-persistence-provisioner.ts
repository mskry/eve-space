import {
  platformModuleIdMaxLength,
  platformModuleIdPattern,
} from '@eve-space/platform-module-contract'
import type postgres from 'postgres'

interface RoleAttributes {
  rolcanlogin: boolean
  rolcreatedb: boolean
  rolcreaterole: boolean
  rolinherit: boolean
  rolreplication: boolean
  rolsuper: boolean
  rolbypassrls: boolean
}

export function modulePersistenceNames(moduleId: string) {
  if (!platformModuleIdPattern.test(moduleId) || moduleId.length > platformModuleIdMaxLength)
    throw new Error(`Invalid module persistence owner ${moduleId}`)

  const identity = moduleId.replaceAll('-', '_')
  return {
    migrationRoleName: `eve_module_${identity}_migrate`,
    schemaName: `eve_module_${identity}`,
    runtimeRoleName: `eve_module_${identity}_runtime`,
  }
}

export async function provisionModulePersistence(
  connection: postgres.ReservedSql,
  moduleId: string,
) {
  const { migrationRoleName, schemaName, runtimeRoleName } = modulePersistenceNames(moduleId)
  const [context] = await connection<{ current_user: string }[]>`select current_user`
  if (!context) throw new Error('Could not resolve the module migration database identity')

  await ensureRestrictedRole(connection, runtimeRoleName, 'runtime')
  await ensureRestrictedRole(connection, migrationRoleName, 'migration')
  await ensureRestrictedMembership(connection, context.current_user, runtimeRoleName, 'runtime')
  await ensureRestrictedMembership(connection, context.current_user, migrationRoleName, 'migration')

  const [ownedObjects] = await connection<{ exists: boolean }[]>`
    select exists (
      select 1 from pg_namespace where nspowner = to_regrole(${runtimeRoleName})
      union all
      select 1 from pg_class where relowner = to_regrole(${runtimeRoleName})
      union all
      select 1 from pg_proc where proowner = to_regrole(${runtimeRoleName})
      union all
      select 1 from pg_type where typowner = to_regrole(${runtimeRoleName})
    ) as exists
  `
  if (ownedObjects?.exists)
    throw new Error(`Module runtime role ${runtimeRoleName} unexpectedly owns database objects`)

  const [migrationOwnedOutsideSchema] = await connection<{ exists: boolean }[]>`
    select exists (
      select 1 from pg_namespace where nspowner = to_regrole(${migrationRoleName})
      union all
      select 1
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where relation.relowner = to_regrole(${migrationRoleName})
        and namespace.nspname <> ${schemaName}
        and relation.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
      union all
      select 1
      from pg_proc routine
      join pg_namespace namespace on namespace.oid = routine.pronamespace
      where routine.proowner = to_regrole(${migrationRoleName})
        and namespace.nspname <> ${schemaName}
      union all
      select 1
      from pg_type type
      join pg_namespace namespace on namespace.oid = type.typnamespace
      where type.typowner = to_regrole(${migrationRoleName})
        and namespace.nspname <> ${schemaName}
        and not exists (
          select 1 from pg_class relation where relation.oid = type.typrelid
            and relation.relkind = 't'
        )
    ) as exists
  `
  if (migrationOwnedOutsideSchema?.exists)
    throw new Error(
      `Module migration role ${migrationRoleName} unexpectedly owns cross-schema objects`,
    )

  const [schema] = await connection<{ owner: string }[]>`
    select pg_get_userbyid(nspowner) as owner
    from pg_namespace
    where nspname = ${schemaName}
  `
  if (schema && schema.owner !== context.current_user)
    throw new Error(
      `Existing module schema ${schemaName} is owned by unexpected role ${schema.owner}`,
    )
  if (!schema)
    await connection`
      create schema ${connection(schemaName)} authorization ${connection(context.current_user)}
    `

  await transferModuleObjectOwnership(
    connection,
    schemaName,
    context.current_user,
    migrationRoleName,
  )

  const unexpectedDefaults = await connection<{ namespace: string }[]>`
    select coalesce(namespace.nspname, '<global>') as namespace
    from pg_default_acl defaults
    cross join lateral aclexplode(defaults.defaclacl) privilege
    left join pg_namespace namespace on namespace.oid = defaults.defaclnamespace
    where privilege.grantee = to_regrole(${runtimeRoleName})
      and defaults.defaclnamespace is distinct from to_regnamespace(${schemaName})
  `
  if (unexpectedDefaults.length > 0)
    throw new Error(`Module runtime role ${runtimeRoleName} has cross-schema default privileges`)

  const applicationSchemas = await connection<{ name: string }[]>`
    select nspname as name
    from pg_namespace
    where nspname = 'public' or nspname like 'eve_module\\_%' escape '\\'
  `
  // oxlint-disable no-await-in-loop
  for (const { name } of applicationSchemas) {
    await connection`
      revoke all privileges on schema ${connection(name)} from ${connection(runtimeRoleName)}
    `
    await connection`
      revoke all privileges on all tables in schema ${connection(name)}
      from ${connection(runtimeRoleName)}
    `
    await connection`
      revoke all privileges on all sequences in schema ${connection(name)}
      from ${connection(runtimeRoleName)}
    `
    await connection`
      revoke execute on all routines in schema ${connection(name)}
      from ${connection(runtimeRoleName)}
    `
    if (name === schemaName) continue
    await connection`
      revoke all privileges on schema ${connection(name)} from ${connection(migrationRoleName)}
    `
    await connection`
      revoke all privileges on all tables in schema ${connection(name)}
      from ${connection(migrationRoleName)}
    `
    await connection`
      revoke all privileges on all sequences in schema ${connection(name)}
      from ${connection(migrationRoleName)}
    `
    await connection`
      revoke execute on all routines in schema ${connection(name)}
      from ${connection(migrationRoleName)}
    `
  }
  // oxlint-enable no-await-in-loop

  await connection`
    revoke all privileges on schema ${connection(schemaName)} from public
  `
  await connection`
    grant usage on schema ${connection(schemaName)} to ${connection(runtimeRoleName)}
  `
  await connection`
    grant usage, create on schema ${connection(schemaName)} to ${connection(migrationRoleName)}
  `
  await connection`
    grant all privileges on all tables in schema ${connection(schemaName)}
    to ${connection(migrationRoleName)}
  `
  await connection`
    grant all privileges on all sequences in schema ${connection(schemaName)}
    to ${connection(migrationRoleName)}
  `
  await connection`
    grant execute on all routines in schema ${connection(schemaName)}
    to ${connection(migrationRoleName)}
  `
  await connection`
    alter default privileges for role ${connection(context.current_user)}
    in schema ${connection(schemaName)}
    revoke select, insert, update, delete on tables from ${connection(runtimeRoleName)}
  `
  await connection`
    alter default privileges for role ${connection(context.current_user)}
    in schema ${connection(schemaName)}
    revoke usage on sequences from ${connection(runtimeRoleName)}
  `
  await connection`
    alter default privileges for role ${connection(migrationRoleName)}
    in schema ${connection(schemaName)}
    grant select, insert, update, delete on tables to ${connection(runtimeRoleName)}
  `
  await connection`
    alter default privileges for role ${connection(migrationRoleName)}
    in schema ${connection(schemaName)}
    grant usage on sequences to ${connection(runtimeRoleName)}
  `
  await connection`
    alter default privileges for role ${connection(migrationRoleName)}
    in schema ${connection(schemaName)}
    revoke execute on routines from public
  `
  await connection`
    revoke all privileges on all tables in schema ${connection(schemaName)} from public
  `
  await connection`
    revoke all privileges on all sequences in schema ${connection(schemaName)} from public
  `
  await connection`
    revoke execute on all routines in schema ${connection(schemaName)} from public
  `
  await connection`
    grant select, insert, update, delete on all tables in schema ${connection(schemaName)}
    to ${connection(runtimeRoleName)}
  `
  await connection`
    grant usage on all sequences in schema ${connection(schemaName)}
    to ${connection(runtimeRoleName)}
  `
  await connection`
    insert into public.module_schema_provisioning (module_id, provisioned_at)
    values (${moduleId}, now())
    on conflict (module_id) do update
    set provisioned_at = excluded.provisioned_at
  `
}

async function ensureRestrictedRole(
  connection: postgres.ReservedSql,
  roleName: string,
  kind: 'migration' | 'runtime',
) {
  const [role] = await connection<RoleAttributes[]>`
    select
      rolcanlogin,
      rolcreatedb,
      rolcreaterole,
      rolinherit,
      rolreplication,
      rolsuper,
      rolbypassrls
    from pg_roles
    where rolname = ${roleName}
  `
  if (role) {
    if (
      role.rolcanlogin ||
      role.rolcreatedb ||
      role.rolcreaterole ||
      role.rolinherit ||
      role.rolreplication ||
      role.rolsuper ||
      role.rolbypassrls
    )
      throw new Error(`Existing module ${kind} role ${roleName} is not restricted`)
    return
  }

  await connection`
    create role ${connection(roleName)} with
      nologin
      nosuperuser
      nocreatedb
      nocreaterole
      noinherit
      noreplication
      nobypassrls
  `
}

async function ensureRestrictedMembership(
  connection: postgres.ReservedSql,
  platformRoleName: string,
  moduleRoleName: string,
  kind: 'migration' | 'runtime',
) {
  const memberships = await connection<{ member: string; parent: string }[]>`
    select member.rolname as member, parent.rolname as parent
    from pg_auth_members membership
    join pg_roles member on member.oid = membership.member
    join pg_roles parent on parent.oid = membership.roleid
    where
      (parent.rolname = ${moduleRoleName} and member.rolname <> ${platformRoleName})
      or member.rolname = ${moduleRoleName}
  `
  if (memberships.length > 0)
    throw new Error(`Existing module ${kind} role ${moduleRoleName} has unexpected memberships`)

  await connection`revoke ${connection(moduleRoleName)} from ${connection(platformRoleName)}`
  await connection`
    grant ${connection(moduleRoleName)} to ${connection(platformRoleName)}
    with inherit false, set true
  `
  const [membership] = await connection<{ count: number; restricted: boolean }[]>`
    select
      count(*)::integer as count,
      coalesce(
        bool_and(
          not membership.admin_option
          and not membership.inherit_option
          and membership.set_option
        ),
        false
      ) as restricted
    from pg_auth_members membership
    join pg_roles member on member.oid = membership.member
    join pg_roles parent on parent.oid = membership.roleid
    where parent.rolname = ${moduleRoleName}
      and member.rolname = ${platformRoleName}
  `
  if (membership?.count !== 1 || !membership.restricted)
    throw new Error(`Module ${kind} role ${moduleRoleName} membership is not restricted`)
}

async function transferModuleObjectOwnership(
  connection: postgres.ReservedSql,
  schemaName: string,
  platformRoleName: string,
  migrationRoleName: string,
) {
  const relations = await connection<{ kind: string; name: string }[]>`
    select relation.relkind as kind, relation.relname as name
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = ${schemaName}
      and relation.relowner = to_regrole(${platformRoleName})
      and relation.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
    order by relation.relname
  `
  // oxlint-disable no-await-in-loop
  for (const relation of relations) {
    if (relation.kind === 'S')
      await connection`alter sequence ${connection(schemaName)}.${connection(relation.name)} owner to ${connection(migrationRoleName)}`
    else if (relation.kind === 'v')
      await connection`alter view ${connection(schemaName)}.${connection(relation.name)} owner to ${connection(migrationRoleName)}`
    else if (relation.kind === 'm')
      await connection`alter materialized view ${connection(schemaName)}.${connection(relation.name)} owner to ${connection(migrationRoleName)}`
    else if (relation.kind === 'f')
      await connection`alter foreign table ${connection(schemaName)}.${connection(relation.name)} owner to ${connection(migrationRoleName)}`
    else
      await connection`alter table ${connection(schemaName)}.${connection(relation.name)} owner to ${connection(migrationRoleName)}`
  }

  const routines = await connection<{ arguments: string; kind: string; name: string }[]>`
    select
      pg_get_function_identity_arguments(routine.oid) as arguments,
      routine.prokind as kind,
      routine.proname as name
    from pg_proc routine
    join pg_namespace namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = ${schemaName}
      and routine.proowner = to_regrole(${platformRoleName})
    order by routine.proname, routine.oid
  `
  for (const routine of routines) {
    const kind =
      routine.kind === 'p' ? 'procedure' : routine.kind === 'a' ? 'aggregate' : 'function'
    await connection
      .unsafe(
        `alter ${kind} ${quoteIdentifier(schemaName)}.${quoteIdentifier(routine.name)}(${routine.arguments}) owner to ${quoteIdentifier(migrationRoleName)}`,
      )
      .simple()
  }

  const types = await connection<{ kind: string; name: string }[]>`
    select type.typtype as kind, type.typname as name
    from pg_type type
    join pg_namespace namespace on namespace.oid = type.typnamespace
    where namespace.nspname = ${schemaName}
      and type.typowner = to_regrole(${platformRoleName})
      and type.typtype in ('c', 'd', 'e', 'm', 'r')
      and not exists (
        select 1 from pg_class relation where relation.oid = type.typrelid
          and relation.relkind <> 'c'
      )
    order by type.typname
  `
  for (const type of types) {
    const kind = type.kind === 'd' ? 'domain' : 'type'
    await connection
      .unsafe(
        `alter ${kind} ${quoteIdentifier(schemaName)}.${quoteIdentifier(type.name)} owner to ${quoteIdentifier(migrationRoleName)}`,
      )
      .simple()
  }
  // oxlint-enable no-await-in-loop
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`
}
