import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
  bindPlatformPersistenceOperation,
  definePlatformPersistenceOperation,
} from '@eve-space/platform-module-server'
import postgres from 'postgres'
import { GenericContainer, Wait } from 'testcontainers'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { runMigrations } from '../../../src/db/migration-runner.js'
import { runModuleMigrationSets } from '../../../src/db/module-migration-runner.js'
import { canonicalizePersistenceRoutineSql } from '../../../src/db/module-persistence-routine.js'
import { createStandaloneModulePersistenceOperationInvoker } from '../../../src/db/module-persistence-operation-transaction.js'

const fixtureRoot = fileURLToPath(
  new URL('../../../../tests/fixtures/platform-module-conformance', import.meta.url),
)
const snapshotSchema = z.strictObject({
  characterId: z.number().int().positive(),
  pilotsOnline: z.number().int().nonnegative(),
  validatedAt: z.iso.datetime({ offset: true }),
})
const readConformanceSnapshotOperation = definePlatformPersistenceOperation({
  id: 'read-conformance-snapshot',
  method: 'readConformanceSnapshot',
  revision: 1,
  mode: 'read',
  inputSchema: z.strictObject({ characterId: z.number().int().positive() }),
  outputSchema: z.union([snapshotSchema, z.null()]),
  maximumInputBytes: 64,
  maximumOutputBytes: 1_024,
})
const upsertConformanceSnapshotOperation = definePlatformPersistenceOperation({
  id: 'upsert-conformance-snapshot',
  method: 'upsertConformanceSnapshot',
  revision: 1,
  mode: 'write',
  inputSchema: snapshotSchema,
  outputSchema: z.strictObject({ applied: z.literal(true) }),
  maximumInputBytes: 1_024,
  maximumOutputBytes: 64,
})

it('runs the conformance migration under its schema-only role and leaves the ledger platform-owned', async () => {
  const password = randomUUID()
  const container = await new GenericContainer('postgres:17-alpine')
    .withEnvironment({
      POSTGRES_DB: 'eve_space',
      POSTGRES_PASSWORD: password,
      POSTGRES_USER: 'eve_space',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start()
  const connection = postgres(
    `postgres://eve_space:${password}@${container.getHost()}:${container.getMappedPort(5432)}/eve_space`,
  )

  try {
    await runMigrations(connection)
    const migrationNames = [
      'conformance-001-initial.sql',
      'conformance-002-persistence-operations.sql',
    ] as const
    const migrations = await Promise.all(
      migrationNames.map(async (name) => ({
        name,
        sql: await readFile(
          `${fixtureRoot}/features/conformance/server/migrations/${name}`,
          'utf8',
        ),
      })),
    )
    const operations = await conformancePersistenceDescriptors(migrations[1]!.sql)
    await runModuleMigrationSets(connection, [
      {
        moduleId: 'conformance',
        migrations,
        persistenceOperations: operations,
      },
    ])
    await connection`
      insert into deployment_modules (module_id, enabled)
      values ('conformance', true)
    `
    const write = createStandaloneModulePersistenceOperationInvoker(
      connection,
      'conformance',
      operations,
      { readOnly: false },
    )
    const read = createStandaloneModulePersistenceOperationInvoker(
      connection,
      'conformance',
      operations,
      { readOnly: true },
    )
    const upsertConformanceSnapshot = bindPlatformPersistenceOperation(operations[1]!, write)
    const readConformanceSnapshot = bindPlatformPersistenceOperation(operations[0]!, read)
    await upsertConformanceSnapshot({
      characterId: 9001,
      pilotsOnline: 12,
      validatedAt: '2026-09-14T12:00:00Z',
    })
    const snapshot = await readConformanceSnapshot({ characterId: 9001 })
    await connection`update deployment_modules set enabled = false where module_id = 'conformance'`

    const [state] = await connection<
      {
        direct_table_access: boolean
        enabled: boolean
        ledger_owner: string
        migration_count: number
        migration_role: string
        migration_schema: string
        schema_owner: string
        snapshot_count: number
        table_owner: string
      }[]
    >`
      select
        pg_get_userbyid(schema_namespace.nspowner) as schema_owner,
        pg_get_userbyid(snapshot.relowner) as table_owner,
        pg_get_userbyid(ledger.relowner) as ledger_owner,
        identity.role_name as migration_role,
        identity.schema_name as migration_schema,
        (
          select enabled
          from public.deployment_modules
          where module_id = 'conformance'
        ) as enabled,
        has_table_privilege(
          'eve_module_conformance_runtime',
          'eve_module_conformance.conformance_snapshots',
          'SELECT, INSERT, UPDATE, DELETE'
        ) as direct_table_access,
        (
          select count(*)::integer
          from eve_module_conformance.conformance_snapshots
        ) as snapshot_count,
        (
          select count(*)::integer
          from public.schema_migrations
          where module = 'conformance'
        ) as migration_count
      from pg_namespace schema_namespace
      join pg_class snapshot on snapshot.relnamespace = schema_namespace.oid
        and snapshot.relname = 'conformance_snapshots'
      cross join pg_class ledger
      cross join eve_module_conformance.conformance_migration_identity identity
      where schema_namespace.nspname = 'eve_module_conformance'
        and ledger.oid = 'public.schema_migrations'::regclass
    `
    expect(snapshot).toEqual({
      characterId: 9001,
      pilotsOnline: 12,
      validatedAt: '2026-09-14T12:00:00+00:00',
    })
    expect(state).toEqual({
      direct_table_access: false,
      enabled: false,
      ledger_owner: 'eve_space',
      migration_count: 2,
      migration_role: 'eve_module_conformance_migrate',
      migration_schema: 'eve_module_conformance',
      schema_owner: 'eve_space',
      snapshot_count: 1,
      table_owner: 'eve_module_conformance_migrate',
    })
  } finally {
    await connection.end()
    await container.stop()
  }
})

async function conformancePersistenceDescriptors(sql: string) {
  const definitions = [
    readConformanceSnapshotOperation,
    upsertConformanceSnapshotOperation,
  ] as const
  return Promise.all(
    definitions.map(async (definition) => {
      const canonical = await canonicalizePersistenceRoutineSql({
        moduleId: 'conformance',
        operationId: definition.id,
        revision: definition.revision,
        mode: definition.mode,
        sql,
      })
      return {
        moduleId: 'conformance',
        operationId: definition.id,
        method: definition.method,
        revision: definition.revision,
        mode: definition.mode,
        migration: 'conformance-002-persistence-operations.sql',
        schemaName: canonical.identity.schemaName,
        routineName: canonical.identity.routineName,
        definitionFingerprint: canonical.definitionFingerprint,
        definition,
        grants: {
          routes: [],
          activityProviders: definition.mode === 'read' ? ['conformance-activity'] : [],
          resourceProjections: [],
          resourceMaterializations: definition.mode === 'write' ? ['conformance-status'] : [],
        },
      }
    }),
  )
}
