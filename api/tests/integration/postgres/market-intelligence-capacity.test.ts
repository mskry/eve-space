import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { marketGraphQL, marketHistoryResource } from '@eve-space/market-server'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import {
  graphql,
  parse,
  validate,
  buildSchema,
  isObjectType,
  type GraphQLFieldResolver,
} from 'graphql'
import { graphqlCoreTypeDefs } from '@eve-space/platform-module-conformance/graphql'
import type { PlatformGraphQLReadInput } from '@eve-space/platform-module-contract/graphql'
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
import { installedGraphQLContributions } from '../../../src/generated/platform/installed-module-graphql.js'
import { applicationScalars } from '../../../src/graphql/scalars.js'
import { analyzeGraphQLSelection } from '../../../src/graphql/execution-policy.js'

const enabled = process.env.MARKET_INTELLIGENCE_CAPACITY === '1'
const regionProfileId = randomUUID()
const plexProfileId = randomUUID()
const observationId = randomUUID()
const password = randomUUID()
const targetCount = 10646
const revision = { buildNumber: 3552227, ingestVersion: 6, ingestedAt: '2026-10-04T00:00:00Z' }
const groups = [
  1, 3, 4, 150, 1954, 3630, 204, 209, 1041, 1338, 2157, 2158, 1663, 20, 22, 23, 2801, 1846, 492,
  614, 751, 754, 1109, 2480, 1396,
].map((id) => ({
  id,
  parentId: [3, 4].includes(id) ? 1 : null,
  name: String(id),
  iconId: null,
  directTypeCount: 0,
}))
const types = [
  ...Array.from({ length: targetCount }, (_, index) => ({
    id: 10000 + index,
    groupId: index % 2 === 0 ? 3 : 4,
    name: `Synthetic ${index}`,
  })),
  { id: 44992, groupId: 1, name: 'PLEX' },
]
const catalogue = async ({ kind }: { kind: string }) => {
  if (kind === 'revision') return { kind: 'revision' as const, revision }
  if (kind === 'tree') return { kind: 'tree' as const, revision, complete: true as const, groups }
  return { kind: 'search-index' as const, revision, complete: true as const, types }
}
let container: StartedTestContainer
let connection: postgres.Sql
let invoke: ReturnType<typeof createStandaloneModulePersistenceOperationInvoker>
let readInvoke: ReturnType<typeof createStandaloneModulePersistenceOperationInvoker>
const operations = installedModulePersistenceOperations.filter(
  ({ moduleId }) => moduleId === 'market',
)
const store = () => ({
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
})
const capabilities = () => ({
  persistence: store(),
  coreData: { marketCatalogue: catalogue },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
})
const dailyRows = (typeId: number) =>
  Array.from({ length: 365 }, (_, index) => ({
    date: new Date(Date.now() - (index + 1) * 86400000).toISOString().slice(0, 10),
    average: 1000 + (typeId % 100) + (index % 7) / 100,
    highest: 2000,
    lowest: 500,
    volume: index === 0 ? 20000000 : 10000000,
    order_count: 10 + (typeId % 10),
  }))
const reconnect = () => {
  invoke = createStandaloneModulePersistenceOperationInvoker(connection, 'market', operations)
  readInvoke = createStandaloneModulePersistenceOperationInvoker(connection, 'market', operations, {
    readOnly: true,
  })
}

