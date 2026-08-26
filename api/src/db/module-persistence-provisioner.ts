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
    schemaName: `eve_module_${identity}`,
    runtimeRoleName: `eve_module_${identity}_runtime`,
  }
}

export async function provisionModulePersistence(
  connection: postgres.ReservedSql,
  moduleId: string,
) {
  const { schemaName, runtimeRoleName } = modulePersistenceNames(moduleId)
  const [context] = await connection<{ current_user: string }[]>`select current_user`
  if (!context) throw new Error('Could not resolve the module migration database identity')

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
    where rolname = ${runtimeRoleName}
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
      throw new Error(`Existing module runtime role ${runtimeRoleName} is not restricted`)
  } else {
    await connection`
      create role ${connection(runtimeRoleName)} with
        nologin
        nosuperuser
        nocreatedb
        nocreaterole
        noinherit
        noreplication
        nobypassrls
    `
  }

  const memberships = await connection<{ member: string; parent: string }[]>`
    select member.rolname as member, parent.rolname as parent
    from pg_auth_members membership
    join pg_roles member on member.oid = membership.member
    join pg_roles parent on parent.oid = membership.roleid
    where
      (parent.rolname = ${runtimeRoleName} and member.rolname <> ${context.current_user})
      or member.rolname = ${runtimeRoleName}
  `
  if (memberships.length > 0)
    throw new Error(`Existing module runtime role ${runtimeRoleName} has unexpected memberships`)

  await connection`
    revoke ${connection(runtimeRoleName)} from ${connection(context.current_user)}
  `
  await connection`
    grant ${connection(runtimeRoleName)} to ${connection(context.current_user)}
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
    where parent.rolname = ${runtimeRoleName}
      and member.rolname = ${context.current_user}
  `
  if (membership?.count !== 1 || !membership.restricted)
    throw new Error(`Module runtime role ${runtimeRoleName} membership is not restricted`)

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

  const unexpectedDefaults = await connection<{ namespace: string }[]>`
    select coalesce(namespace.nspname, '<global>') as namespace
    from pg_default_acl defaults
    cross join lateral aclexplode(defaults.defaclacl) privilege
    left join pg_namespace namespace on namespace.oid = defaults.defaclnamespace
    where privilege.grantee = to_regrole(${runtimeRoleName})
      and defaults.defaclnamespace <> to_regnamespace(${schemaName})
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
  }
  // oxlint-enable no-await-in-loop

  await connection`
    revoke all privileges on schema ${connection(schemaName)} from public
  `
  await connection`
    grant usage on schema ${connection(schemaName)} to ${connection(runtimeRoleName)}
  `
  await connection`
    alter default privileges for role ${connection(context.current_user)}
    in schema ${connection(schemaName)}
    grant select, insert, update, delete on tables to ${connection(runtimeRoleName)}
  `
  await connection`
    alter default privileges for role ${connection(context.current_user)}
    in schema ${connection(schemaName)}
    grant usage on sequences to ${connection(runtimeRoleName)}
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
