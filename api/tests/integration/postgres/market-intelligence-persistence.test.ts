import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { runMigrations } from '../../../src/db/migration-runner.js'
import {
  loadInstalledModuleMigrationSets,
  runModuleMigrationSets,
} from '../../../src/db/module-migration-runner.js'
import { createStandaloneModulePersistenceOperationInvoker } from '../../../src/db/module-persistence-operation-transaction.js'
import {
  installedModulePersistenceCapabilityFactories,
  installedModulePersistenceOperations,
} from '../../../src/generated/platform/installed-module-persistence.js'
import { installedModuleMigrations } from '../../../src/generated/platform/installed-module-migrations.js'

let container: StartedTestContainer
let connection: postgres.Sql
let invoke: ReturnType<typeof createStandaloneModulePersistenceOperationInvoker>
const password = randomUUID()
const revision = { buildNumber: 3552227, ingestVersion: 6, ingestedAt: '2026-10-04T00:00:00Z' }
const operations = installedModulePersistenceOperations.filter(
  (operation) => operation.moduleId === 'market',
)

beforeAll(async () => {
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
    { onnotice: () => {} },
  )
  await runMigrations(connection)
  const [set] = await loadInstalledModuleMigrationSets(
    installedModuleMigrations.filter((migration) => migration.moduleId === 'market'),
    undefined,
    ['market'],
    operations,
  )
  await runModuleMigrationSets(connection, [
    {
      ...set!,
      migrations: set!.migrations.slice(0, 3),
      persistenceOperations: set!.persistenceOperations!.filter((operation) =>
        set!.migrations.slice(0, 3).some((migration) => migration.name === operation.migration),
      ),
    },
  ])
  invoke = createStandaloneModulePersistenceOperationInvoker(connection, 'market', operations)
  const profiles = installedModulePersistenceCapabilityFactories.routes['market/profiles'](invoke)
  await profiles.saveMarketProfile({
    profileId: initialProfileId,
    regionId: 10000002,
    mode: 'region',
    stationIds: [],
    watchedTypeIds: [],
    enabled: true,
    expectedRevision: 0,
    requestId: randomUUID(),
  })
  await runModuleMigrationSets(connection, [set!])
})

afterAll(async () => {
  await connection?.end()
  await container?.stop()
})
const initialProfileId = randomUUID()
const capability = () => ({
  ...installedModulePersistenceCapabilityFactories.routes['market/profiles'](invoke),
  ...installedModulePersistenceCapabilityFactories.resourceProjections['market/daily-history'](
    invoke,
  ),
  ...installedModulePersistenceCapabilityFactories.resourceMaterializations['market/daily-history'](
    invoke,
  ),
})

