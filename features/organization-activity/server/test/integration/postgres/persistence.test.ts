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
import { collectActivityResource } from '../../../src/collection.js'
import { createCorporationContinuationAuthorityBinding } from '../../../../../../api/src/platform/resource-eligibility.js'
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
const modulePersistenceOperations = installedModulePersistenceOperations.filter(
  (operation) => operation.moduleId === moduleId,
)
const migrationNames = ['organization-activity-001-baseline.sql'] as const
const lifecycleId = randomUUID()
const activityId = randomUUID()
const snapshot = summarySnapshot(
  { id: activityId, name: 'Supplies', progress: { current: 1, desired: 10 }, state: 'Active' },
  'job',
  9801,
)

beforeAll(async () => {
  const password = randomUUID()
  container = await new GenericContainer('postgres:17-alpine')
    .withEnvironment({
      POSTGRES_DB: 'eve_space',
      POSTGRES_PASSWORD: password,
      POSTGRES_USER: 'eve_space',
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
    migrations,
    moduleId,
    persistenceOperations: modulePersistenceOperations,
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
    checkpoint: { cursors: { root: { after: 'opaque' } }, initialized: true, requests: [] },
    expectedRevision: revision,
    organizationVersion: 7,
    resourceId,
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
        authorizationGeneration: generation,
        capabilities: { persistence: materializationFactory(scoped.invoke) },
        data,
        subject: { characterId: 9001, kind: 'character', lifecycleId },
        validatedAt: new Date().toISOString(),
      } as never)
      await afterOperation?.()
      const suppressedFailure = scoped.suppressedFailure()
      if (suppressedFailure) {
        throw suppressedFailure.error
      }
      return result
    } finally {
      scoped.close()
    }
  })
}
function read(resourceId: string, version = 7, generation = 4, lifecycle = lifecycleId) {
  const collectionStatus = {
    read: vi.fn().mockResolvedValue({
      authorizationGeneration: generation,
      lastFailureClass: null,
      status: 'current',
      subjectLifecycleId: lifecycle,
      validatedAt: new Date().toISOString(),
    }),
  }
  return readActivitySnapshots(
    { collectionStatus, persistence: snapshotPersistence },
    version,
    resourceId,
    { characterId: 9001, kind: 'character' },
    activityId,
  )
}

function readCheckpoint(resourceId: string, generation = 4) {
  return readActivityCheckpoint(resourceId, {
    authorizationGeneration: generation,
    capabilities: { persistence: checkpointPersistence },
    organizationVersion: 7,
    subject: { lifecycleId },
  } as never)
}

const corporationSubject = { corporationId: 9801, kind: 'corporation' as const, lifecycleId }

const writeCorporationObservation = (
  data: ActivityObservation,
  authorityBinding: string,
  authorizationGeneration = 4,
) =>
  connection.begin(async (transaction) => {
    const scoped = createTransactionScopedModulePersistenceOperationInvoker(
      transaction,
      moduleId,
      installedModulePersistenceOperations,
    )
    try {
      // SAFETY: the fixture supplies the exact declared materialization capability and corporation subject.
      const result = await materializeActivityResource({
        authorizationGeneration,
        capabilities: { persistence: materializationFactory(scoped.invoke) },
        continuationAuthorityBinding: authorityBinding,
        data,
        subject: corporationSubject,
        validatedAt: new Date().toISOString(),
      } as never)
      const suppressed = scoped.suppressedFailure()
      if (suppressed) throw suppressed.error
      return result
    } finally {
      scoped.close()
    }
  })

const readCorporationCheckpoint = (
  resourceId: string,
  authorityBinding: string,
  authorizationGeneration = 4,
) =>
  // SAFETY: the fixture supplies the exact declared checkpoint read capability and corporation subject.
  readActivityCheckpoint(resourceId, {
    authorizationGeneration,
    capabilities: { persistence: checkpointPersistence },
    continuationAuthorityBinding: authorityBinding,
    organizationVersion: 7,
    subject: corporationSubject,
  } as never)

const corporationCollectionContext = (
  authorityBinding: string,
  execute: ReturnType<typeof vi.fn>,
  authorizationGeneration = 4,
) =>
  // SAFETY: the typed collector receives its declared operation methods through this fixture proxy.
  ({
    authorizationGeneration,
    capabilities: { persistence: checkpointPersistence },
    continuationAuthorityBinding: authorityBinding,
    corporationId: 9801,
    operations: new Proxy({}, { get: () => () => execute() }),
    organizationVersion: 7,
    requestBudget: 32,
    subject: corporationSubject,
  }) as never

