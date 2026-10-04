import { randomUUID } from 'node:crypto'
import { marketHistoryResource, marketGraphQL } from '@eve-space/market-server'
import type { PlatformGraphQLReadInput } from '@eve-space/platform-module-contract/graphql'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'
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
let readInvoke: ReturnType<typeof createStandaloneModulePersistenceOperationInvoker>
let firstCursor: string
let invoke: ReturnType<typeof createStandaloneModulePersistenceOperationInvoker>
const profileId = randomUUID()
const universeId = randomUUID()
const observationId = randomUUID()
const password = randomUUID()
const revision = { buildNumber: 3552227, ingestVersion: 6, ingestedAt: '2026-10-04T00:00:00Z' }
const fence = { profileId, profileRevision: 1, policyRevision: 1 }
const operations = installedModulePersistenceOperations.filter(
  ({ moduleId }) => moduleId === 'market',
)
const persistence = () => ({
  ...installedModulePersistenceCapabilityFactories.routes['market/profiles'](invoke),
  ...installedModulePersistenceCapabilityFactories.resourceProjections['market/daily-history'](
    invoke,
  ),
  ...installedModulePersistenceCapabilityFactories.resourceMaterializations['market/daily-history'](
    invoke,
  ),
})

const readers = () => ({
  ...installedModulePersistenceCapabilityFactories.graphqlReads[
    'market/public-market/intelligence'
  ](readInvoke),
  ...installedModulePersistenceCapabilityFactories.graphqlReads[
    'market/public-market/intelligence-item'
  ](readInvoke),
  ...installedModulePersistenceCapabilityFactories.graphqlReads[
    'market/public-market/intelligence-coverage'
  ](readInvoke),
  ...installedModulePersistenceCapabilityFactories.graphqlReads[
    'market/public-market/intelligence-history-range'
  ](readInvoke),
})

type Readers = ReturnType<typeof readers>
type Generation = NonNullable<
  Awaited<ReturnType<Readers['readMarketIntelligenceGeneration']>>
>['generation']
type Page = NonNullable<Awaited<ReturnType<Readers['readMarketIntelligencePage']>>>
const executeRead = async <Result>(
  field: string,
  readPersistence: Readers,
  args: PlatformGraphQLReadInput['args'],
  signal = new AbortController().signal,
): Promise<Result> => {
  // SAFETY: The real installed adapter and persistence factories produce the DTO under test; these assertions describe only the consumed result contract.
  return (await marketGraphQL.reads[field]!({
    parent: {},
    args,
    capabilities: {
      persistence: readPersistence,
      coreData: {},
      signal,
      cache: { noStore: () => {}, publicUntil: () => {} },
    },
    subject: null,
  })) as Result
}
const readMarketIntelligence = (
  readPersistence: Readers,
  input: PlatformGraphQLReadInput['args'],
  signal: AbortSignal,
) =>
  executeRead<{
    generation: Generation
    total: number
    rows: Page['rows'][number]['row'][]
    nextCursor: string | null
  }>('MarketRead.intelligence', readPersistence, { input }, signal)
const readMarketIntelligenceItem = (
  readPersistence: Readers,
  args: PlatformGraphQLReadInput['args'],
  signal: AbortSignal,
) =>
  executeRead<
    NonNullable<Awaited<ReturnType<Readers['readMarketIntelligenceItem']>>> & {
      generation: Generation | null
    }
  >('MarketRead.intelligenceItem', readPersistence, args, signal)
const readMarketIntelligenceCoverage = (
  readPersistence: Readers,
  args: PlatformGraphQLReadInput['args'],
) =>
  executeRead<NonNullable<Awaited<ReturnType<Readers['readMarketIntelligenceCoverage']>>>>(
    'MarketRead.intelligenceCoverage',
    readPersistence,
    args,
  )
const readMarketIntelligenceHistoryRange = (
  readPersistence: Readers,
  args: PlatformGraphQLReadInput['args'],
) =>
  executeRead<NonNullable<Awaited<ReturnType<Readers['readMarketIntelligenceHistoryRange']>>>>(
    'MarketRead.historyRange',
    readPersistence,
    args,
  )