beforeAll(async () => {
  if (!enabled) return
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
  reconnect()
  // Verify the extracted-body measurement context before the expensive collection sweep.
  await connection.begin(async (transaction) => {
    await transaction`set transaction read only`
    await transaction`set local role eve_module_market_migrate`
    await transaction`set local search_path to pg_catalog, eve_module_market`
    await transaction`select generation_id from market_intelligence_readable_generations limit 0`
    const [parameter] =
      await transaction`select jsonb_typeof(${transaction.json({ profileId: regionProfileId })}::jsonb) as kind`
    if (parameter!.kind !== 'object') throw new Error('Capacity input must bind as a JSON object')
  })
  await store().saveMarketProfile({
    profileId: regionProfileId,
    regionId: 10000002,
    mode: 'region',
    stationIds: [],
    watchedTypeIds: [],
    enabled: true,
    expectedRevision: 0,
    requestId: randomUUID(),
  })
  await store().saveMarketIntelligencePolicy({
    profileId: regionProfileId,
    profileRevision: 1,
    expectedPolicyRevision: 0,
    enabled: true,
    ignoredGroupIds: [],
    catalogueRevision: revision,
    requestId: randomUUID(),
  })
  await store().saveMarketProfile({
    profileId: plexProfileId,
    regionId: 19000001,
    mode: 'watched-types',
    stationIds: [],
    watchedTypeIds: [44992],
    enabled: true,
    expectedRevision: 0,
    requestId: randomUUID(),
  })
  await connection`insert into eve_module_market.market_observations(observation_id,profile_id,profile_revision,market_key,region_id,expected_pages,status,started_at,observed_at,earliest_validated_at,latest_validated_at,fresh_until,published_at,order_count)
    values(${observationId},${regionProfileId},1,${regionProfileId + ':all'},10000002,1,'complete',now(),now(),now(),now(),now()+interval '24 hours',now(),${targetCount})`
  await connection`insert into eve_module_market.market_current_observations(market_key,observation_id,observed_at) values(${regionProfileId + ':all'},${observationId},now())`
  await connection`insert into eve_module_market.market_observation_orders(observation_id,order_id,type_id,location_id,system_id,side,price,volume_remain,issued_at,duration_days,minimum_volume,order_range)
    select ${observationId},type,type,60003760,null,'sell',(1000+type%100)::numeric/2,10000000,now(),90,1,'region' from generate_series(10000,${10000 + targetCount - 1}) as type`
}, 60000)
afterAll(async () => {
  await connection?.end()
  await container?.stop()
})

const panelSchema = () => {
  const contribution = installedGraphQLContributions.find(({ moduleId }) => moduleId === 'market')!
  const persistence = readers()
  const resolvers = Object.fromEntries(
    Object.entries(marketGraphQL.reads).reduce<
      [string, Record<string, GraphQLFieldResolver<unknown, unknown>>][]
    >((result, [field, read]) => {
      const [owner, name] = field.split('.')
      let entry = result.find(([key]) => key === owner)
      if (!entry) {
        entry = [owner!, {}]
        result.push(entry)
      }
      entry[1][name!] = (
        parent: PlatformGraphQLReadInput['parent'],
        args: PlatformGraphQLReadInput['args'],
      ) =>
        read({
          parent,
          args,
          capabilities: {
            persistence,
            coreData: {},
            signal: new AbortController().signal,
            cache: { noStore: () => {}, publicUntil: () => {} },
          },
          subject: null,
        })
      return result
    }, []),
  )
  const schema = buildSchema(graphqlCoreTypeDefs + marketGraphQL.typeDefs)
  for (const [name, scalar] of Object.entries(applicationScalars))
    Object.assign(schema.getType(name)!, {
      serialize: scalar.serialize,
      parseValue: scalar.parseValue,
      parseLiteral: scalar.parseLiteral,
    })
  for (const [owner, fields] of Object.entries(resolvers)) {
    const type = schema.getType(owner)
    if (!isObjectType(type)) throw new Error('Invalid capacity resolver owner')
    for (const [name, resolve] of Object.entries(fields)) type.getFields()[name]!.resolve = resolve
  }
  const policies = contribution.reads.map((read) => ({
    field: read.field,
    protected: false,
    cost: read.cost,
    sourceCost: read.sourceCost,
    list: read.list ? { ...read.list, argument: read.list.argument ?? '' } : undefined,
  }))
  const source = `{market {
    price:intelligence(input:{profileId:"${regionProfileId}",groupIds:["1"],sort:underpriceMonthPercent,direction:ASC}) {total nextCursor rows {typeId metrics {underpriceMonthPercent {value}}}}
    supply:intelligence(input:{profileId:"${regionProfileId}",groupIds:["3"],sort:daysSupply10Percent,direction:ASC}) {total rows {typeId metrics {daysSupply10Percent {value}}}}
    volume:intelligence(input:{profileId:"${regionProfileId}",sort:anchorVolumeSpike}) {total rows {typeId metrics {anchorVolumeSpike {value}}}}
  }}`
  return { schema, source, policies }
}