test('migration is idempotent and the runtime role has only generated routine access', async () => {
  const rows =
    await connection`select name from public.schema_migrations where module = ${moduleId} order by name`
  expect([...rows]).toStrictEqual(migrationNames.map((name) => ({ name })))
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
  expect(privileges).toStrictEqual({
    canExecuteRead: true,
    canExecuteWrite: true,
    canReadCore: false,
    canReadModuleTables: false,
  })
  expect(Object.keys(checkpointPersistence)).toStrictEqual(['readActivityCheckpoint'])
  expect(Object.keys(snapshotPersistence)).toStrictEqual(['readActivitySnapshots'])
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
    expect((await read(resourceId)).snapshots).toStrictEqual([snapshot])
    expect((await read(resourceId, 8)).snapshots).toStrictEqual([])
    expect((await read(resourceId, 7, 5)).snapshots).toStrictEqual([])
    expect((await read(resourceId, 7, 4, randomUUID())).snapshots).toStrictEqual([])
    const checkpoint = await readCheckpoint(resourceId)
    expect(checkpoint.expectedRevision).toBe(1)
    expect(checkpoint.checkpoint?.cursors.root).toStrictEqual({ after: 'opaque' })
  },
)

test('before pages retain existing data, after pages replace it, and obsolete writers do nothing', async () => {
  const resourceId = 'duplicate-test'
  await write(observation(resourceId))
  const before = observation(resourceId, 1)
  const replacement = { ...snapshot, title: 'New title' }
  await write({
    ...before,
    snapshots: [{ replace: false, snapshot: replacement, validatedAt: new Date().toISOString() }],
  })
  expect((await read(resourceId)).snapshots[0]?.title).toBe('Supplies')
  expect(await write(before)).toStrictEqual({ outcome: 'obsolete' })
  await write({
    ...observation(resourceId, 2),
    snapshots: [{ replace: true, snapshot: replacement, validatedAt: new Date().toISOString() }],
  })
  expect((await read(resourceId)).snapshots[0]?.title).toBe('New title')
  expect((await readCheckpoint(resourceId)).expectedRevision).toBe(3)
})

test('corporation continuation resets a positive revision and isolates overlapping fresh snapshots', async () => {
  const resourceId = 'corporation-reset-test'
  const oldBinding = `v1:${'b'.repeat(64)}`
  const newBinding = `v1:${'a'.repeat(64)}`
  await writeCorporationObservation(
    {
      ...observation(resourceId),
      checkpoint: {
        authorityBinding: oldBinding,
        cursors: { root: { after: 'old-cursor' } },
        initialized: true,
        requests: [],
      },
    },
    oldBinding,
  )
  const mismatched = await readCorporationCheckpoint(resourceId, newBinding)
  expect(mismatched).toMatchObject({ checkpoint: null, expectedRevision: 1, needsReset: true })
  const execute = vi.fn().mockResolvedValue({
    data: {
      freelance_jobs: [
        {
          id: activityId,
          name: 'Fresh authority',
          progress: { current: 2, desired: 10 },
          state: 'Active',
        },
      ],
    },
    validatedAt: new Date().toISOString(),
  })
  const context = corporationCollectionContext(newBinding, execute)
  const profile = { id: resourceId, paginated: false, rootOperation: 'corporation-jobs' as const }
  const reset = await collectActivityResource(profile, context)
  expect(reset).toMatchObject({
    complete: false,
    data: {
      expectedRevision: 1,
      checkpoint: {
        authorityBinding: newBinding,
        initialized: false,
        requests: [],
        retainedIds: [],
        retainedCampaignIds: [],
      },
      snapshots: [],
    },
  })
  expect(execute).not.toHaveBeenCalled()
  expect(await writeCorporationObservation(reset.data, newBinding)).toBeUndefined()
  expect(await writeCorporationObservation(reset.data, newBinding)).toStrictEqual({
    outcome: 'obsolete',
  })
  expect((await readCorporationCheckpoint(resourceId, newBinding)).expectedRevision).toBe(2)
  const afterReset = await connection<{ count: number }[]>`
    select count(*)::integer as count from eve_module_organization_activity.activity_snapshots
    where resource_id = ${resourceId} and subject_lifecycle_id = ${lifecycleId}
  `
  expect(afterReset[0]?.count).toBe(0)

  const fresh = await collectActivityResource(profile, context)
  expect(fresh.complete).toBe(true)
  expect(fresh.data.expectedRevision).toBe(2)
  expect(fresh.data.checkpoint).not.toHaveProperty('retainedIds')
  expect(fresh.data.checkpoint).not.toHaveProperty('retainedCampaignIds')
  expect(execute).toHaveBeenCalledOnce()
  expect(await writeCorporationObservation(fresh.data, newBinding)).toBeUndefined()
  const [current] = await connection<{ title: string }[]>`
    select snapshot ->> 'title' as title from eve_module_organization_activity.activity_snapshots
    where resource_id = ${resourceId} and subject_lifecycle_id = ${lifecycleId}
      and activity_id = ${activityId}
  `
  expect(current?.title).toBe('Fresh authority')
  expect((await readCorporationCheckpoint(resourceId, newBinding)).expectedRevision).toBe(3)
})

