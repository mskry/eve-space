import type postgres from 'postgres'
import { describe, expect, test, vi } from 'vitest'
import {
  assertInstalledModulePersistenceContract,
  assertInstalledModulePersistenceContractWhenCurrent,
  persistenceContractFingerprintFor,
  reconcileInstalledModulePersistenceContract,
} from '../../src/db/module-persistence-attestation.js'
import { canonicalizePersistenceRoutineSql } from '../../src/db/module-persistence-routine.js'
import type { ModulePersistenceRoutineDescriptor } from '../../src/db/module-persistence-routine-provisioner.js'

describe('module persistence attestation', () => {
  test('attests exact installed state through installed module filters', async () => {
    const operation = await readOperation()
    const contractFingerprint = persistenceContractFingerprintFor([operation], ['alpha'])
    const queries: { readonly text: string; readonly values: readonly unknown[] }[] = []
    const connection = vi.fn((parts: TemplateStringsArray, ...values: unknown[]) => {
      const text = parts.join('?')
      queries.push({ text, values })
      if (text.includes('from public.module_persistence_contract'))
        return Promise.resolve([{ contract_fingerprint: contractFingerprint, operation_count: 1 }])
      if (text.includes('from public.module_persistence_operation_attestations'))
        return Promise.resolve([
          {
            definition_fingerprint: operation.definitionFingerprint,
            migration_name: operation.migration,
            mode: operation.mode,
            module_id: operation.moduleId,
            operation_id: operation.operationId,
            revision: operation.revision,
            routine_name: operation.routineName,
            schema_name: operation.schemaName,
          },
        ])
      if (text.includes('pg_get_functiondef'))
        return Promise.resolve([
          {
            definition: readRoutineSql,
            oid: '101',
            owner: 'eve_module_alpha_migrate',
            parallel: 'u',
            routine_name: operation.routineName,
            schema_name: operation.schemaName,
            security_definer: true,
            settings: ['search_path=pg_catalog, eve_module_alpha, pg_temp'],
            signature_valid: true,
            volatility: 's',
          },
        ])
      if (text.includes('aclexplode'))
        return Promise.resolve([
          {
            grantable: false,
            grantee: 'eve_module_alpha_migrate',
            oid: '101',
            privilege: 'EXECUTE',
          },
          {
            grantable: false,
            grantee: 'eve_module_alpha_runtime',
            oid: '101',
            privilege: 'EXECUTE',
          },
        ])
      if (text.includes('from pg_auth_members'))
        return Promise.resolve([
          membership('eve_module_alpha_migrate'),
          membership('eve_module_alpha_runtime'),
        ])
      if (text.includes('cross join pg_namespace'))
        return Promise.resolve([
          {
            create_access: true,
            role_name: 'eve_module_alpha_migrate',
            schema_name: 'eve_module_alpha',
            usage_access: true,
          },
          {
            create_access: false,
            role_name: 'eve_module_alpha_runtime',
            schema_name: 'eve_module_alpha',
            usage_access: true,
          },
        ])
      if (text.includes('cross join pg_class')) return Promise.resolve([])
      if (text.includes('from pg_roles'))
        return Promise.resolve([role('eve_module_alpha_migrate'), role('eve_module_alpha_runtime')])
      throw new Error(`Unexpected attestation query: ${text}`)
    })

    await expect(
      assertInstalledModulePersistenceContract(
        connection as unknown as postgres.Sql,
        contractFingerprint,
        [operation],
        ['alpha'],
      ),
    ).resolves.toBeUndefined()

    expect(
      queries.find(({ text }) =>
        text.includes('from public.module_persistence_operation_attestations'),
      )?.values,
    ).toEqual([['alpha']])
    expect(
      queries
        .filter(({ text }) => text.includes("routine.proname like 'persist"))
        .map(({ values }) => values),
    ).toEqual([[['eve_module_alpha']], [['eve_module_alpha']]])
  })

  test('returns false without inspecting state when the current contract differs', async () => {
    const connection = vi
      .fn()
      .mockResolvedValue([{ contract_fingerprint: 'stale', operation_count: 0 }])

    await expect(
      assertInstalledModulePersistenceContractWhenCurrent(
        connection as unknown as postgres.Sql,
        'expected',
        [],
        [],
      ),
    ).resolves.toBe(false)
    expect(connection).toHaveBeenCalledOnce()
  })

  test('reconciles an empty installed inventory without retained module state', async () => {
    const queries: { readonly text: string; readonly values: readonly unknown[] }[] = []
    const connection = vi.fn((parts: TemplateStringsArray, ...values: unknown[]) => {
      const text = parts.join('?')
      queries.push({ text, values })
      if (
        text.includes('from public.module_persistence_operation_attestations') ||
        text.includes('from pg_proc routine') ||
        text.includes('insert into public.module_persistence_contract')
      )
        return Promise.resolve([])
      throw new Error(`Unexpected attestation query: ${text}`)
    })
    const contractFingerprint = persistenceContractFingerprintFor([], [])

    await expect(
      reconcileInstalledModulePersistenceContract(
        connection as unknown as postgres.Sql,
        contractFingerprint,
        [],
        [],
      ),
    ).resolves.toBeUndefined()

    const filters = queries
      .filter(({ text }) => text.includes(' = any('))
      .map(({ values }) => values)
    expect(filters).toEqual([[[]], [[]], [[]]])
    expect(queries.at(-1)?.values).toEqual([contractFingerprint, 0])
  })
})

const readRoutineSql = `
  create function eve_module_alpha.persist_read_snapshot(input jsonb)
  returns jsonb
  language sql
  stable
  parallel unsafe
  return input
`

async function readOperation(): Promise<ModulePersistenceRoutineDescriptor> {
  const canonical = await canonicalizePersistenceRoutineSql({
    moduleId: 'alpha',
    operationId: 'read-snapshot',
    revision: 1,
    mode: 'read',
    sql: readRoutineSql,
  })
  return {
    definitionFingerprint: canonical.definitionFingerprint,
    migration: 'alpha-001-read-snapshot.sql',
    mode: 'read',
    moduleId: 'alpha',
    operationId: 'read-snapshot',
    revision: 1,
    routineName: canonical.identity.routineName,
    schemaName: canonical.identity.schemaName,
  }
}

function role(rolname: string) {
  return {
    platform_role: 'eve_space',
    rolbypassrls: false,
    rolcanlogin: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolinherit: false,
    rolname,
    rolreplication: false,
    rolsuper: false,
  }
}

function membership(parent: string) {
  return {
    admin_option: false,
    inherit_option: false,
    member: 'eve_space',
    parent,
    set_option: true,
  }
}