const measurePanels = async () => {
  const { schema, source, policies } = panelSchema()
  const persistence = readers()
  const admission = analyzeGraphQLSelection(schema, source, undefined, {}, policies)
  const start = performance.now()
  const result = await graphql({ schema, source })
  expect(result.errors).toBeUndefined()
  const elapsedMs = performance.now() - start
  const payloadBytes = Buffer.byteLength(JSON.stringify(result))
  const metadata = (await persistence.readMarketIntelligenceGeneration({
    profileId: regionProfileId,
    generationId: null,
  }))!
  const plans = []
  const [definition] =
    await connection`select pg_get_functiondef(p.oid) as definition from pg_proc as p join pg_namespace as n on n.oid=p.pronamespace where n.nspname='eve_module_market' and p.proname='persist_read_market_intelligence_page'`
  const functionBody = definition!.definition
  const body = functionBody
    .slice(
      functionBody.indexOf('BEGIN ATOMIC') + 'BEGIN ATOMIC'.length,
      functionBody.lastIndexOf('\nEND'),
    )
    .trim()
    .replace(/persist_read_market_intelligence_page\.input/g, 'input')
    .replace(/\binput\b/g, '($1::jsonb)')
  for (const [sort, direction, groupIds, needsBook] of [
    ['underpriceMonthPercent', 'ASC', [1], true],
    ['daysSupply10Percent', 'ASC', [3], true],
    ['anchorVolumeSpike', 'DESC', [], false],
  ] as const) {
    const input = {
      profileId: regionProfileId,
      generationId: metadata.generation.generationId,
      typeIds: [],
      groupIds,
      first: 25,
      minimumAverageDailyValueIsk: '5000000000',
      minimumAverageDailyOrders: '5',
      minimumBaselineDays: 0,
      includeStale: false,
      sort,
      direction,
      needsHistory: true,
      needsBook,
      lastKey: null,
      lastTypeId: null,
    }
    const plan = await connection.begin(async (transaction) => {
      await transaction`set transaction read only`
      await transaction`set local role eve_module_market_migrate`
      await transaction`set local search_path to pg_catalog, eve_module_market`
      return transaction.unsafe('explain (analyze,buffers,format json) ' + body, [
        transaction.json(input),
      ])
    })
    expect(JSON.stringify(plan[0]!['QUERY PLAN'])).toContain('market_intelligence_outputs')
    plans.push({ sort, plan: plan[0]!['QUERY PLAN'] })
  }
  return { elapsedMs, payloadBytes, admission, plans, source }
}