const pageInput = {
  profileId,
  sort: 'sellDepth',
  minimumAverageDailyValueIsk: '0',
  minimumAverageDailyOrders: '0',
}
const readSignal = () => new AbortController().signal

beforeAll(async () => {
  container = await new GenericContainer('postgres:17-alpine')
    .withEnvironment({ POSTGRES_PASSWORD: password })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start()
  connection = postgres(
    `postgres://postgres:${password}@${container.getHost()}:${container.getMappedPort(5432)}/postgres`,
    { onnotice: () => {} },
  )
  await runMigrations(connection)
  const sets = await loadInstalledModuleMigrationSets(
    installedModuleMigrations.filter(({ moduleId }) => moduleId === 'market'),
    undefined,
    ['market'],
    operations,
  )
  await runModuleMigrationSets(connection, sets)
  invoke = createStandaloneModulePersistenceOperationInvoker(connection, 'market', operations)
  readInvoke = createStandaloneModulePersistenceOperationInvoker(connection, 'market', operations, {
    readOnly: true,
  })
  const store = persistence()
  await store.saveMarketProfile({
    profileId,
    regionId: 10000002,
    mode: 'region',
    stationIds: [60003760],
    watchedTypeIds: [],
    enabled: true,
    expectedRevision: 0,
    requestId: randomUUID(),
  })
  await store.saveMarketIntelligencePolicy({
    profileId,
    profileRevision: 1,
    expectedPolicyRevision: 0,
    enabled: true,
    ignoredGroupIds: [],
    catalogueRevision: revision,
    requestId: randomUUID(),
  })
  await store.beginMarketIntelligenceUniverse({
    ...fence,
    universeId,
    catalogueRevision: revision,
    targetCount: 205,
    excludedTypeCount: 2,
    excludedGroupIds: [5],
  })
  await store.stageMarketIntelligenceTargets({
    ...fence,
    universeId,
    targets: Array.from({ length: 205 }, (_, index) => ({
      typeId: 1000 + index,
      groupId: 3,
      name: `Type ${1000 + index}`,
      groupIds: [1, 3],
    })),
  })
  await store.stageMarketIntelligenceExclusions({
    ...fence,
    universeId,
    targets: [10000, 10001].map((typeId) => ({
      typeId,
      groupId: 5,
      name: 'Ignored',
      groupIds: [5],
    })),
  })
  await store.activateMarketIntelligenceUniverse({ ...fence, universeId })
  await connection`insert into eve_module_market.market_observations(observation_id,profile_id,profile_revision,market_key,region_id,expected_pages,status,started_at,observed_at,earliest_validated_at,latest_validated_at,fresh_until,published_at,order_count)
    values(${observationId},${profileId},1,${profileId + ':all'},10000002,1,'complete',now()-interval '1 minute',now()-interval '1 minute',now()-interval '1 minute',now()-interval '1 minute',now()+interval '1 hour',now(),7)`
  await connection`insert into eve_module_market.market_current_observations(market_key,observation_id,observed_at) values(${profileId + ':all'},${observationId},now()-interval '1 minute')`
  await connection`insert into eve_module_market.market_observation_orders(observation_id,order_id,type_id,location_id,system_id,side,price,volume_remain,issued_at,duration_days,minimum_volume,order_range)
    select ${observationId},row.id,1000,row.location,null,row.side,row.price,row.quantity,now()-row.age*interval '1 day',1,1,'region'
    from (values(1::bigint,60003760::bigint,'buy',8::numeric,10::bigint,0),(2,60003760,'sell',10,10,0),(3,60003760,'sell',10.5,20,0),(4,60003760,'sell',11,30,0),(5,60003760,'sell',11.01,40,0),(6,60000001,'sell',1,999999,0),(7,60003760,'sell',0,999999,2)) as row(id,location,side,price,quantity,age)`
})
afterAll(async () => {
  await connection?.end()
  await container?.stop()
})