const initialFence = {
  sourceId: randomUUID(),
  organizationVersion: 7,
  corporationLifecycleId: lifecycleId,
  corporationId: 9801,
  characterId: 9001,
  characterLifecycleId: randomUUID(),
  affiliationPeriodRevision: randomUUID(),
  authorizationGeneration: 4,
  requirementsFingerprint: 'reviewed-scopes-v1',
  roleRevision: randomUUID(),
}

test.each([
  ['source', { sourceId: randomUUID() }],
  ['scope', { requirementsFingerprint: 'reviewed-scopes-v2' }],
  ['affiliation', { affiliationPeriodRevision: randomUUID() }],
  ['role', { roleRevision: randomUUID() }],
] as const)(
  'restarts positive-revision continuation after %s authority changes',
  async (reason, changed) => {
    const resourceId = `corporation-restart-${reason}`
    const oldBinding = createCorporationContinuationAuthorityBinding(initialFence)
    const newBinding = createCorporationContinuationAuthorityBinding({
      ...initialFence,
      ...changed,
    })
    await writeCorporationObservation(
      {
        ...observation(resourceId),
        checkpoint: { authorityBinding: oldBinding, cursors: {}, initialized: true, requests: [] },
      },
      oldBinding,
    )
    const stored = await readCorporationCheckpoint(resourceId, newBinding)
    expect(stored).toMatchObject({ checkpoint: null, expectedRevision: 1, needsReset: true })
    const execute = vi.fn()
    const profile = { id: resourceId, paginated: false, rootOperation: 'corporation-jobs' as const }
    const reset = await collectActivityResource(
      profile,
      corporationCollectionContext(newBinding, execute),
    )
    expect(reset).toMatchObject({ complete: false, data: { expectedRevision: 1, snapshots: [] } })
    expect(execute).not.toHaveBeenCalled()
    expect(await writeCorporationObservation(reset.data, newBinding)).toBeUndefined()
    expect((await readCorporationCheckpoint(resourceId, newBinding)).expectedRevision).toBe(2)
    const [retained] = await connection<{ count: number }[]>`
    select count(*)::integer as count from eve_module_organization_activity.activity_snapshots
    where resource_id = ${resourceId} and subject_lifecycle_id = ${lifecycleId}
      and authorization_generation = 4
  `
    expect(retained?.count).toBe(0)
  },
)