test('upgrades current installations with disabled policy and atomically activates only complete revision-fenced universes', async () => {
  const persistence = capability()
  expect(await persistence.readMarketIntelligencePolicy({ profileId: initialProfileId })).toEqual({
    enabled: false,
    revision: 0,
    ignoredGroupIds: [
      150, 1954, 3630, 204, 209, 1041, 1338, 2157, 2158, 1663, 20, 22, 23, 2801, 1846, 492, 614,
      751, 754, 1109, 2480, 1396,
    ],
    catalogueRevision: null,
  })
  const policy = {
    profileId: initialProfileId,
    profileRevision: 1,
    expectedPolicyRevision: 0,
    enabled: true,
    ignoredGroupIds: [614],
    catalogueRevision: revision,
    requestId: randomUUID(),
  }
  expect(await persistence.saveMarketIntelligencePolicy(policy)).toEqual({
    outcome: 'saved',
    revision: 1,
  })
  expect(await persistence.saveMarketIntelligencePolicy(policy)).toEqual({
    outcome: 'saved',
    revision: 1,
  })
  expect(
    await persistence.saveMarketIntelligencePolicy({ ...policy, requestId: randomUUID() }),
  ).toEqual({ outcome: 'obsolete' })
  const fence = { profileId: initialProfileId, profileRevision: 1, policyRevision: 1 }
  const generation = {
    ...fence,
    universeId: randomUUID(),
    catalogueRevision: revision,
    targetCount: 2,
    excludedTypeCount: 1,
    excludedGroupIds: [614],
  }
  expect(await persistence.beginMarketIntelligenceUniverse(generation)).toEqual({
    outcome: 'started',
  })
  expect(
    await persistence.activateMarketIntelligenceUniverse({
      ...fence,
      universeId: generation.universeId,
    }),
  ).toEqual({
    outcome: 'incomplete',
  })
  expect((await persistence.readMarketIntelligenceUniverse(fence))?.active).toBeNull()
  const first = { typeId: 34, groupId: 1, name: 'Tritanium', groupIds: [1] }
  expect(
    await persistence.stageMarketIntelligenceTargets({
      ...fence,
      universeId: generation.universeId,
      targets: [first],
    }),
  ).toEqual({ outcome: 'staged' })
  expect(
    await persistence.stageMarketIntelligenceTargets({
      ...fence,
      universeId: generation.universeId,
      targets: [first],
    }),
  ).toEqual({ outcome: 'staged' })
  expect(
    await persistence.stageMarketIntelligenceTargets({
      ...fence,
      universeId: generation.universeId,
      targets: [{ ...first, name: 'Changed' }],
    }),
  ).toEqual({ outcome: 'inconsistent' })
  expect((await persistence.readMarketIntelligenceUniverse(fence))?.staging?.stagedCount).toBe(1)
  expect(
    await persistence.stageMarketIntelligenceTargets({
      ...fence,
      universeId: generation.universeId,
      targets: [{ ...first, typeId: 35 }],
    }),
  ).toEqual({ outcome: 'staged' })
  expect(
    await persistence.stageMarketIntelligenceExclusions({
      ...fence,
      universeId: generation.universeId,
      targets: [{ typeId: 36, groupId: 614, name: 'Ignored', groupIds: [614] }],
    }),
  ).toEqual({ outcome: 'staged' })
  expect(
    await persistence.activateMarketIntelligenceUniverse({
      ...fence,
      universeId: generation.universeId,
    }),
  ).toEqual({
    outcome: 'activated',
  })
  expect((await persistence.readMarketIntelligenceUniverse(fence))?.active).toMatchObject({
    universeId: generation.universeId,
    stagedCount: 2,
    status: 'complete',
  })
  const replacement = { ...generation, universeId: randomUUID(), targetCount: 1 }
  expect(await persistence.beginMarketIntelligenceUniverse(replacement)).toEqual({
    outcome: 'started',
  })
  expect((await persistence.readMarketIntelligenceUniverse(fence))?.active?.universeId).toBe(
    generation.universeId,
  )
  expect(
    await persistence.saveMarketIntelligencePolicy({
      ...policy,
      expectedPolicyRevision: 1,
      enabled: false,
      requestId: randomUUID(),
    }),
  ).toEqual({ outcome: 'saved', revision: 2 })
  expect(
    await persistence.stageMarketIntelligenceTargets({
      ...fence,
      universeId: replacement.universeId,
      targets: [first],
    }),
  ).toEqual({ outcome: 'obsolete' })
  expect(
    await persistence.activateMarketIntelligenceUniverse({
      ...fence,
      universeId: replacement.universeId,
    }),
  ).toEqual({
    outcome: 'obsolete',
  })
  expect(await persistence.readMarketIntelligenceUniverse(fence)).toBeNull()
})