const history = (averageIsk = '20.00') => {
  const now = Date.now()
  return {
    profileId,
    expectedRevision: 1,
    regionId: 10000002,
    typeId: 1000,
    policyRevision: 1,
    universeId,
    attemptId: randomUUID(),
    attemptedAt: new Date(now).toISOString(),
    validatedAt: new Date(now).toISOString(),
    freshUntil: new Date(now + 86400000).toISOString(),
    days: [
      {
        date: new Date(now - 86400000).toISOString().slice(0, 10),
        averageIsk,
        highIsk: averageIsk,
        lowIsk: averageIsk,
        volume: 30,
        orderCount: 8,
      },
      {
        date: new Date(now - 2 * 86400000).toISOString().slice(0, 10),
        averageIsk: '10.00',
        highIsk: '10.00',
        lowIsk: '10.00',
        volume: 10,
        orderCount: 4,
      },
    ],
  }
}
const begin = async () => {
  const store = persistence()
  await store.selectMarketIntelligenceWork({
    profileId,
    profileRevision: 1,
    reconciliationDue: false,
    historyDue: false,
  })
  const generationId = randomUUID()
  expect(
    await store.beginMarketIntelligenceGeneration({
      ...fence,
      universeId,
      generationId,
      cursorSecret: randomUUID(),
      catalogueRevision: null,
      watchedTargets: [],
      ignoredTypeIds: [],
      excludedTypeCount: 0,
      excludedGroupIds: [],
    }),
  ).toEqual({ outcome: 'started' })
  return generationId
}
const derive = async (
  targetProfileId = profileId,
  marketCatalogue = vi.fn(),
  expectedOutcome = 'completed',
) => {
  const store = persistence()
  const gateway = vi.fn().mockRejectedValue(new Error('Derivation must not execute ESI'))
  const result = await marketHistoryResource.execute({
    profileId: targetProfileId,
    expectedRevision: 1,
    subject: { kind: 'deployment', deploymentId: 1, lifecycleId: randomUUID() },
    signal: new AbortController().signal,
    assertCurrent: async () => true,
    classifyFailure: () => ({ failureClass: 'unknown', retryAt: null }),
    requestBudget: 0,
    operations: { 'market-region-history': gateway },
    capabilities: {
      coreData: { marketCatalogue },
      persistence: {
        ...store,
        selectMarketIntelligenceWork: async () => ({ kind: 'derivation' as const }),
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    },
  })
  expect(result).toBe(expectedOutcome)
  expect(gateway).not.toHaveBeenCalled()
}

test('freezes complete bounded inputs, aggregates station book depth once, and atomically publishes paged no-ESI derivation despite newer sources', async () => {
  const store = persistence()
  await store.convergeMarketHistory(history())
  const generationId = await begin()
  const input = await store.readMarketIntelligenceInputPage({ profileId, profileRevision: 1 })
  expect(input?.rows).toHaveLength(100)
  expect(
    await store.beginMarketIntelligenceGeneration({
      ...fence,
      profileRevision: 99,
      universeId,
      generationId: randomUUID(),
      cursorSecret: randomUUID(),
      catalogueRevision: null,
      watchedTargets: [],
      ignoredTypeIds: [],
      excludedTypeCount: 0,
      excludedGroupIds: [],
    }),
  ).toEqual({ outcome: 'deferred' })
  expect(
    (await store.readMarketIntelligenceInputPage({ profileId, profileRevision: 1 }))?.generationId,
  ).toBe(generationId)
  expect(input?.rows[0]).toMatchObject({
    typeId: 1000,
    groupIds: [1, 3],
    metricsInput: {
      anchor: { averageIsk: '20.00', volume: '30' },
      book: {
        bestAskIsk: '10.00',
        bestBidIsk: '8.00',
        sellDepth: '100',
        sellDepth5Percent: '30',
        sellDepth10Percent: '60',
      },
    },
    bookSource: { observationId },
  })
  expect(input?.rows[1]).toMatchObject({
    metricsInput: {
      sourceState: 'uncollected',
      book: { sellDepth: '0', bestAskIsk: null, sellDepth5Percent: null },
    },
  })
  expect(
    await store.publishMarketIntelligenceGeneration({
      profileId,
      profileRevision: 1,
      generationId,
    }),
  ).toEqual({ outcome: 'obsolete' })
  await store.convergeMarketHistory(history('21.00'))
  expect(
    (await store.readMarketIntelligenceInputPage({ profileId, profileRevision: 1 }))?.rows[0]
      ?.metricsInput.anchor?.averageIsk,
  ).toBe('20.00')
  expect(
    await store.listDueMarketIntelligenceDerivations({ now: new Date().toISOString() }),
  ).toMatchObject([{ profileId }])
  await derive()
  const [generation] =
    await connection`select * from eve_module_market.market_intelligence_generations where generation_id=${generationId}`
  expect(generation).toMatchObject({
    status: 'complete',
    staged_count: 205,
    target_count: 205,
    book_scope: 'stations',
    history_scope: 'region',
    catalogue_revision: revision,
  })
  const [output] =
    await connection`select metrics,book_source,history_source from eve_module_market.market_intelligence_outputs where generation_id=${generationId} and type_id=1000`
  expect(output?.metrics).toMatchObject({
    baselineWeekIsk: { value: '17.500000', observedDays: 2, complete: false },
    anchorTradedValueIsk: { value: '600.000000' },
    daysSupply: { value: '5.000000' },
    daysSupply10Percent: { value: '3.000000' },
  })
  expect(Date.parse(output!.history_source.validatedAt)).toBeGreaterThan(
    Date.parse(output!.book_source.validatedAt),
  )
  const read = readers()
  expect((await readMarketIntelligence(read, { profileId }, readSignal())).total).toBe(0)
  const page = await readMarketIntelligence(
    read,
    { ...pageInput, first: 2, groupIds: ['1'] },
    readSignal(),
  )
  expect(page).toMatchObject({
    total: 205,
    omittedNullSortCount: 0,
    rows: [{ typeId: 1000 }, { typeId: 1001 }],
  })
  firstCursor = (await readMarketIntelligence(read, { ...pageInput, first: 2 }, readSignal()))
    .nextCursor!
  expect(
    (
      await readMarketIntelligence(
        read,
        { ...pageInput, first: 2, after: firstCursor },
        readSignal(),
      )
    ).rows.map(({ typeId }) => typeId),
  ).toEqual([1002, 1003])
  expect(
    (await readMarketIntelligence(read, { ...pageInput, groupIds: ['5'] }, readSignal())).total,
  ).toBe(0)
  expect(
    (await readMarketIntelligenceItem(read, { profileId, typeId: '10000' }, readSignal())).status,
  ).toBe('ignored')
  expect(
    (await readMarketIntelligenceItem(read, { profileId, typeId: '99999' }, readSignal())).status,
  ).toBe('unavailable')
  expect(
    await readMarketIntelligence(
      read,
      {
        profileId,
        minimumAverageDailyValueIsk: '0',
        minimumAverageDailyOrders: '0',
        includeStale: true,
      },
      readSignal(),
    ),
  ).toMatchObject({ total: 1, omittedNullSortCount: 204 })
  const dates = history()
    .days.map(({ date }) => date)
    .toSorted((left, right) => left.localeCompare(right))
  const range = await readMarketIntelligenceHistoryRange(read, {
    profileId,
    typeId: '1000',
    from: dates[0],
    through: dates[1],
  })
  expect(range.days).toMatchObject([
    { volume: '10', averageIsk: '10.00' },
    { volume: '30', averageIsk: '21.00' },
  ])
  const stamp = new Date(Date.now() + 5).toISOString()
  const retry = new Date(Date.now() + 3600000).toISOString()
  for (const typeId of [1000, 1002])
    expect(
      await store.recordMarketHistoryItemFailure({
        profileId,
        expectedRevision: 1,
        regionId: 10000002,
        typeId,
        policyRevision: 1,
        universeId,
        attemptId: randomUUID(),
        attemptedAt: stamp,
        retryAt: retry,
        failureClass: 'esi-unavailable',
      }),
    ).toEqual({ outcome: 'recorded' })
  await store.convergeMarketHistory({ ...history(), typeId: 1003, days: [] })
  await store.convergeMarketHistory({
    ...history(),
    typeId: 1004,
    attemptedAt: new Date(Date.now() - 7200000).toISOString(),
    validatedAt: new Date(Date.now() - 7200000).toISOString(),
    freshUntil: new Date(Date.now() - 3600000).toISOString(),
  })
  const coverage = await readMarketIntelligenceCoverage(read, { profileId })
  expect(coverage).toMatchObject({
    excludedTypeCount: 2,
    live: {
      eligibleCount: 205,
      neverAttempted: 201,
      freshSuccess: 2,
      staleSuccess: 1,
      failedWithoutSuccess: 1,
      emptySource: 1,
      failedLastAttempt: 2,
    },
    generation: {
      counts: {
        eligibleCount: 205,
        neverAttempted: 204,
        freshSuccess: 1,
        staleSuccess: 0,
        failedWithoutSuccess: 0,
        emptySource: 0,
        failedLastAttempt: 0,
      },
    },
  })
  expect(coverage.live.oldestDueAt).not.toBeNull()
  const [control] =
    await connection`select dirty_revision,published_revision,current_generation_id from eve_module_market.market_intelligence_controls where profile_id=${profileId}`
  expect(control?.current_generation_id).toBe(generationId)
  expect(BigInt(control!.dirty_revision)).toBeGreaterThan(BigInt(control!.published_revision))
  expect(
    await store.listDueMarketIntelligenceDerivations({ now: new Date().toISOString() }),
  ).toEqual([])
  expect(
    await store.listDueMarketIntelligenceDerivations({
      now: new Date(Date.now() + 301000).toISOString(),
    }),
  ).toMatchObject([{ profileId }])
})

test('retains current and one expiring prior generation, reconstructs dirty work, alternates work kinds, and fences policy changes', async () => {
  const store = persistence()
  await connection`update eve_module_market.market_intelligence_controls set last_started_at=now()-interval '6 minutes' where profile_id=${profileId}`
  const kinds = []
  for (let index = 0; index < 3; index++)
    kinds.push(
      (
        await store.selectMarketIntelligenceWork({
          profileId,
          profileRevision: 1,
          historyDue: true,
          reconciliationDue: true,
        })
      ).kind,
    )
  expect(kinds).toEqual(['reconciliation', 'history', 'derivation'])
  await connection`update eve_module_market.market_intelligence_controls set last_started_at=now()-interval '6 minutes' where profile_id=${profileId}`
  const [before] =
    await connection`select current_generation_id from eve_module_market.market_intelligence_controls where profile_id=${profileId}`
  await connection`delete from eve_module_market.market_current_observations where observation_id=${observationId}`
  const replacement = await begin()
  expect(
    (await store.readMarketIntelligenceInputPage({ profileId, profileRevision: 1 }))?.rows[0]
      ?.metricsInput.book,
  ).toBeNull()
  const [during] =
    await connection`select current_generation_id from eve_module_market.market_intelligence_controls where profile_id=${profileId}`
  expect(during?.current_generation_id).toBe(before?.current_generation_id)
  await derive()
  const [after] =
    await connection`select current_generation_id,prior_generation_id from eve_module_market.market_intelligence_controls where profile_id=${profileId}`
  expect(after).toMatchObject({
    current_generation_id: replacement,
    prior_generation_id: before?.current_generation_id,
  })
  expect(
    (
      await readMarketIntelligence(
        readers(),
        { ...pageInput, first: 2, after: firstCursor },
        readSignal(),
      )
    ).generation.generationId,
  ).toBe(before!.current_generation_id)
  await connection`update eve_module_market.market_intelligence_controls set last_started_at=now()-interval '6 minutes' where profile_id=${profileId}`
  const third = await begin()
  await derive()
  expect(
    await connection`select generation_id from eve_module_market.market_intelligence_generations where profile_id=${profileId} and status='complete'`,
  ).toHaveLength(2)
  expect(
    await connection`select generation_id from eve_module_market.market_intelligence_generations where generation_id=${before!.current_generation_id}`,
  ).toHaveLength(0)
  await expect(
    readMarketIntelligence(readers(), { ...pageInput, after: firstCursor }, readSignal()),
  ).rejects.toMatchObject({ code: 'MARKET_INTELLIGENCE_RESTART_REQUIRED' })
  const [prior] =
    await connection`select expires_at,published_at from eve_module_market.market_intelligence_generations where generation_id=${replacement}`
  expect(prior!.expires_at.getTime() - Date.now()).toBeGreaterThan(86390000)
  await connection`update eve_module_market.market_intelligence_generations set expires_at=now()-interval '1 second' where generation_id=${replacement}`
  expect(
    await store.cleanupMarketIntelligenceGenerations({ now: new Date().toISOString() }),
  ).toEqual({ removed: 1 })
  expect(
    await connection`select generation_id from eve_module_market.market_intelligence_generations where generation_id=${third}`,
  ).toHaveLength(1)
  await connection`update eve_module_market.market_intelligence_controls set last_started_at=now()-interval '6 minutes' where profile_id=${profileId}`
  const stage = await begin()
  await store.saveMarketIntelligencePolicy({
    profileId,
    profileRevision: 1,
    expectedPolicyRevision: 1,
    enabled: false,
    ignoredGroupIds: [],
    catalogueRevision: revision,
    requestId: randomUUID(),
  })
  expect(await store.readMarketIntelligenceInputPage({ profileId, profileRevision: 1 })).toBeNull()
  expect(
    await store.publishMarketIntelligenceGeneration({
      profileId,
      profileRevision: 1,
      generationId: stage,
    }),
  ).toEqual({ outcome: 'obsolete' })
  await connection`update eve_module_market.market_intelligence_generations set created_at=now()-interval '25 hours' where generation_id=${stage}`
  expect(
    await store.cleanupMarketIntelligenceGenerations({ now: new Date().toISOString() }),
  ).toEqual({ removed: 1 })
})

test.each([false, true])(
  'freezes retry deadlines and reads older generations with due target present: %s',
  async (includeDue) => {
    const store = persistence()
    const targetProfileId = randomUUID()
    const targetIds = includeDue ? [5000, 5001, 5002] : [5000, 5001]
    await store.saveMarketProfile({
      profileId: targetProfileId,
      regionId: 10000043,
      mode: 'watched-types',
      stationIds: [],
      watchedTypeIds: targetIds,
      enabled: true,
      expectedRevision: 0,
      requestId: randomUUID(),
    })
    await store.selectMarketIntelligenceWork({
      profileId: targetProfileId,
      profileRevision: 1,
      reconciliationDue: false,
      historyDue: false,
    })
    await store.recordMarketIntelligenceCatalogue({
      profileId: targetProfileId,
      profileRevision: 1,
      catalogueRevision: revision,
    })
    const now = Date.now()
    const future = new Date(now + 3_600_000).toISOString()
    const due = new Date(now - 30_000).toISOString()
    await connection`update eve_module_market.market_profiles set updated_at=now()-interval '2 hours' where profile_id=${targetProfileId}`
    await store.convergeMarketHistory({
      ...history(),
      profileId: targetProfileId,
      regionId: 10000043,
      typeId: 5001,
      policyRevision: null,
      universeId: null,
      attemptedAt: new Date(now - 7_200_000).toISOString(),
      validatedAt: new Date(now - 7_200_000).toISOString(),
      freshUntil: new Date(now - 3_600_000).toISOString(),
    })
    for (const typeId of targetIds) {
      expect(
        await store.recordMarketHistoryItemFailure({
          profileId: targetProfileId,
          expectedRevision: 1,
          regionId: 10000043,
          typeId,
          policyRevision: null,
          universeId: null,
          attemptId: randomUUID(),
          attemptedAt: new Date(now - 60_000).toISOString(),
          retryAt: typeId === 5002 ? due : future,
          failureClass: 'esi-unavailable',
        }),
      ).toEqual({ outcome: 'recorded' })
    }
    const input = {
      profileId: targetProfileId,
      profileRevision: 1,
      policyRevision: 0,
      universeId: null,
      generationId: randomUUID(),
      cursorSecret: randomUUID(),
      catalogueRevision: revision,
      ignoredTypeIds: [],
      excludedTypeCount: 0,
      excludedGroupIds: [],
      watchedTargets: targetIds.map((typeId) => ({
        typeId,
        groupId: 1,
        groupIds: [1],
        name: String(typeId),
      })),
    }
    expect(await store.beginMarketIntelligenceGeneration(input)).toEqual({ outcome: 'started' })
    const deadlines =
      await connection`select type_id,effective_due_at from eve_module_market.market_intelligence_inputs where generation_id=${input.generationId} order by type_id`
    expect(deadlines.map((row) => row.effective_due_at.toISOString())).toEqual(
      includeDue ? [future, future, due] : [future, future],
    )
    const live = (await readers().readMarketIntelligenceCoverage({ profileId: targetProfileId }))!
      .live
    const expectedDueAt = includeDue ? Date.parse(due) : null
    expect(live.oldestDueAt === null ? null : Date.parse(live.oldestDueAt)).toBe(expectedDueAt)
    await connection`update eve_module_market.market_history_collection_state set next_due_at=now()+interval '2 hours' where profile_id=${targetProfileId}`
    await connection`update eve_module_market.market_history_sources set fresh_until=now()+interval '2 hours' where region_id=10000043 and type_id=5001`
    await derive(
      targetProfileId,
      vi.fn(async () => ({ kind: 'revision', revision })),
    )
    const coverage = await readers().readMarketIntelligenceCoverage({ profileId: targetProfileId })
    expect(coverage).toMatchObject({
      live: { oldestDueAt: null },
      generation: {
        counts: {
          staleSuccess: 1,
          failedWithoutSuccess: includeDue ? 2 : 1,
        },
      },
    })
    const frozenDueAt = coverage!.generation!.counts.oldestDueAt
    expect(frozenDueAt === null ? null : Date.parse(frozenDueAt)).toBe(expectedDueAt)
    await connection`update eve_module_market.market_intelligence_controls set last_started_at=now()-interval '6 minutes' where profile_id=${targetProfileId}`
    const legacyInput = { ...input, generationId: randomUUID(), cursorSecret: randomUUID() }
    const [legacy] =
      await connection`select eve_module_market.persist_begin_market_intelligence_generation(${connection.json(legacyInput)}) as result`
    expect(legacy?.result).toEqual({ outcome: 'started' })
    await derive(
      targetProfileId,
      vi.fn(async () => ({ kind: 'revision', revision })),
    )
    const historical = await readers().readMarketIntelligenceCoverage({
      profileId: targetProfileId,
    })
    expect(historical?.generation?.counts.oldestDueAt).toBeNull()
    expect(
      (
        await readers().readMarketIntelligenceGeneration({
          profileId: targetProfileId,
          generationId: input.generationId,
        })
      )?.generation.generationId,
    ).toBe(input.generationId)
    await connection`delete from eve_module_market.market_history_collection_state where profile_id=${targetProfileId}`
    await connection`delete from eve_module_market.market_profiles where profile_id=${targetProfileId}`
    await connection`delete from eve_module_market.market_history_sources where region_id=10000043 and type_id in ${connection(targetIds)}`
    await connection`delete from eve_module_market.market_daily_history where region_id=10000043 and type_id in ${connection(targetIds)}`
  },
)

test('watched and Global PLEX reports preserve scope, exclusions and uncollected rows and detect catalogue-only changes', async () => {
  const store = persistence()
  const watchedId = randomUUID()
  const defaultWatchedId = randomUUID()
  const plexId = randomUUID()
  for (const targetId of [watchedId, defaultWatchedId]) {
    await store.saveMarketProfile({
      profileId: targetId,
      regionId: 10000058,
      mode: 'watched-types',
      stationIds: [],
      watchedTypeIds: [2000, 2001],
      enabled: true,
      expectedRevision: 0,
      requestId: randomUUID(),
    })
  }
  await store.saveMarketIntelligencePolicy({
    profileId: watchedId,
    profileRevision: 1,
    expectedPolicyRevision: 0,
    enabled: false,
    ignoredGroupIds: [614],
    catalogueRevision: revision,
    requestId: randomUUID(),
  })
  await store.saveMarketProfile({
    profileId: plexId,
    regionId: 19000001,
    mode: 'watched-types',
    stationIds: [],
    watchedTypeIds: [44992],
    enabled: true,
    expectedRevision: 0,
    requestId: randomUUID(),
  })
  let catalogueRevision = revision
  const groups = [
    1, 150, 1954, 3630, 204, 209, 1041, 1338, 2157, 2158, 1663, 20, 22, 23, 2801, 1846, 492, 614,
    751, 754, 1109, 2480, 1396,
  ].map((id) => ({
    id,
    parentId: id === 751 ? 614 : null,
    name: String(id),
    iconId: null,
    directTypeCount: 0,
  }))
  const types = [
    { id: 2000, groupId: 1, name: 'Watched' },
    { id: 2001, groupId: 751, name: 'Ignored descendant' },
    { id: 44992, groupId: 1, name: 'PLEX' },
  ]
  const catalogue = vi.fn(async ({ kind }: { kind: string }) => {
    if (kind === 'revision') return { kind, revision: catalogueRevision }
    if (kind === 'tree') return { kind, revision: catalogueRevision, complete: true, groups }
    return { kind, revision: catalogueRevision, complete: true, types }
  })
  for (const targetId of [watchedId, defaultWatchedId, plexId]) {
    await store.selectMarketIntelligenceWork({
      profileId: targetId,
      profileRevision: 1,
      reconciliationDue: false,
      historyDue: false,
    })
    await derive(targetId, catalogue)
  }
  expect(
    (
      await readMarketIntelligenceItem(
        readers(),
        { profileId: watchedId, typeId: '2001' },
        readSignal(),
      )
    ).status,
  ).toBe('ignored')
  expect(
    (
      await readMarketIntelligenceItem(
        readers(),
        { profileId: watchedId, typeId: '2000' },
        readSignal(),
      )
    ).status,
  ).toBe('uncollected')
  const effectiveDefaultPolicy = await store.readMarketIntelligencePolicy({
    profileId: defaultWatchedId,
  })
  expect(effectiveDefaultPolicy!.ignoredGroupIds).toHaveLength(22)
  expect(
    await readMarketIntelligenceCoverage(readers(), { profileId: defaultWatchedId }),
  ).toMatchObject({
    policyEnabled: false,
    policyRevision: '0',
    ignoredGroupIds: effectiveDefaultPolicy!.ignoredGroupIds,
    excludedTypeCount: 1,
    live: { eligibleCount: 1, neverAttempted: 1 },
    generation: { counts: { eligibleCount: 1, neverAttempted: 1 } },
  })
  expect(await readMarketIntelligenceCoverage(readers(), { profileId: watchedId })).toMatchObject({
    ignoredGroupIds: [614],
    excludedTypeCount: 1,
    live: { eligibleCount: 1, neverAttempted: 1 },
    generation: { counts: { eligibleCount: 1, neverAttempted: 1 } },
  })
  expect(
    (
      await readMarketIntelligenceItem(
        readers(),
        { profileId: plexId, typeId: '44992' },
        readSignal(),
      )
    ).generation,
  ).toMatchObject({ bookScope: 'global-plex', historyScope: 'global-plex', targetCount: 1 })
  expect(
    (
      await readMarketIntelligenceItem(
        readers(),
        { profileId: plexId, typeId: '2000' },
        readSignal(),
      )
    ).status,
  ).toBe('unavailable')
  expect(
    await readers().readMarketIntelligenceHistoryRange({
      profileId: plexId,
      typeId: 2000,
      from: history().days[0]!.date,
      through: history().days[0]!.date,
    }),
  ).toBeNull()
  const original = (await readers().readMarketIntelligenceGeneration({
    profileId: watchedId,
    generationId: null,
  }))!.generation
  catalogueRevision = { ...revision, ingestVersion: 7 }
  await connection`update eve_module_market.market_intelligence_controls set catalogue_checked_at=now()-interval '61 seconds' where profile_id=${watchedId}`
  expect(
    await store.listDueMarketIntelligenceDerivations({ now: new Date().toISOString() }),
  ).toEqual(expect.arrayContaining([expect.objectContaining({ profileId: watchedId })]))
  await derive(watchedId, catalogue, 'obsolete')
  expect(
    await readers().readMarketIntelligenceGeneration({
      profileId: watchedId,
      generationId: original.generationId,
    }),
  ).toBeNull()
  const [control] =
    await connection`select current_generation_id,staging_generation_id,dirty_revision,published_revision from eve_module_market.market_intelligence_controls where profile_id=${watchedId}`
  expect(control).toMatchObject({
    current_generation_id: original.generationId,
    staging_generation_id: null,
  })
  expect(BigInt(control!.dirty_revision)).toBeGreaterThan(BigInt(control!.published_revision))
  await connection`update eve_module_market.market_intelligence_controls set last_started_at=now()-interval '6 minutes' where profile_id=${watchedId}`
  await derive(watchedId, catalogue)
  expect(
    (await readers().readMarketIntelligenceGeneration({ profileId: watchedId, generationId: null }))
      ?.generation.catalogueRevision.ingestVersion,
  ).toBe(7)
})