test('token-generation replacement starts a separate authority-bound checkpoint', async () => {
  const resourceId = 'corporation-token-restart'
  const oldBinding = createCorporationContinuationAuthorityBinding(initialFence)
  const nextFence = { ...initialFence, authorizationGeneration: 5 }
  const newBinding = createCorporationContinuationAuthorityBinding(nextFence)
  await writeCorporationObservation(
    {
      ...observation(resourceId),
      checkpoint: { authorityBinding: oldBinding, cursors: {}, initialized: true, requests: [] },
    },
    oldBinding,
  )
  expect(await readCorporationCheckpoint(resourceId, newBinding, 5)).toMatchObject({
    checkpoint: null,
    expectedRevision: 0,
    needsReset: false,
  })
  const execute = vi.fn().mockResolvedValue({
    data: {
      freelance_jobs: [
        {
          id: activityId,
          name: 'New generation',
          progress: { current: 3, desired: 10 },
          state: 'Active',
        },
      ],
    },
    validatedAt: new Date().toISOString(),
  })
  const collected = await collectActivityResource(
    { id: resourceId, paginated: false, rootOperation: 'corporation-jobs' },
    corporationCollectionContext(newBinding, execute, 5),
  )
  expect(collected.complete).toBe(true)
  expect(collected.data.expectedRevision).toBe(0)
  expect(await writeCorporationObservation(collected.data, newBinding, 5)).toBeUndefined()
  const snapshots = await connection<{ generation: number; title: string }[]>`
    select authorization_generation as generation, snapshot ->> 'title' as title
    from eve_module_organization_activity.activity_snapshots
    where resource_id = ${resourceId} and subject_lifecycle_id = ${lifecycleId}
    order by authorization_generation
  `
  expect([...snapshots]).toStrictEqual([
    { generation: 4, title: 'Supplies' },
    { generation: 5, title: 'New generation' },
  ])
})

test('complete membership lists prune absent entries only in their own identity', async () => {
  const resourceId = 'pruning-test'
  await write(observation(resourceId))
  await write(observation(resourceId), 5)
  await write({
    ...observation(resourceId, 1),
    checkpoint: { cursors: {}, initialized: true, requests: [], retainedIds: [] },
    snapshots: [],
  })
  expect((await read(resourceId)).snapshots).toStrictEqual([])
  expect((await read(resourceId, 7, 5)).snapshots).toStrictEqual([snapshot])
})

test('incremental completion does not renew untouched snapshots', async () => {
  const resourceId = 'incremental-renewal-test'
  const originalValidatedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  await write({
    ...observation(resourceId),
    checkpoint: {
      cursors: { root: { after: 'opaque' } },
      initialized: true,
      requests: [{ operation: 'job-detail', path: { job_id: activityId }, replace: true }],
    },
    snapshots: [{ replace: true, snapshot, validatedAt: originalValidatedAt }],
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
  expect([...rows]).toStrictEqual([{ unchanged: true }])
})

test('campaign retention prunes objectives whose campaigns are no longer active', async () => {
  const resourceId = 'campaign-retention-test'
  const activeCampaignId = randomUUID()
  const inactiveCampaignId = randomUUID()
  const activeObjectiveId = randomUUID()
  const inactiveObjectiveId = randomUUID()
  const activeCampaign = {
    ...snapshot,
    campaignId: null,
    id: activeCampaignId,
    kind: 'campaign',
  } satisfies ActivitySnapshot
  const inactiveCampaign = {
    ...activeCampaign,
    id: inactiveCampaignId,
  } satisfies ActivitySnapshot
  const activeObjective = {
    ...activeCampaign,
    campaignId: activeCampaignId,
    id: activeObjectiveId,
    kind: 'objective',
  } satisfies ActivitySnapshot
  const inactiveObjective = {
    ...activeObjective,
    campaignId: inactiveCampaignId,
    id: inactiveObjectiveId,
  } satisfies ActivitySnapshot
  await write({
    ...observation(resourceId),
    checkpoint: {
      cursors: {},
      initialized: true,
      requests: [],
      retainedCampaignIds: [activeCampaignId, inactiveCampaignId],
      retainedIds: [activeCampaignId, inactiveCampaignId],
    },
    snapshots: [activeCampaign, inactiveCampaign, activeObjective, inactiveObjective].map(
      (item) => ({ replace: true, snapshot: item, validatedAt: new Date().toISOString() }),
    ),
  })
  await write({
    ...observation(resourceId, 1),
    checkpoint: {
      cursors: {},
      initialized: true,
      requests: [],
      retainedCampaignIds: [activeCampaignId],
      retainedIds: [activeCampaignId, inactiveCampaignId],
    },
    snapshots: [
      { replace: true, snapshot: activeCampaign, validatedAt: new Date().toISOString() },
      {
        replace: true,
        snapshot: { ...inactiveCampaign, state: 'Completed' },
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
  expect(rows.map(({ id }) => id).toSorted()).toStrictEqual(
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
  expect((await read('rollback-test')).snapshots).toStrictEqual([])
  const checkpoint = await readCheckpoint('rollback-test')
  expect(checkpoint).toMatchObject({ checkpoint: null, expectedRevision: 0, needsReset: false })
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