test('canonical history converges broad and explicit targets without rewriting identical daily values', async () => {
  const persistence = capability()
  const policy = {
    profileId: initialProfileId,
    profileRevision: 1,
    expectedPolicyRevision: 2,
    enabled: true,
    ignoredGroupIds: [],
    catalogueRevision: revision,
    requestId: randomUUID(),
  }
  expect(await persistence.saveMarketIntelligencePolicy(policy)).toEqual({
    outcome: 'saved',
    revision: 3,
  })
  const fence = { profileId: initialProfileId, profileRevision: 1, policyRevision: 3 }
  const universeId = randomUUID()
  expect(
    await persistence.beginMarketIntelligenceUniverse({
      ...fence,
      universeId,
      catalogueRevision: revision,
      targetCount: 2,
      excludedTypeCount: 0,
      excludedGroupIds: [],
    }),
  ).toEqual({ outcome: 'started' })
  expect(
    await persistence.stageMarketIntelligenceTargets({
      ...fence,
      universeId,
      targets: [34, 35].map((typeId) => ({
        typeId,
        groupId: 1,
        name: `Type ${typeId}`,
        groupIds: [1],
      })),
    }),
  ).toEqual({ outcome: 'staged' })
  expect(await persistence.activateMarketIntelligenceUniverse({ ...fence, universeId })).toEqual({
    outcome: 'activated',
  })
  const date = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  const validation = Date.now() - 60_000
  const input = {
    profileId: initialProfileId,
    expectedRevision: 1,
    regionId: 10000002,
    typeId: 34,
    policyRevision: 3,
    universeId,
    attemptId: randomUUID(),
    attemptedAt: new Date(validation).toISOString(),
    validatedAt: new Date(validation).toISOString(),
    freshUntil: new Date(validation + 86_400_000).toISOString(),
    days: [
      { date, averageIsk: '10.00', highIsk: '12.00', lowIsk: '8.00', volume: 10, orderCount: 2 },
    ],
  }
  expect(await persistence.convergeMarketHistory(input)).toEqual({
    outcome: 'applied',
    changedRows: 1,
  })
  const [before] =
    await connection`select xmin::text as version, validated_at from eve_module_market.market_daily_history where region_id=10000002 and type_id=34 and day=${date}`
  expect(await persistence.convergeMarketHistory(input)).toEqual({
    outcome: 'applied',
    changedRows: 0,
  })
  const fresh = {
    ...input,
    attemptId: randomUUID(),
    validatedAt: new Date(validation + 1000).toISOString(),
    attemptedAt: new Date(validation + 1000).toISOString(),
  }
  expect(await persistence.convergeMarketHistory(fresh)).toEqual({
    outcome: 'applied',
    changedRows: 0,
  })
  const [unchanged] =
    await connection`select xmin::text as version, validated_at from eve_module_market.market_daily_history where region_id=10000002 and type_id=34 and day=${date}`
  expect(unchanged).toEqual(before)
  const correction = {
    ...fresh,
    attemptId: randomUUID(),
    validatedAt: new Date(validation + 2000).toISOString(),
    days: [{ ...input.days[0]!, averageIsk: '11.00' }],
  }
  expect(await persistence.convergeMarketHistory(correction)).toEqual({
    outcome: 'applied',
    changedRows: 1,
  })
  expect(await persistence.convergeMarketHistory({ ...input, attemptId: randomUUID() })).toEqual({
    outcome: 'superseded',
    changedRows: 0,
  })
  const explicitProfile = randomUUID()
  expect(
    await persistence.saveMarketProfile({
      profileId: explicitProfile,
      expectedRevision: 0,
      regionId: 10000002,
      mode: 'watched-types',
      watchedTypeIds: [34],
      stationIds: [],
      enabled: true,
      requestId: randomUUID(),
    }),
  ).toEqual({ outcome: 'saved', revision: 1 })
  const empty = {
    ...correction,
    profileId: explicitProfile,
    policyRevision: null,
    universeId: null,
    attemptId: randomUUID(),
    validatedAt: new Date(validation + 3000).toISOString(),
    days: [],
  }
  expect(await persistence.convergeMarketHistory(empty)).toEqual({
    outcome: 'applied',
    changedRows: 0,
  })
  expect(
    await persistence.readMarketHistorySource({ profileId: initialProfileId, typeId: 34 }),
  ).toMatchObject({
    status: 'observed',
    retainedEvidence: true,
    source: { state: 'empty', responseCount: 0, contentRevision: '2' },
    days: [{ date, averageIsk: '11.00' }],
  })
  expect(
    await persistence.readMarketHistorySource({ profileId: initialProfileId, typeId: 35 }),
  ).toMatchObject({ status: 'uncollected', source: null, retainedEvidence: false, days: [] })
  expect(
    await persistence.convergeMarketHistory({ ...empty, typeId: 35, attemptId: randomUUID() }),
  ).toEqual({ outcome: 'obsolete', changedRows: 0 })
  expect(
    await persistence.readMarketHistorySource({ profileId: explicitProfile, typeId: 35 }),
  ).toBeNull()
  const laterFailure = {
    profileId: explicitProfile,
    expectedRevision: 1,
    regionId: 10000002,
    typeId: 34,
    policyRevision: null,
    universeId: null,
    attemptId: randomUUID(),
    attemptedAt: new Date(validation + 6000).toISOString(),
    retryAt: new Date(validation + 120000).toISOString(),
    failureClass: 'esi-unavailable' as const,
  }
  expect(await persistence.recordMarketHistoryItemFailure(laterFailure)).toEqual({
    outcome: 'recorded',
  })
  expect(
    await persistence.convergeMarketHistory({
      ...empty,
      attemptId: randomUUID(),
      attemptedAt: new Date(validation + 4000).toISOString(),
      validatedAt: new Date(validation + 7000).toISOString(),
    }),
  ).toEqual({ outcome: 'applied', changedRows: 0 })
  const delayed = await persistence.readMarketHistorySource({
    profileId: explicitProfile,
    typeId: 34,
  })
  expect(Date.parse(delayed!.source!.validatedAt)).toBe(validation + 7000)
  expect(Date.parse(delayed!.source!.lastAttemptAt)).toBe(Date.parse(laterFailure.attemptedAt))
  expect(delayed!.source!.lastFailureClass).toBe('esi-unavailable')
  expect(
    await persistence.recordMarketHistoryItemFailure({
      ...laterFailure,
      attemptId: randomUUID(),
      attemptedAt: new Date(validation + 5000).toISOString(),
    }),
  ).toEqual({ outcome: 'obsolete' })
  expect(
    await persistence.saveMarketIntelligencePolicy({
      ...policy,
      expectedPolicyRevision: 3,
      enabled: false,
      requestId: randomUUID(),
    }),
  ).toEqual({ outcome: 'saved', revision: 4 })
  expect(
    await persistence.convergeMarketHistory({
      ...correction,
      attemptId: randomUUID(),
      validatedAt: new Date(validation + 4000).toISOString(),
    }),
  ).toEqual({ outcome: 'obsolete', changedRows: 0 })
  const demands =
    await connection`select count(*)::integer as count from eve_module_market.market_history_demands`
  expect(demands[0]!.count).toBe(0)
})