const sweep = async () => {
  const starts: number[] = []
  const collected = new Set<string>()
  let virtualNow = 0
  let passes = 0
  let maximumQueueOccupancy = 0
  let resumed = false
  const gateway = async ({
    path,
    query,
  }: {
    path: { region_id: number }
    query: { type_id: number }
  }) => {
    virtualNow = Math.max(virtualNow, (starts.at(-1) ?? -1000) + 1000)
    starts.push(virtualNow)
    const identity = path.region_id + ':' + query.type_id
    expect(collected.has(identity)).toBe(false)
    collected.add(identity)
    return {
      data: dailyRows(query.type_id),
      validatedAt: new Date().toISOString(),
      cachedUntil: new Date(Date.now() + 86400000).toISOString(),
      stale: false,
    }
  }
  for (let iteration = 0; iteration < 2200; iteration++) {
    const planned = await marketHistoryResource.plan({
      now: new Date().toISOString(),
      limit: 4,
      subject: { kind: 'deployment', deploymentId: 1, lifecycleId: randomUUID() },
      capabilities: capabilities(),
      signal: new AbortController().signal,
    })
    const outstanding =
      await connection`select count(*) as count from eve_module_market.market_history_sources`
    if (Number(outstanding[0]!.count) === targetCount + 1) break
    expect(planned.length).toBeGreaterThan(0)
    maximumQueueOccupancy = Math.max(maximumQueueOccupancy, planned.length)
    const passStart = virtualNow
    for (const job of planned)
      await marketHistoryResource.execute({
        profileId: job.profileId,
        expectedRevision: job.revision,
        subject: { kind: 'deployment', deploymentId: 1, lifecycleId: randomUUID() },
        signal: new AbortController().signal,
        assertCurrent: async () => true,
        classifyFailure: () => ({ failureClass: 'unknown', retryAt: null }),
        requestBudget: 16,
        capabilities: capabilities(),
        operations: { 'market-region-history': gateway },
      })
    virtualNow = Math.max(virtualNow, passStart + 30000)
    passes++
    if (!resumed && collected.size > targetCount / 2) {
      reconnect()
      resumed = true
    }
    if (passes % 100 === 0)
      process.stdout.write(
        `Capacity sweep ${collected.size}/${targetCount + 1} sources, ${passes} planner passes\n`,
      )
  }
  expect(collected.size).toBe(targetCount + 1)
  expect(resumed).toBe(true)
  expect(maximumQueueOccupancy).toBeLessThanOrEqual(4)
  expect(starts.slice(1).every((start, index) => start - starts[index]! >= 1000)).toBe(true)
  const conservativeFairDrainMs = Math.ceil(targetCount / 16) * 3 * 30000 + 30000
  expect(conservativeFairDrainMs).toBeLessThan(86400000)
  return {
    upstreamAttempts: starts.length,
    plannerPasses: passes,
    virtualDrainMs: virtualNow,
    conservativeFairDrainMs,
    maximumQueueOccupancy,
    resumed,
  }
}

const publishFinal = async () => {
  await connection`update eve_module_market.market_intelligence_controls set last_started_at=now()-interval '6 minutes' where profile_id=${regionProfileId}`
  for (let index = 0; index < 6; index++) {
    await marketHistoryResource.execute({
      profileId: regionProfileId,
      expectedRevision: 1,
      subject: { kind: 'deployment', deploymentId: 1, lifecycleId: randomUUID() },
      signal: new AbortController().signal,
      assertCurrent: async () => true,
      classifyFailure: () => ({ failureClass: 'unknown', retryAt: null }),
      requestBudget: 0,
      capabilities: capabilities(),
      operations: {
        'market-region-history': async () => {
          throw new Error('No ESI allowed during final derivation')
        },
      },
    })
    const report = await readers().readMarketIntelligenceGeneration({
      profileId: regionProfileId,
      generationId: null,
    })
    if (report) {
      const coverage = await readers().readMarketIntelligenceCoverage({
        profileId: regionProfileId,
      })
      if (coverage?.generation?.counts.freshSuccess === targetCount) return report.generation
    }
  }
  throw new Error('Complete capacity generation did not publish')
}

