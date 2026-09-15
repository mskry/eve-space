import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import postgres from 'postgres'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { runMigrations } from '../../../../../../api/src/db/migration-runner.js'
import { runModuleMigrationSets } from '../../../../../../api/src/db/module-migration-runner.js'
import {
  createStandaloneModulePersistenceOperationInvoker,
  createTransactionScopedModulePersistenceOperationInvoker,
} from '../../../../../../api/src/db/module-persistence-operation-transaction.js'
import {
  installedModulePersistenceCapabilityFactories,
  installedModulePersistenceOperations,
} from '../../../../../../api/src/generated/platform/installed-module-persistence.js'
import {
  materializeActivityResource,
  readActivityCheckpoint,
} from '../../../src/collection-store.js'
import { readActivitySnapshots } from '../../../src/snapshot-reads.js'
import { summarySnapshot } from '../../../src/snapshot.js'
import type { ActivityObservation } from '../../../src/collection-types.js'
import type { ActivitySnapshot } from '../../../src/snapshot.js'

let container: StartedTestContainer
let connection: postgres.Sql
const checkpointFactory =
  installedModulePersistenceCapabilityFactories.resourceProjections[
    'organization-activity/character-jobs'
  ]
const snapshotFactory =
  installedModulePersistenceCapabilityFactories.routes['organization-activity/activity-details']
const materializationFactory =
  installedModulePersistenceCapabilityFactories.resourceMaterializations[
    'organization-activity/character-jobs'
  ]
let checkpointPersistence: ReturnType<typeof checkpointFactory>
let snapshotPersistence: ReturnType<typeof snapshotFactory>
const moduleId = 'organization-activity'
const migrationNames = ['organization-activity-001-baseline.sql'] as const
const lifecycleId = randomUUID()
const activityId = randomUUID()
const snapshot = summarySnapshot(
  { id: activityId, name: 'Supplies', state: 'Active', progress: { current: 1, desired: 10 } },
  'job',
  9801,
)