test('history retention is bounded to 365 completed UTC dates and does not touch books', async () => {
  const persistence = capability()
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const oldest = new Date(now.getTime() - 365 * 86_400_000).toISOString().slice(0, 10)
  const expired = new Date(now.getTime() - 366 * 86_400_000).toISOString().slice(0, 10)
  for (const day of [today, oldest, expired])
    await connection`insert into eve_module_market.market_daily_history(region_id,type_id,day,average,highest,lowest,volume,order_count,validated_at) values(10000002,35,${day},1,1,1,1,1,now())`
  const [before] =
    await connection`select count(*)::integer as count from eve_module_market.market_observations`
  expect(
    await persistence.cleanupMarketHistoryRetention({ now: now.toISOString(), limit: 1 }),
  ).toEqual({ deletedRows: 1, pending: true })
  expect(
    await persistence.cleanupMarketHistoryRetention({ now: now.toISOString(), limit: 10 }),
  ).toEqual({ deletedRows: 1, pending: false })
  const retained =
    await connection`select day::text from eve_module_market.market_daily_history where region_id=10000002 and type_id=35`
  expect(retained).toEqual([{ day: oldest }])
  const [after] =
    await connection`select count(*)::integer as count from eve_module_market.market_observations`
  expect(after).toEqual(before)
})

