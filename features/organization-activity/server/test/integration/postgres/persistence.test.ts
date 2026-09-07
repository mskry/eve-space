import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import postgres from 'postgres'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { runMigrations } from '../../../../../../api/src/db/migration-runner.js'
import { runModuleMigrationSets } from '../../../../../../api/src/db/module-migration-runner.js'
import { createModulePersistenceCapability } from '../../../../../../api/src/db/module-persistence.js'
import { withModuleQueryTransaction } from '../../../../../../api/src/db/module-query-transaction.js'
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
let persistence: ReturnType<typeof capability>
const moduleId = 'organization-activity'
const migrationName = 'organization-activity-001-initial.sql'
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
  const sql = await readFile(
    new URL('../../../migrations/organization-activity-001-initial.sql', import.meta.url),
    'utf8',
  )
  await runModuleMigrationSets(connection, [
    { moduleId, migrations: [{ name: migrationName, sql }] },
  ])
  await runModuleMigrationSets(connection, [
    { moduleId, migrations: [{ name: migrationName, sql }] },
  ])
  persistence = capability()
})
afterAll(async () => {
  await connection?.end()
  await container?.stop()
})

function capability() {
  const adapter = createModulePersistenceCapability(connection, moduleId)
  return {
    transaction: <T>(operation: Parameters<typeof withModuleQueryTransaction<T>>[1]) =>
      adapter.transaction((transaction) => withModuleQueryTransaction(transaction, operation)),
  }
}
function observation(resourceId: string, revision = 0): ActivityObservation {
  return {
    resourceId,
    organizationVersion: 7,
    expectedRevision: revision,
    checkpoint: { initialized: true, requests: [], cursors: { root: { after: 'opaque' } } },
    snapshots: [{ snapshot, replace: true, validatedAt: new Date().toISOString() }],
  }
}
function write(data: ActivityObservation, generation = 4) {
  return materializeActivityResource({
    data,
    subject: { kind: 'character', characterId: 9001, lifecycleId },
    authorizationGeneration: generation,
    validatedAt: new Date().toISOString(),
    capabilities: { persistence },
  } as never)
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
    { persistence, collectionStatus },
    version,
    resourceId,
    { kind: 'character', characterId: 9001 },
    activityId,
  )
}

test('migration is idempotent and module runtime cannot access core tables', async () => {
  const rows =
    await connection`select name from public.schema_migrations where module = ${moduleId}`
  expect(rows).toEqual([{ name: migrationName }])
  await expect(
    persistence.transaction((tx) => tx.query('select * from public.users')),
  ).rejects.toThrow(/permission denied/)
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
    await write(observation(resourceId))
    expect((await read(resourceId)).snapshots).toEqual([snapshot])
    expect((await read(resourceId, 8)).snapshots).toEqual([])
    expect((await read(resourceId, 7, 5)).snapshots).toEqual([])
    expect((await read(resourceId, 7, 4, randomUUID())).snapshots).toEqual([])
    const checkpoint = await readActivityCheckpoint(resourceId, {
      capabilities: { persistence },
      subject: { lifecycleId },
      organizationVersion: 7,
      authorizationGeneration: 4,
    } as never)
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
  const rows = await persistence.transaction((transaction) =>
    transaction.query<{ unchanged: boolean }>(
      `select validated_at = $6::timestamptz as unchanged from activity_snapshots
      where resource_id = $1 and subject_lifecycle_id = $2 and organization_version = $3
        and authorization_generation = $4 and activity_id = $5`,
      [resourceId, lifecycleId, 7, 4, activityId, originalValidatedAt],
    ),
  )
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
  const rows = await persistence.transaction((transaction) =>
    transaction.query<{ id: string }>(
      `select activity_id::text as id from activity_snapshots
      where resource_id = $1 and subject_lifecycle_id = $2 and organization_version = $3
        and authorization_generation = $4 order by activity_id`,
      [resourceId, lifecycleId, 7, 4],
    ),
  )
  expect(rows.map(({ id }) => id).toSorted()).toEqual(
    [activeCampaignId, inactiveCampaignId, activeObjectiveId].toSorted(),
  )
})

test('a failed materialization rolls back snapshots and checkpoint together', async () => {
  const data = observation('rollback-test')
  await expect(
    materializeActivityResource({
      data,
      subject: { lifecycleId },
      authorizationGeneration: 4,
      validatedAt: new Date().toISOString(),
      capabilities: {
        persistence: {
          transaction: (operation: Parameters<typeof persistence.transaction>[0]) =>
            persistence.transaction(async (tx) => {
              await operation(tx)
              throw new Error('rollback')
            }),
        },
      },
    } as never),
  ).rejects.toThrow('rollback')
  expect((await read('rollback-test')).snapshots).toEqual([])
  const checkpoint = await readActivityCheckpoint('rollback-test', {
    capabilities: { persistence },
    subject: { lifecycleId },
    organizationVersion: 7,
    authorizationGeneration: 4,
  } as never)
  expect(checkpoint).toBeUndefined()
})