beforeAll(async () => {
  const password = randomUUID()
  container = await new GenericContainer('postgres:17-alpine')
    .withEnvironment({
      POSTGRES_DB: 'eve_space',
      POSTGRES_USER: 'eve_space',
      POSTGRES_PASSWORD: password,
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start()
  connection = postgres(
    `postgres://eve_space:${password}@${container.getHost()}:${container.getMappedPort(5432)}/eve_space`,
  )
  await runMigrations(connection)
  const migrations = await Promise.all(
    migrationNames.map(async (name) => ({
      name,
      sql: await readFile(new URL(`../../../migrations/${name}`, import.meta.url), 'utf8'),
    })),
  )
  const migrationSet = {
    moduleId,
    migrations,
    persistenceOperations: installedModulePersistenceOperations,
  }
  await runModuleMigrationSets(connection, [migrationSet])
  await runModuleMigrationSets(connection, [migrationSet])
  const readInvoker = createStandaloneModulePersistenceOperationInvoker(
    connection,
    moduleId,
    installedModulePersistenceOperations,
    { readOnly: true },
  )
  checkpointPersistence = checkpointFactory(readInvoker)
  snapshotPersistence = snapshotFactory(readInvoker)
})
afterAll(async () => {
  await connection?.end()
  await container?.stop()
})

function observation(resourceId: string, revision = 0): ActivityObservation {
  return {
    resourceId,
    organizationVersion: 7,
    expectedRevision: revision,
    checkpoint: { initialized: true, requests: [], cursors: { root: { after: 'opaque' } } },
    snapshots: [{ snapshot, replace: true, validatedAt: new Date().toISOString() }],
  }
}
function write(
  data: ActivityObservation,
  generation = 4,
  afterOperation?: () => void | Promise<void>,
) {
  return connection.begin(async (transaction) => {
    const scoped = createTransactionScopedModulePersistenceOperationInvoker(
      transaction,
      moduleId,
      installedModulePersistenceOperations,
    )
    try {
      const result = await materializeActivityResource({
        data,
        subject: { kind: 'character', characterId: 9001, lifecycleId },
        authorizationGeneration: generation,
        validatedAt: new Date().toISOString(),
        capabilities: { persistence: materializationFactory(scoped.invoke) },
      } as never)
      await afterOperation?.()
      const suppressedFailure = scoped.suppressedFailure()
      if (suppressedFailure) throw suppressedFailure.error
      return result
    } finally {
      scoped.close()
    }
  })
}
function read(resourceId: string, version = 7, generation = 4, lifecycle = lifecycleId) {
  const collectionStatus = {
    read: vi.fn().mockResolvedValue({
      status: 'current',
      subjectLifecycleId: lifecycle,
      authorizationGeneration: generation,
      validatedAt: new Date().toISOString(),
      lastFailureClass: null,
    }),
  }
  return readActivitySnapshots(
    { persistence: snapshotPersistence, collectionStatus },
    version,
    resourceId,
    { kind: 'character', characterId: 9001 },
    activityId,
  )
}

function readCheckpoint(resourceId: string, generation = 4) {
  return readActivityCheckpoint(resourceId, {
    capabilities: { persistence: checkpointPersistence },
    subject: { lifecycleId },
    organizationVersion: 7,
    authorizationGeneration: generation,
  } as never)
}

test('migration is idempotent and the runtime role has only generated routine access', async () => {
  const rows =
    await connection`select name from public.schema_migrations where module = ${moduleId} order by name`
  expect(rows).toEqual(migrationNames.map((name) => ({ name })))
  const [privileges] = await connection<
    {
      canReadCore: boolean
      canReadModuleTables: boolean
      canExecuteRead: boolean
      canExecuteWrite: boolean
    }[]
  >`
    select
      has_table_privilege(
        'eve_module_organization_activity_runtime',
        'public.users',
        'select'
      ) as "canReadCore",
      has_table_privilege(
        'eve_module_organization_activity_runtime',
        'eve_module_organization_activity.activity_snapshots',
        'select'
      ) as "canReadModuleTables",
      has_function_privilege(
        'eve_module_organization_activity_runtime',
        'eve_module_organization_activity.persist_read_activity_checkpoint(jsonb)',
        'execute'
      ) as "canExecuteRead",
      has_function_privilege(
        'eve_module_organization_activity_runtime',
        'eve_module_organization_activity.persist_materialize_activity_observation(jsonb)',
        'execute'
      ) as "canExecuteWrite"
  `
  expect(privileges).toEqual({
    canReadCore: false,
    canReadModuleTables: false,
    canExecuteRead: true,
    canExecuteWrite: true,
  })
  expect(Object.keys(checkpointPersistence)).toEqual(['readActivityCheckpoint'])
  expect(Object.keys(snapshotPersistence)).toEqual(['readActivitySnapshots'])
})

test.each([
  'campaigns',
  'public-jobs',
  'corporation-jobs',
  'corporation-projects',
  'character-jobs',
  'character-campaigns',
  'character-projects',
])(
  '%s persists through the real module capability and isolates organization, generation and lifecycle',
  async (resourceId) => {
    expect(await write(observation(resourceId))).toBeUndefined()
    expect((await read(resourceId)).snapshots).toEqual([snapshot])
    expect((await read(resourceId, 8)).snapshots).toEqual([])
    expect((await read(resourceId, 7, 5)).snapshots).toEqual([])
    expect((await read(resourceId, 7, 4, randomUUID())).snapshots).toEqual([])
    const checkpoint = await readCheckpoint(resourceId)
    expect(checkpoint?.revision).toBe(1)
    expect(checkpoint?.checkpoint.cursors.root).toEqual({ after: 'opaque' })
  },
)

test('before pages retain existing data, after pages replace it, and obsolete writers do nothing', async () => {
  const resourceId = 'duplicate-test'
  await write(observation(resourceId))
  const before = observation(resourceId, 1)
  const replacement = { ...snapshot, title: 'New title' }
  await write({
    ...before,
    snapshots: [{ snapshot: replacement, replace: false, validatedAt: new Date().toISOString() }],
  })
  expect((await read(resourceId)).snapshots[0]?.title).toBe('Supplies')
  expect(await write(before)).toEqual({ outcome: 'obsolete' })
  await write({
    ...observation(resourceId, 2),
    snapshots: [{ snapshot: replacement, replace: true, validatedAt: new Date().toISOString() }],
  })
  expect((await read(resourceId)).snapshots[0]?.title).toBe('New title')
  expect((await readCheckpoint(resourceId))?.revision).toBe(3)
})

test('complete membership lists prune absent entries only in their own identity', async () => {
  const resourceId = 'pruning-test'
  await write(observation(resourceId))
  await write(observation(resourceId), 5)
  await write({
    ...observation(resourceId, 1),
    snapshots: [],
    checkpoint: { initialized: true, requests: [], cursors: {}, retainedIds: [] },
  })
  expect((await read(resourceId)).snapshots).toEqual([])
  expect((await read(resourceId, 7, 5)).snapshots).toEqual([snapshot])
})

test('incremental completion does not renew untouched snapshots', async () => {
  const resourceId = 'incremental-renewal-test'
  const originalValidatedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  await write({
    ...observation(resourceId),
    checkpoint: {
      initialized: true,
      requests: [{ operation: 'job-detail', path: { job_id: activityId }, replace: true }],
      cursors: { root: { after: 'opaque' } },
    },
    snapshots: [{ snapshot, replace: true, validatedAt: originalValidatedAt }],
  })
  await write({ ...observation(resourceId, 1), snapshots: [] })
  const rows = await connection<{ unchanged: boolean }[]>`
    select validated_at = ${originalValidatedAt}::timestamptz as unchanged
    from eve_module_organization_activity.activity_snapshots
    where resource_id = ${resourceId}
      and subject_lifecycle_id = ${lifecycleId}
      and organization_version = 7
      and authorization_generation = 4
      and activity_id = ${activityId}
  `
  expect(rows).toEqual([{ unchanged: true }])
})

test('campaign retention prunes objectives whose campaigns are no longer active', async () => {
  const resourceId = 'campaign-retention-test'
  const activeCampaignId = randomUUID()
  const inactiveCampaignId = randomUUID()
  const activeObjectiveId = randomUUID()
  const inactiveObjectiveId = randomUUID()
  const activeCampaign = {
    ...snapshot,
    id: activeCampaignId,
    kind: 'campaign',
    campaignId: null,
  } satisfies ActivitySnapshot
  const inactiveCampaign = {
    ...activeCampaign,
    id: inactiveCampaignId,
  } satisfies ActivitySnapshot
  const activeObjective = {
    ...activeCampaign,
    id: activeObjectiveId,
    kind: 'objective',
    campaignId: activeCampaignId,
  } satisfies ActivitySnapshot
  const inactiveObjective = {
    ...activeObjective,
    id: inactiveObjectiveId,
    campaignId: inactiveCampaignId,
  } satisfies ActivitySnapshot
  await write({
    ...observation(resourceId),
    checkpoint: {
      initialized: true,
      requests: [],
      cursors: {},
      retainedIds: [activeCampaignId, inactiveCampaignId],
      retainedCampaignIds: [activeCampaignId, inactiveCampaignId],
    },
    snapshots: [activeCampaign, inactiveCampaign, activeObjective, inactiveObjective].map(
      (item) => ({ snapshot: item, replace: true, validatedAt: new Date().toISOString() }),
    ),
  })
  await write({
    ...observation(resourceId, 1),
    checkpoint: {
      initialized: true,
      requests: [],
      cursors: {},
      retainedIds: [activeCampaignId, inactiveCampaignId],
      retainedCampaignIds: [activeCampaignId],
    },
    snapshots: [
      { snapshot: activeCampaign, replace: true, validatedAt: new Date().toISOString() },
      {
        snapshot: { ...inactiveCampaign, state: 'Completed' },
        replace: true,
        validatedAt: new Date().toISOString(),
      },
    ],
  })
  const rows = await connection<{ id: string }[]>`
    select activity_id::text as id
    from eve_module_organization_activity.activity_snapshots
    where resource_id = ${resourceId}
      and subject_lifecycle_id = ${lifecycleId}
      and organization_version = 7
      and authorization_generation = 4
    order by activity_id
  `
  expect(rows.map(({ id }) => id).toSorted()).toEqual(
    [activeCampaignId, inactiveCampaignId, activeObjectiveId].toSorted(),
  )
})

test('a failed materialization rolls back snapshots and checkpoint together', async () => {
  const data = observation('rollback-test')
  await expect(
    write(data, 4, () => {
      throw new Error('rollback')
    }),
  ).rejects.toThrow('rollback')
  expect((await read('rollback-test')).snapshots).toEqual([])
  const checkpoint = await readCheckpoint('rollback-test')
  expect(checkpoint).toBeUndefined()
})

test('stale snapshot cleanup uses the retention index at representative volume', async () => {
  const planLifecycleId = randomUUID()
  await connection`
    insert into eve_module_organization_activity.activity_snapshots (
      resource_id,
      subject_lifecycle_id,
      organization_version,
      authorization_generation,
      activity_id,
      snapshot,
      validated_at
    )
    select
      'query-plan',
      ${planLifecycleId},
      7,
      4,
      md5(generate_series::text)::uuid,
      jsonb_build_object('id', md5(generate_series::text)),
      case
        when generate_series <= 100 then now() - '25:00:00'::interval
        else now()
      end
    from generate_series(1, 10000)
  `
  await connection`analyze eve_module_organization_activity.activity_snapshots`

  const [explained] = await connection<{ 'QUERY PLAN': unknown }[]>`
    explain (format json)
    delete from eve_module_organization_activity.activity_snapshots
    where validated_at < now() - '24:00:00'::interval
  `

  expect(JSON.stringify(explained?.['QUERY PLAN'])).toContain('activity_snapshots_retention_idx')
})