const convergenceProof = async () => {
  const row = dailyRows(10000)
  const days = row.map((day) => ({
    date: day.date,
    averageIsk: day.average.toFixed(2),
    highIsk: '2000.00',
    lowIsk: '500.00',
    volume: day.volume,
    orderCount: day.order_count,
  }))
  const policy = await store().readMarketIntelligencePolicy({ profileId: regionProfileId })
  const universe = await store().readMarketIntelligenceUniverse({
    profileId: regionProfileId,
    profileRevision: 1,
    policyRevision: policy!.revision,
  })
  const attempt = new Date(Date.now() + 10000).toISOString()
  const input = {
    profileId: regionProfileId,
    expectedRevision: 1,
    regionId: 10000002,
    typeId: 10000,
    policyRevision: policy!.revision,
    universeId: universe!.active!.universeId,
    attemptId: randomUUID(),
    attemptedAt: attempt,
    validatedAt: attempt,
    freshUntil: new Date(Date.now() + 86400000).toISOString(),
    days,
  }
  expect(await store().convergeMarketHistory(input)).toEqual({ outcome: 'applied', changedRows: 0 })
  const [unchanged] =
    await connection`select count(*) as count from eve_module_market.market_daily_history where region_id=10000002 and type_id=10000 and validated_at=${attempt}`
  expect(Number(unchanged!.count)).toBe(0)
  const correctedAt = new Date(Date.now() + 20000).toISOString()
  const corrected = {
    ...input,
    attemptId: randomUUID(),
    attemptedAt: correctedAt,
    validatedAt: correctedAt,
    days: [
      { ...days[0]!, averageIsk: (Number(days[0]!.averageIsk) + 0.01).toFixed(2) },
      ...days.slice(1),
    ],
  }
  expect(await store().convergeMarketHistory(corrected)).toEqual({
    outcome: 'applied',
    changedRows: 1,
  })
  const [changed] =
    await connection`select count(*) as count from eve_module_market.market_daily_history where region_id=10000002 and type_id=10000 and validated_at=${correctedAt}`
  expect(Number(changed!.count)).toBe(1)
  return { unchangedDailyRows: 0, correctedDailyRows: 1 }
}

test.skipIf(!enabled)(
  'measures a restartable 10,646-type regional sweep plus Global PLEX and coherent filtered three-panel reads',
  async () => {
    const start = performance.now()
    const collection = await sweep()
    const generation = await publishFinal()
    expect(generation.targetCount).toBe(targetCount)
    const [rows] =
      await connection`select count(*) as count from eve_module_market.market_daily_history`
    expect(Number(rows!.count)).toBe((targetCount + 1) * 365)
    await connection`analyze eve_module_market.market_daily_history`
    await connection`analyze eve_module_market.market_intelligence_outputs`
    const panels = await measurePanels()
    const changes = await convergenceProof()
    const storage =
      await connection`select relname,pg_relation_size(c.oid)::text as heap_bytes,pg_indexes_size(c.oid)::text as index_bytes from pg_class as c join pg_namespace as n on n.oid=c.relnamespace where n.nspname='eve_module_market' and relname in('market_daily_history','market_history_sources','market_intelligence_inputs','market_intelligence_outputs','market_intelligence_generations') order by relname`
    const report = {
      node: process.version,
      postgres: (await connection`show server_version`)[0]!.server_version,
      regionalTargets: targetCount,
      globalPlexTargets: 1,
      historyRows: Number(rows!.count),
      wallTimeMs: performance.now() - start,
      collection,
      generation,
      changes,
      panels,
      storage,
    }
    await writeFile(
      '/tmp/market-intelligence-capacity.json',
      JSON.stringify(report, null, 2) + '\n',
    )
    process.stdout.write(
      `Capacity evidence: /tmp/market-intelligence-capacity.json; ${report.wallTimeMs.toFixed(0)} ms\n`,
    )
  },
  600000,
)

test('capacity panel operation passes schema validation and aggregate admission before expensive setup', () => {
  const { schema, source, policies } = panelSchema()
  expect(validate(schema, parse(source)).map(({ message }) => message)).toEqual([])
  expect(analyzeGraphQLSelection(schema, source, undefined, {}, policies).cost).toBeLessThanOrEqual(
    5000,
  )
})
