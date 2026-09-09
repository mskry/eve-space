import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { GenericContainer, Wait } from 'testcontainers'
import { expect, it } from 'vitest'
import { runMigrations } from '../../../src/db/migration-runner.js'
import { runModuleMigrationSets } from '../../../src/db/module-migration-runner.js'

const fixtureRoot = fileURLToPath(
  new URL('../../../../tests/fixtures/platform-module-conformance', import.meta.url),
)

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
    const sql = await readFile(
      `${fixtureRoot}/features/conformance/server/migrations/conformance-001-initial.sql`,
      'utf8',
    )
    await runModuleMigrationSets(connection, [
      {
        moduleId: 'conformance',
        migrations: [{ name: 'conformance-001-initial.sql', sql }],
      },
    ])
    await connection`
      insert into deployment_modules (module_id, enabled)
      values ('conformance', true)
    `
    await connection.begin(async (transaction) => {
      await transaction`set local role eve_module_conformance_runtime`
      await transaction`
        insert into eve_module_conformance.conformance_snapshots (
          character_id,
          pilots_online,
          validated_at
        ) values (9001, 12, now())
      `
    })
    await connection`update deployment_modules set enabled = false where module_id = 'conformance'`

    const [state] = await connection<
      {
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
    expect(state).toEqual({
      enabled: false,
      ledger_owner: 'eve_space',
      migration_count: 1,
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