test('drains broad and demanded targets in bounded due batches and isolates failed item retries', async () => {
  const persistence = capability()
  expect(
    await persistence.saveMarketIntelligencePolicy({
      profileId: initialProfileId,
      profileRevision: 1,
      expectedPolicyRevision: 4,
      enabled: true,
      ignoredGroupIds: [],
      catalogueRevision: revision,
      requestId: randomUUID(),
    }),
  ).toEqual({ outcome: 'saved', revision: 5 })
  const fence = { profileId: initialProfileId, profileRevision: 1, policyRevision: 5 }
  const universeId = randomUUID()
  await persistence.beginMarketIntelligenceUniverse({
    ...fence,
    universeId,
    catalogueRevision: revision,
    targetCount: 40,
    excludedTypeCount: 0,
    excludedGroupIds: [],
  })
  await persistence.stageMarketIntelligenceTargets({
    ...fence,
    universeId,
    targets: Array.from({ length: 40 }, (_, index) => ({
      typeId: 1000 + index,
      groupId: 1,
      name: `Synthetic ${index}`,
      groupIds: [1],
    })),
  })
  await persistence.activateMarketIntelligenceUniverse({ ...fence, universeId })
  const demand =
    installedModulePersistenceCapabilityFactories.routes['market/daily-history-demand'](invoke)
  await demand.requestMarketHistoryDemand({
    profileId: initialProfileId,
    expectedRevision: 1,
    typeId: 1039,
    requestId: randomUUID(),
  })
  await demand.requestMarketHistoryDemand({
    profileId: initialProfileId,
    expectedRevision: 1,
    typeId: 1040,
    requestId: randomUUID(),
  })
  const now = new Date().toISOString()
  const identity = { profileId: initialProfileId, expectedRevision: 1, now }
  const first = await persistence.listDueMarketHistoryTargets(identity)
  expect(first.map(({ typeId }) => typeId)).toEqual(
    Array.from({ length: 16 }, (_, index) => 1000 + index),
  )
  const failure = {
    profileId: initialProfileId,
    expectedRevision: 1,
    regionId: 10000002,
    typeId: 1000,
    policyRevision: 5,
    universeId,
    attemptId: randomUUID(),
    attemptedAt: now,
    retryAt: new Date(Date.now() + 300000).toISOString(),
    failureClass: 'esi-unavailable' as const,
  }
  expect(await persistence.recordMarketHistoryItemFailure(failure)).toEqual({ outcome: 'recorded' })
  for (const target of first.slice(1))
    expect(
      await persistence.convergeMarketHistory({
        profileId: initialProfileId,
        expectedRevision: 1,
        regionId: target.regionId,
        typeId: target.typeId,
        policyRevision: target.policyRevision,
        universeId: target.universeId,
        attemptId: randomUUID(),
        attemptedAt: now,
        validatedAt: now,
        freshUntil: new Date(Date.now() + 86400000).toISOString(),
        days: [],
      }),
    ).toEqual({ outcome: 'applied', changedRows: 0 })
  const second = await persistence.listDueMarketHistoryTargets(identity)
  expect(second.map(({ typeId }) => typeId)).toEqual(
    Array.from({ length: 16 }, (_, index) => 1016 + index),
  )
  const requested = await persistence.listDueMarketHistoryTargets({ ...identity, typeId: 1039 })
  expect(requested).toMatchObject([{ typeId: 1039, policyRevision: null, universeId: null }])
  expect(await persistence.listDueMarketHistoryTargets({ ...identity, typeId: 1000 })).toEqual([])
  expect(
    await persistence.listDueMarketHistoryTargets({
      ...identity,
      typeId: 1000,
      now: failure.retryAt,
    }),
  ).toMatchObject([{ typeId: 1000 }])
  expect(
    await persistence.listDueMarketHistoryTargets({ ...identity, expectedRevision: 2 }),
  ).toEqual([])
  expect(
    (await persistence.listDueMarketHistoryCollectionProfiles({ now })).some(
      ({ profileId }) => profileId === initialProfileId,
    ),
  ).toBe(true)
})
