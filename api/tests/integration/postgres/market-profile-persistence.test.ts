import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { runMigrations } from '../../../src/db/migration-runner.js'
import {
  loadInstalledModuleMigrationSets,
  runModuleMigrationSets,
} from '../../../src/db/module-migration-runner.js'
import {
  createStandaloneModulePersistenceOperationInvoker,
  createTransactionScopedModulePersistenceOperationInvoker,
} from '../../../src/db/module-persistence-operation-transaction.js'
import {
  installedModulePersistenceCapabilityFactories,
  installedModulePersistenceOperations,
} from '../../../src/generated/platform/installed-module-persistence.js'
import { installedModuleMigrations } from '../../../src/generated/platform/installed-module-migrations.js'
import {
  assertInstalledModulePersistenceContract,
  reconcileInstalledModulePersistenceContract,
  persistenceContractFingerprintFor,
} from '../../../src/db/module-persistence-attestation.js'
import { platformResources } from '../../../src/platform/resources.js'
import { createInMemoryQueueProducer } from '../../../src/queue/producer.js'
import { runProfileWorkPlanner } from '../../../src/queue/profile-work-planner.js'

const databasePassword = randomUUID()

let container: StartedTestContainer
let connection: postgres.Sql
let profiles: ReturnType<
  (typeof installedModulePersistenceCapabilityFactories.routes)['market/profiles']
>
let observations: ReturnType<
  (typeof installedModulePersistenceCapabilityFactories.resourceMaterializations)['market/orders']
>
let orderProjection: ReturnType<
  (typeof installedModulePersistenceCapabilityFactories.resourceProjections)['market/orders']
>
let bookReads: ReturnType<
  (typeof installedModulePersistenceCapabilityFactories.routes)['market/public-books']
>
let referenceReads: ReturnType<
  (typeof installedModulePersistenceCapabilityFactories.routes)['market/reference-prices']
>
let referenceWrites: ReturnType<
  (typeof installedModulePersistenceCapabilityFactories.resourceMaterializations)['market/reference-prices']
>
let historyReads: ReturnType<
  (typeof installedModulePersistenceCapabilityFactories.routes)['market/daily-history']
>
let historyDemand: ReturnType<
  (typeof installedModulePersistenceCapabilityFactories.routes)['market/daily-history-demand']
>
let historyProjection: ReturnType<
  (typeof installedModulePersistenceCapabilityFactories.resourceProjections)['market/daily-history']
>
let historyWrites: ReturnType<
  (typeof installedModulePersistenceCapabilityFactories.resourceMaterializations)['market/daily-history']
>
let structureWrites: ReturnType<
  (typeof installedModulePersistenceCapabilityFactories.resourceMaterializations)['market/structure-orders']
>
let structureReads: ReturnType<
  (typeof installedModulePersistenceCapabilityFactories.routes)['market/private-structures']
>
const moduleId = 'market'

const loadMarketMigrationSets = () =>
  loadInstalledModuleMigrationSets(
    installedModuleMigrations.filter((migration) => migration.moduleId === moduleId),
    undefined,
    [moduleId],
    installedModulePersistenceOperations.filter((operation) => operation.moduleId === moduleId),
  )

beforeAll(async () => {
  container = await new GenericContainer('postgres:17-alpine')
    .withEnvironment({
      POSTGRES_DB: 'eve_space',
      POSTGRES_PASSWORD: databasePassword,
      POSTGRES_USER: 'eve_space',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start()
  connection = postgres(
    `postgres://eve_space:${databasePassword}@${container.getHost()}:${container.getMappedPort(5432)}/eve_space`,
    { onnotice: () => {} },
  )
  await runMigrations(connection)
  await runModuleMigrationSets(connection, await loadMarketMigrationSets())
  const invoke = createStandaloneModulePersistenceOperationInvoker(
    connection,
    moduleId,
    installedModulePersistenceOperations,
  )
  profiles = installedModulePersistenceCapabilityFactories.routes['market/profiles'](invoke)
  observations =
    installedModulePersistenceCapabilityFactories.resourceMaterializations['market/orders'](invoke)
  orderProjection =
    installedModulePersistenceCapabilityFactories.resourceProjections['market/orders'](invoke)
  bookReads = installedModulePersistenceCapabilityFactories.routes['market/public-books'](invoke)
  referenceReads =
    installedModulePersistenceCapabilityFactories.routes['market/reference-prices'](invoke)
  referenceWrites =
    installedModulePersistenceCapabilityFactories.resourceMaterializations[
      'market/reference-prices'
    ](invoke)
  historyReads =
    installedModulePersistenceCapabilityFactories.routes['market/daily-history'](invoke)
  historyDemand =
    installedModulePersistenceCapabilityFactories.routes['market/daily-history-demand'](invoke)
  historyProjection =
    installedModulePersistenceCapabilityFactories.resourceProjections['market/daily-history'](
      invoke,
    )
  historyWrites =
    installedModulePersistenceCapabilityFactories.resourceMaterializations['market/daily-history'](
      invoke,
    )
  structureWrites =
    installedModulePersistenceCapabilityFactories.resourceMaterializations[
      'market/structure-orders'
    ](invoke)
  structureReads =
    installedModulePersistenceCapabilityFactories.routes['market/private-structures'](invoke)
})

afterAll(async () => {
  await connection?.end()
  await container?.stop()
})

beforeEach(async () => {
  await connection`truncate eve_module_market.market_profiles cascade`
  await connection`truncate eve_module_market.market_reference_prices`
  await connection`truncate eve_module_market.market_daily_history`
  await connection`truncate eve_module_market.market_structure_observations cascade`
  await connection`truncate eve_module_market.market_structure_demands`
})

test('persists bounded profiles with revision fencing, due discovery, and disablement', async () => {
  const profileId = randomUUID()
  const input = {
    profileId,
    regionId: 10000002,
    mode: 'watched-types' as const,
    stationIds: [60003760],
    watchedTypeIds: [34],
    enabled: true,
    expectedRevision: 0,
    requestId: randomUUID(),
  }
  expect(await profiles.listMarketProfiles({ enabledOnly: false })).toStrictEqual([])
  expect(await profiles.listDueMarketProfiles({ now: new Date().toISOString() })).toStrictEqual([])
  expect(await profiles.saveMarketProfile(input)).toStrictEqual({
    outcome: 'saved',
    revision: 1,
  })
  expect(await profiles.saveMarketProfile({ ...input, requestId: randomUUID() })).toStrictEqual({
    outcome: 'obsolete',
  })
  expect(await profiles.listMarketProfiles({ enabledOnly: true })).toMatchObject([
    { profileId, regionId: 10000002, revision: 1, enabled: true },
  ])
  expect(
    await profiles.listDueMarketProfiles({
      now: new Date(Date.now() + 1000).toISOString(),
    }),
  ).toMatchObject([{ profileId, revision: 1 }])
  expect(
    await profiles.saveMarketProfile({
      ...input,
      expectedRevision: 1,
      enabled: false,
      requestId: randomUUID(),
    }),
  ).toStrictEqual({ outcome: 'saved', revision: 2 })
  expect(await profiles.listMarketProfiles({ enabledOnly: true })).toStrictEqual([])
})

test.each([0, 1])(
  'enforces one enabled full-region profile during concurrent saves at revision %s',
  async (expectedRevision) => {
    const inputs = [10000002, 10000043].map((regionId) => ({
      profileId: randomUUID(),
      regionId,
      mode: 'region' as const,
      stationIds: [],
      watchedTypeIds: [],
      enabled: true,
      expectedRevision,
      requestId: randomUUID(),
    }))
    if (expectedRevision === 1) {
      await Promise.all(
        inputs.map((input) =>
          profiles.saveMarketProfile({
            ...input,
            enabled: false,
            expectedRevision: 0,
          }),
        ),
      )
    }

    const results = await Promise.all(inputs.map((input) => profiles.saveMarketProfile(input)))
    expect(results).toHaveLength(2)
    expect(results).toContainEqual({
      outcome: 'saved',
      revision: expectedRevision + 1,
    })
    expect(results).toContainEqual({ outcome: 'obsolete' })
    const enabledProfiles = await profiles.listMarketProfiles({
      enabledOnly: true,
    })
    expect(enabledProfiles).toHaveLength(1)
    expect(enabledProfiles[0]).toMatchObject({
      mode: 'region',
      revision: expectedRevision + 1,
    })

    const winner = inputs.find((input) => input.profileId === enabledProfiles[0]?.profileId)!
    const loser = inputs.find((input) => input.profileId !== winner.profileId)!
    expect(
      await profiles.saveMarketProfile({
        ...winner,
        enabled: false,
        expectedRevision: expectedRevision + 1,
        requestId: randomUUID(),
      }),
    ).toStrictEqual({ outcome: 'saved', revision: expectedRevision + 2 })
    expect(await profiles.saveMarketProfile({ ...loser, requestId: randomUUID() })).toStrictEqual({
      outcome: 'saved',
      revision: expectedRevision + 1,
    })
    expect(await profiles.listMarketProfiles({ enabledOnly: true })).toMatchObject([
      { profileId: loser.profileId, mode: 'region' },
    ])
  },
)

test('allows enabled watched-type profiles alongside a region profile but rejects switching their mode', async () => {
  const region = {
    profileId: randomUUID(),
    regionId: 10000002,
    mode: 'region' as const,
    stationIds: [],
    watchedTypeIds: [],
    enabled: true,
    expectedRevision: 0,
    requestId: randomUUID(),
  }
  const watched = {
    ...region,
    profileId: randomUUID(),
    mode: 'watched-types' as const,
    watchedTypeIds: [34],
    requestId: randomUUID(),
  }
  expect(await profiles.saveMarketProfile(region)).toStrictEqual({
    outcome: 'saved',
    revision: 1,
  })
  expect(await profiles.saveMarketProfile(watched)).toStrictEqual({
    outcome: 'saved',
    revision: 1,
  })
  await expect(
    connection`
      update eve_module_market.market_profiles
      set mode = 'region', watched_type_ids = '[]'::jsonb
      where profile_id = ${watched.profileId}::uuid
    `,
  ).rejects.toMatchObject({
    code: '23505',
    constraint_name: 'market_profiles_single_enabled_region_idx',
  })
  expect(await profiles.listMarketProfiles({ enabledOnly: true })).toHaveLength(2)
})

test('keeps a previous complete book when a replacement page is missing or repeats an order', async () => {
  const profileId = randomUUID()
  const now = new Date()
  const validatedAt = now.toISOString()
  const freshUntil = new Date(now.getTime() + 300_000).toISOString()
  await profiles.saveMarketProfile({
    profileId,
    regionId: 10000002,
    mode: 'watched-types',
    stationIds: [],
    watchedTypeIds: [34, 35],
    enabled: true,
    expectedRevision: 0,
    requestId: randomUUID(),
  })
  const marketKey = `${profileId}:34`
  const order = (orderId: number) => ({
    orderId,
    typeId: 34,
    locationId: 60003760,
    solarSystemId: 30000142,
    side: 'sell' as const,
    price: '6.42',
    volumeRemain: 10,
    issuedAt: validatedAt,
    durationDays: 365,
    minimumVolume: 1,
    range: 'station',
  })
  const begin = async (observationId: string) =>
    observations.beginMarketObservation({
      observationId,
      profileId,
      profileRevision: 1,
      marketKey,
      typeId: 34,
      expectedPages: 2,
      startedAt: validatedAt,
    })
  const stage = async (observationId: string, page: number, orderId: number) =>
    observations.stageMarketPages({
      observationId,
      expectedPages: 2,
      pages: [{ page, validatedAt, freshUntil, orders: [order(orderId)] }],
    })

  const initial = randomUUID()
  expect(await begin(initial)).toStrictEqual({ outcome: 'started' })
  expect(await stage(initial, 1, 11)).toStrictEqual({ outcome: 'staged' })
  expect(
    await observations.publishCollectedMarketObservation({
      observationId: initial,
    }),
  ).toStrictEqual({
    outcome: 'incomplete',
  })
  expect(await stage(initial, 2, 12)).toStrictEqual({ outcome: 'staged' })
  expect(
    await observations.publishCollectedMarketObservation({
      observationId: initial,
    }),
  ).toStrictEqual({
    outcome: 'published',
  })

  const replacement = randomUUID()
  expect(await begin(replacement)).toStrictEqual({ outcome: 'started' })
  expect(await stage(replacement, 1, 21)).toStrictEqual({ outcome: 'staged' })
  expect(await stage(replacement, 2, 21)).toStrictEqual({ outcome: 'staged' })
  expect(
    await observations.publishCollectedMarketObservation({
      observationId: replacement,
    }),
  ).toStrictEqual({
    outcome: 'incomplete',
  })
  const [pointer] = await connection<{ observation_id: string }[]>`
    select observation_id::text from eve_module_market.market_current_observations
    where market_key = ${marketKey}
  `
  expect(pointer?.observation_id).toBe(initial)
  const [failureClock] = await connection<{ attemptedAt: string }[]>`
    select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "attemptedAt"
  `
  const attemptedAt = failureClock!.attemptedAt
  expect(
    await observations.recordMarketTypeFailure({
      profileId,
      expectedRevision: 1,
      typeId: 34,
      attemptId: randomUUID(),
      attemptedAt,
    }),
  ).toEqual({ outcome: 'recorded' })
  const failedReplacement = await bookReads.readMarketReplacementStatus({
    profileId,
    typeId: 34,
  })
  expect(failedReplacement).not.toBeNull()
  expect(Date.parse(failedReplacement?.attemptedAt ?? '')).toBe(Date.parse(attemptedAt))
  expect(await bookReads.readMarketReplacementStatus({ profileId, typeId: 35 })).toBeNull()
  const recovered = randomUUID()
  const recoveredAt = new Date(Date.now() + 1_000).toISOString()
  await observations.beginMarketObservation({
    observationId: recovered,
    profileId,
    profileRevision: 1,
    marketKey,
    typeId: 34,
    expectedPages: 1,
    startedAt: recoveredAt,
  })
  await observations.stageMarketPages({
    observationId: recovered,
    expectedPages: 1,
    pages: [{ page: 1, validatedAt: recoveredAt, freshUntil, orders: [order(31)] }],
  })
  expect(
    await observations.publishCollectedMarketObservation({
      observationId: recovered,
    }),
  ).toEqual({
    outcome: 'published',
  })
  expect(await bookReads.readMarketReplacementStatus({ profileId, typeId: 34 })).toBeNull()
  await profiles.saveMarketProfile({
    profileId,
    regionId: 10000002,
    mode: 'watched-types',
    stationIds: [],
    watchedTypeIds: [34, 35],
    enabled: true,
    expectedRevision: 1,
    requestId: randomUUID(),
  })
  expect(await bookReads.readMarketReplacementStatus({ profileId, typeId: 34 })).toBeNull()
})

test('reads only the identified complete book with bounded price-time pages and current profile gate', async () => {
  const profileId = randomUUID()
  const observationId = randomUUID()
  const now = new Date()
  const validatedAt = now.toISOString()
  const freshUntil = new Date(now.getTime() + 300_000).toISOString()
  await profiles.saveMarketProfile({
    profileId,
    regionId: 10000002,
    mode: 'watched-types',
    stationIds: [],
    watchedTypeIds: [34],
    enabled: true,
    expectedRevision: 0,
    requestId: randomUUID(),
  })
  expect(
    await bookReads.readMarketObservation({
      profileId,
      typeId: 34,
      observationId: null,
    }),
  ).toBeNull()
  await observations.beginMarketObservation({
    observationId,
    profileId,
    profileRevision: 1,
    marketKey: `${profileId}:34`,
    typeId: 34,
    expectedPages: 1,
    startedAt: validatedAt,
  })
  const orders = [
    { orderId: 1, side: 'sell' as const, price: '7.00' },
    { orderId: 2, side: 'sell' as const, price: '6.00' },
    { orderId: 3, side: 'buy' as const, price: '5.00' },
    { orderId: 4, side: 'buy' as const, price: '4.00' },
  ].map((order) =>
    Object.assign({}, order, {
      typeId: 34,
      locationId: 60003760,
      solarSystemId: 30000142,
      volumeRemain: 10,
      issuedAt: validatedAt,
      durationDays: 90,
      minimumVolume: 1,
      range: 'station',
    }),
  )
  expect(
    await observations.stageMarketPages({
      observationId,
      expectedPages: 1,
      pages: [{ page: 1, validatedAt, freshUntil, orders }],
    }),
  ).toStrictEqual({ outcome: 'staged' })
  expect(await observations.publishCollectedMarketObservation({ observationId })).toStrictEqual({
    outcome: 'published',
  })
  expect(
    await bookReads.readMarketObservation({
      profileId,
      typeId: 34,
      observationId: null,
    }),
  ).toMatchObject({ observationId, profileId, typeId: 34, totalBookOrders: 4 })
  expect(
    await orderProjection.listMarketDerivationTypes({
      profileId,
      expectedRevision: 1,
    }),
  ).toStrictEqual([34])
  const metrics = {
    publication: 'complete' as const,
    observationId,
    marketId: `${profileId}:34`,
    observedAt: validatedAt,
    validatedAt,
    freshUntil,
    derivationVersion: 1,
    availableFrom: validatedAt,
    availableThrough: validatedAt,
    bestBidIsk: '5.00',
    bestAskIsk: '6.00',
    spreadIsk: '1.00',
    bidVolume: '20',
    askVolume: '20',
    depthBands: [1, 5, 10].map((percent) => ({
      percent,
      bidVolume: '10',
      askVolume: '10',
    })),
  }
  expect(
    await observations.storeMarketMetrics({
      observationId,
      typeId: 34,
      derivationVersion: 1,
      metrics,
    }),
  ).toStrictEqual({ outcome: 'stored' })
  const storedMetrics = await bookReads.readMarketMetrics({
    profileId,
    typeId: 34,
    beforeObservedAt: null,
    beforeObservationId: null,
  })
  expect(storedMetrics).toMatchObject({
    items: [{ observationId, derivationVersion: 1, metrics: { bestAskIsk: '6.00' } }],
  })
  expect(new Date(storedMetrics!.availableFrom!).getTime()).toBe(new Date(validatedAt).getTime())
  expect(new Date(storedMetrics!.availableThrough!).getTime()).toBe(new Date(validatedAt).getTime())
  const page = (
    side: 'buy' | 'sell',
    cursor: null | {
      price: string
      issuedAt: string
      orderId: number
    } = null,
  ) =>
    bookReads.readMarketOrderRows({
      observationId,
      typeId: 34,
      side,
      limit: 1,
      cursorPrice: cursor?.price ?? null,
      cursorIssuedAt: cursor?.issuedAt ?? null,
      cursorOrderId: cursor?.orderId ?? null,
    })
  const firstSeller = await page('sell')
  expect(firstSeller).toMatchObject({
    rows: [{ orderId: 2, price: '6.00' }],
    hasMore: true,
  })
  expect(
    await page('sell', {
      price: firstSeller.rows[0]!.price,
      issuedAt: firstSeller.rows[0]!.issuedAt,
      orderId: firstSeller.rows[0]!.orderId,
    }),
  ).toMatchObject({ rows: [{ orderId: 1, price: '7.00' }], hasMore: false })
  expect(await page('buy')).toMatchObject({
    rows: [{ orderId: 3, price: '5.00' }],
    hasMore: true,
  })
  expect(
    await bookReads.readMarketQuoteRows({
      observationId,
      typeId: 34,
      side: 'sell',
      locationIds: [60003760],
      limit: 1,
      cursorPrice: null,
      cursorIssuedAt: null,
      cursorOrderId: null,
    }),
  ).toMatchObject({
    rows: [{ orderId: 2, typeId: 34, price: '6.00' }],
    hasMore: true,
  })
  expect(
    await bookReads.readMarketQuoteRows({
      observationId,
      typeId: 34,
      side: 'sell',
      locationIds: [60000001],
      limit: 1,
      cursorPrice: null,
      cursorIssuedAt: null,
      cursorOrderId: null,
    }),
  ).toStrictEqual({ rows: [], hasMore: false })

  await profiles.saveMarketProfile({
    profileId,
    regionId: 10000002,
    mode: 'watched-types',
    stationIds: [],
    watchedTypeIds: [34],
    enabled: false,
    expectedRevision: 1,
    requestId: randomUUID(),
  })
  expect(
    await bookReads.readMarketObservation({
      profileId,
      typeId: 34,
      observationId,
    }),
  ).toBeNull()
  expect(
    await bookReads.readMarketMetrics({
      profileId,
      typeId: 34,
      beforeObservedAt: null,
      beforeObservationId: null,
    }),
  ).toBeNull()
  expect(await page('sell')).toStrictEqual({ rows: [], hasMore: false })
})

test('rejects page-count drift, incoherent validation times, and obsolete profile revisions', async () => {
  const profileId = randomUUID()
  await profiles.saveMarketProfile({
    profileId,
    regionId: 10000002,
    mode: 'watched-types',
    stationIds: [],
    watchedTypeIds: [34],
    enabled: true,
    expectedRevision: 0,
    requestId: randomUUID(),
  })
  const observationId = randomUUID()
  const now = new Date()
  const later = new Date(now.getTime() + 90_000)
  const freshUntil = new Date(now.getTime() + 300_000).toISOString()
  expect(
    await observations.beginMarketObservation({
      observationId,
      profileId,
      profileRevision: 1,
      marketKey: `${profileId}:34`,
      typeId: 34,
      expectedPages: 2,
      startedAt: now.toISOString(),
    }),
  ).toStrictEqual({ outcome: 'started' })
  expect(
    await observations.stageMarketPages({
      observationId,
      expectedPages: 3,
      pages: [{ page: 1, validatedAt: now.toISOString(), freshUntil, orders: [] }],
    }),
  ).toStrictEqual({ outcome: 'obsolete' })
  for (const [page, validatedAt] of [now, later].entries()) {
    expect(
      await observations.stageMarketPages({
        observationId,
        expectedPages: 2,
        pages: [{ page: page + 1, validatedAt: validatedAt.toISOString(), freshUntil, orders: [] }],
      }),
    ).toStrictEqual({ outcome: 'staged' })
  }
  expect(await observations.publishCollectedMarketObservation({ observationId })).toStrictEqual({
    outcome: 'incomplete',
  })
  const [pointer] = await connection<{ observation_id: string }[]>`
    select observation_id::text from eve_module_market.market_current_observations
    where market_key = ${`${profileId}:34`}
  `
  expect(pointer).toBeUndefined()

  await profiles.saveMarketProfile({
    profileId,
    regionId: 10000002,
    mode: 'watched-types',
    stationIds: [],
    watchedTypeIds: [34],
    enabled: false,
    expectedRevision: 1,
    requestId: randomUUID(),
  })
  expect(
    await observations.stageMarketPages({
      observationId,
      expectedPages: 2,
      pages: [{ page: 1, validatedAt: now.toISOString(), freshUntil, orders: [] }],
    }),
  ).toStrictEqual({ outcome: 'obsolete' })
  expect(await observations.publishCollectedMarketObservation({ observationId })).toStrictEqual({
    outcome: 'incomplete',
  })
})

test('enforces the durable four-profile deployment ceiling', async () => {
  for (let index = 0; index < 4; index += 1) {
    expect(
      await profiles.saveMarketProfile({
        profileId: randomUUID(),
        regionId: 10000058,
        mode: 'watched-types',
        stationIds: [],
        watchedTypeIds: [34],
        enabled: false,
        expectedRevision: 0,
        requestId: randomUUID(),
      }),
    ).toStrictEqual({ outcome: 'saved', revision: 1 })
  }
  expect(
    await profiles.saveMarketProfile({
      profileId: randomUUID(),
      regionId: 10000058,
      mode: 'watched-types',
      stationIds: [],
      watchedTypeIds: [34],
      enabled: false,
      expectedRevision: 0,
      requestId: randomUUID(),
    }),
  ).toStrictEqual({ outcome: 'obsolete' })
})

test('a delayed complete generation cannot replace a newer current pointer', async () => {
  const profileId = randomUUID()
  await profiles.saveMarketProfile({
    profileId,
    regionId: 10000058,
    mode: 'watched-types',
    stationIds: [],
    watchedTypeIds: [34],
    enabled: true,
    expectedRevision: 0,
    requestId: randomUUID(),
  })
  const older = randomUUID()
  const newer = randomUUID()
  const now = Date.now()
  const firstValidated = new Date(now - 10_000).toISOString()
  const lastValidated = new Date(now).toISOString()
  const freshUntil = new Date(now + 300_000).toISOString()
  for (const [observationId, validatedAt, orderId] of [
    [older, firstValidated, 1],
    [newer, lastValidated, 2],
  ] as const) {
    expect(
      await observations.beginMarketObservation({
        observationId,
        profileId,
        profileRevision: 1,
        marketKey: `${profileId}:34`,
        typeId: 34,
        expectedPages: 1,
        startedAt: validatedAt,
      }),
    ).toStrictEqual({ outcome: 'started' })
    expect(
      await observations.stageMarketPages({
        observationId,
        expectedPages: 1,
        pages: [
          {
            page: 1,
            validatedAt,
            freshUntil,
            orders: [
              {
                orderId,
                typeId: 34,
                locationId: 60003760,
                solarSystemId: 30000142,
                side: 'sell',
                price: '6.42',
                volumeRemain: 10,
                issuedAt: validatedAt,
                durationDays: 90,
                minimumVolume: 1,
                range: 'station',
              },
            ],
          },
        ],
      }),
    ).toStrictEqual({ outcome: 'staged' })
  }
  expect(
    await observations.publishCollectedMarketObservation({
      observationId: newer,
    }),
  ).toStrictEqual({
    outcome: 'published',
  })
  expect(
    await observations.publishCollectedMarketObservation({
      observationId: older,
    }),
  ).toStrictEqual({
    outcome: 'incomplete',
  })
  const [pointer] = await connection<{ observation_id: string }[]>`
    select observation_id::text from eve_module_market.market_current_observations
    where market_key = ${`${profileId}:34`}
  `
  expect(pointer?.observation_id).toBe(newer)
})

test.each([{ typeIds: [34, 35] }, { typeIds: [35, 34] }])(
  'schedules watched books by earliest current expiry regardless of publication order $typeIds',
  async ({ typeIds }) => {
    const profileId = randomUUID()
    const now = Date.now()
    const validatedAt = new Date(now - 10_000).toISOString()
    const earlyExpiry = new Date(now + 60_000).toISOString()
    const lateExpiry = new Date(now + 300_000).toISOString()
    await profiles.saveMarketProfile({
      profileId,
      regionId: 10000058,
      mode: 'watched-types',
      stationIds: [],
      watchedTypeIds: [34, 35],
      enabled: true,
      expectedRevision: 0,
      requestId: randomUUID(),
    })
    const dueAfterPublications = []
    for (const typeId of typeIds) {
      const observationId = randomUUID()
      await observations.beginMarketObservation({
        observationId,
        profileId,
        profileRevision: 1,
        marketKey: `${profileId}:${typeId}`,
        typeId,
        expectedPages: 1,
        startedAt: validatedAt,
      })
      await observations.stageMarketPages({
        observationId,
        expectedPages: 1,
        pages: [
          {
            page: 1,
            validatedAt,
            freshUntil: typeId === 34 ? earlyExpiry : lateExpiry,
            orders: [],
          },
        ],
      })
      expect(await observations.publishCollectedMarketObservation({ observationId })).toEqual({
        outcome: 'published',
      })
      dueAfterPublications.push(
        await profiles.listDueMarketProfiles({
          now: new Date(now + 1_000).toISOString(),
        }),
      )
    }
    expect(dueAfterPublications[0]).toMatchObject([{ profileId, revision: 1 }])
    expect(dueAfterPublications[1]).toEqual([])
    const [profile] = await profiles.listMarketProfiles({ enabledOnly: true })
    expect(Date.parse(profile!.nextDueAt!)).toBe(Date.parse(earlyExpiry))
    expect(await profiles.listDueMarketProfiles({ now: earlyExpiry })).toMatchObject([
      { profileId, revision: 1 },
    ])
    const refreshed = randomUUID()
    await observations.beginMarketObservation({
      observationId: refreshed,
      profileId,
      profileRevision: 1,
      marketKey: `${profileId}:34`,
      typeId: 34,
      expectedPages: 1,
      startedAt: new Date(now).toISOString(),
    })
    await observations.stageMarketPages({
      observationId: refreshed,
      expectedPages: 1,
      pages: [
        {
          page: 1,
          validatedAt: new Date(now).toISOString(),
          freshUntil: new Date(now + 600_000).toISOString(),
          orders: [],
        },
      ],
    })
    expect(
      await observations.publishCollectedMarketObservation({
        observationId: refreshed,
      }),
    ).toEqual({
      outcome: 'published',
    })
    const [advanced] = await profiles.listMarketProfiles({ enabledOnly: true })
    expect(Date.parse(advanced!.nextDueAt!)).toBe(Date.parse(lateExpiry))
    expect(await profiles.listDueMarketProfiles({ now: earlyExpiry })).toEqual([])
  },
)

test('accepts a still-fresh cached book without replacing its current observation', async () => {
  const profileId = randomUUID()
  const now = Date.now()
  const validatedAt = new Date(now - 10_000).toISOString()
  const freshUntil = new Date(now + 300_000).toISOString()
  await profiles.saveMarketProfile({
    profileId,
    regionId: 10000058,
    mode: 'watched-types',
    stationIds: [],
    watchedTypeIds: [34],
    enabled: true,
    expectedRevision: 0,
    requestId: randomUUID(),
  })
  const initial = randomUUID()
  const cached = randomUUID()
  for (const observationId of [initial, cached]) {
    await observations.beginMarketObservation({
      observationId,
      profileId,
      profileRevision: 1,
      marketKey: `${profileId}:34`,
      typeId: 34,
      expectedPages: 1,
      startedAt: validatedAt,
    })
    await observations.stageMarketPages({
      observationId,
      expectedPages: 1,
      pages: [{ page: 1, validatedAt, freshUntil, orders: [] }],
    })
    expect(await observations.publishCollectedMarketObservation({ observationId })).toEqual({
      outcome: observationId === initial ? 'published' : 'unchanged',
    })
  }
  expect(
    await bookReads.readMarketObservation({
      profileId,
      typeId: 34,
      observationId: null,
    }),
  ).toMatchObject({ observationId: initial })
  const [profile] = await profiles.listMarketProfiles({ enabledOnly: true })
  expect(profile?.lastFailureClass).toBeNull()
  expect(Date.parse(profile!.nextDueAt!)).toBe(Date.parse(freshUntil))
})

test('publishes complete expired public books without extending source freshness or stopping refresh', async () => {
  const profileId = randomUUID()
  const now = Date.now()
  const validatedAt = new Date(now - 30_000).toISOString()
  const freshUntil = new Date(now - 5_000).toISOString()
  await profiles.saveMarketProfile({
    profileId,
    regionId: 10000002,
    mode: 'region',
    stationIds: [],
    watchedTypeIds: [],
    enabled: true,
    expectedRevision: 0,
    requestId: randomUUID(),
  })
  const initial = randomUUID()
  const cached = randomUUID()
  const outcomes = []
  for (const observationId of [initial, cached]) {
    await observations.beginMarketObservation({
      observationId,
      profileId,
      profileRevision: 1,
      marketKey: `${profileId}:all`,
      typeId: null,
      expectedPages: 3,
      startedAt: validatedAt,
    })
    for (const pages of [[1, 2], [3]]) {
      await observations.stageMarketPages({
        observationId,
        expectedPages: 3,
        pages: pages.map((page) => ({
          page,
          validatedAt,
          freshUntil,
          orders: [batchOrder(page, validatedAt)],
        })),
      })
      outcomes.push(await observations.publishCollectedMarketObservation({ observationId }))
    }
  }
  expect(outcomes).toEqual([
    { outcome: 'incomplete' },
    { outcome: 'published' },
    { outcome: 'incomplete' },
    { outcome: 'unchanged' },
  ])
  const stored = await bookReads.readMarketObservation({
    profileId,
    typeId: 34,
    observationId: null,
  })
  expect(stored).toMatchObject({
    observationId: initial,
    totalBookOrders: 3,
  })
  expect(Date.parse(stored!.freshUntil)).toBe(Date.parse(freshUntil))
  const [profile] = await profiles.listMarketProfiles({ enabledOnly: true })
  expect(profile?.lastFailureClass).toBeNull()
  expect(Date.parse(profile!.nextDueAt!)).toBe(Date.parse(freshUntil))
  expect(await profiles.listDueMarketProfiles({ now: new Date(now).toISOString() })).toMatchObject([
    { profileId, revision: 1 },
  ])
})

test('records a classified retry deadline and refuses an obsolete failure', async () => {
  const profileId = randomUUID()
  await profiles.saveMarketProfile({
    profileId,
    regionId: 10000058,
    mode: 'watched-types',
    stationIds: [],
    watchedTypeIds: [34],
    enabled: true,
    expectedRevision: 0,
    requestId: randomUUID(),
  })
  const retryAt = new Date(Date.now() + 300_000).toISOString()
  expect(
    await observations.recordMarketFailure({
      profileId,
      expectedRevision: 1,
      failureId: randomUUID(),
      failureClass: 'esi-cooldown',
      retryAt,
    }),
  ).toStrictEqual({ outcome: 'recorded' })
  const [stored] = await profiles.listMarketProfiles({ enabledOnly: true })
  expect(stored).toMatchObject({ profileId, lastFailureClass: 'esi-cooldown' })
  expect(new Date(stored!.nextDueAt!).getTime()).toBe(new Date(retryAt).getTime())
  expect(await profiles.listDueMarketProfiles({ now: new Date().toISOString() })).toStrictEqual([])
  expect(
    await observations.recordMarketFailure({
      profileId,
      expectedRevision: 2,
      failureId: randomUUID(),
      failureClass: 'unknown',
      retryAt: null,
    }),
  ).toStrictEqual({ outcome: 'obsolete' })
})

test('reconstructs the same due profile after derived queue work is lost', async () => {
  const profileId = randomUUID()
  await profiles.saveMarketProfile({
    profileId,
    regionId: 10000058,
    mode: 'watched-types',
    stationIds: [],
    watchedTypeIds: [34],
    enabled: true,
    expectedRevision: 0,
    requestId: randomUUID(),
  })
  const resource = platformResources.find(
    ({ moduleId: selectedModuleId, resourceId }) =>
      selectedModuleId === 'market' && resourceId === 'orders',
  )!
  const identity = {
    moduleId: 'market',
    resourceId: 'orders',
    subjectKind: 'deployment' as const,
    subjectId: '1',
    subjectLifecycleId: randomUUID(),
  }
  const options = {
    resources: [resource],
    selectDue: vi.fn().mockResolvedValue([
      {
        identity,
        operationId: 'market-region-orders',
      },
    ]),
    plan: vi.fn(async () =>
      (
        await profiles.listDueMarketProfiles({
          now: new Date(Date.now() + 1000).toISOString(),
        })
      ).map(({ profileId: dueProfileId, revision, nextDueAt }) => ({
        resourceIdentity: identity,
        profileId: dueProfileId,
        revision,
        dueAt: nextDueAt,
      })),
    ),
    cooldowns: vi.fn(async (requests: readonly unknown[]) =>
      requests.map(() => ({
        active: false,
        coordinationAvailable: true,
        retryAfterSeconds: null,
      })),
    ),
  }
  const original = createInMemoryQueueProducer()
  expect(
    await runProfileWorkPlanner({ producer: original, outcomes: {} as never }, options),
  ).toMatchObject({ planned: 1 })
  const repaired = createInMemoryQueueProducer()
  expect(
    await runProfileWorkPlanner({ producer: repaired, outcomes: {} as never }, options),
  ).toMatchObject({ planned: 1 })
  expect(repaired.commands[0]).toMatchObject({
    name: 'module-profile-refresh',
    payload: { profileId, revision: 1 },
  })
  expect(
    await profiles.listDueMarketProfiles({
      now: new Date(Date.now() + 1000).toISOString(),
    }),
  ).toHaveLength(1)
})

test('drains a bounded batch of expired raw books without deleting current or compact evidence', async () => {
  const profileId = randomUUID()
  const oldId = randomUUID()
  const currentId = randomUUID()
  const failedId = randomUUID()
  const recentId = randomUUID()
  const now = new Date()
  const oldTime = new Date(now.getTime() - 20 * 60_000).toISOString()
  const recentTime = new Date(now.getTime() - 2 * 60_000).toISOString()
  await profiles.saveMarketProfile({
    profileId,
    regionId: 10000058,
    mode: 'region',
    stationIds: [],
    watchedTypeIds: [],
    enabled: true,
    expectedRevision: 0,
    requestId: randomUUID(),
  })
  for (const [observationId, status, startedAt] of [
    [oldId, 'complete', oldTime],
    [currentId, 'complete', oldTime],
    [failedId, 'staging', oldTime],
    [recentId, 'staging', recentTime],
  ] as const) {
    await connection`
      insert into eve_module_market.market_observations (
        observation_id, profile_id, profile_revision, market_key,
        region_id, expected_pages, status, started_at, observed_at
      ) values (
        ${observationId}, ${profileId}, 1, ${`${profileId}:all`},
        10000058, 1, ${status}, ${startedAt}::timestamptz,
        ${startedAt}::timestamptz
      )
    `
  }
  await connection`
    insert into eve_module_market.market_current_observations (
      market_key, observation_id, observed_at
    ) values (${`${profileId}:all`}, ${currentId}, ${oldTime}::timestamptz)
  `
  await connection`
    insert into eve_module_market.market_derived_metrics (
      observation_id, type_id, derivation_version, metrics, observed_at
    ) values (${oldId}, 34, 1, ${JSON.stringify({ bestAskIsk: '6.42' })}::jsonb,
      ${recentTime}::timestamptz)
  `
  await connection`
    insert into eve_module_market.market_observations (
      observation_id, profile_id, profile_revision, market_key,
      region_id, expected_pages, status, started_at, observed_at
    )
    select gen_random_uuid(), ${profileId}, 1, ${`${profileId}:all`},
      10000058, 1, 'staging', ${new Date(now.getTime() - 19 * 60_000).toISOString()}::timestamptz,
      null::timestamptz
    from generate_series(1, 65)
  `
  expect(await observations.cleanupMarketObservations({ now: now.toISOString() })).toStrictEqual({
    outcome: 'checked',
  })
  expect(
    await observations.cleanupMarketObservationBacklog({
      now: now.toISOString(),
    }),
  ).toStrictEqual({
    outcome: 'checked',
  })
  const rows = await connection<{ observation_id: string }[]>`
    select observation_id::text
    from eve_module_market.market_observations
    where profile_id = ${profileId}
  `
  expect(rows).toHaveLength(4)
  expect(rows.map(({ observation_id }) => observation_id)).toContain(currentId)
  expect(rows.map(({ observation_id }) => observation_id)).toContain(recentId)
  expect(rows.map(({ observation_id }) => observation_id)).not.toContain(oldId)
  const [metric] = await connection<{ observation_id: string }[]>`
    select observation_id::text from eve_module_market.market_derived_metrics
    where observation_id = ${oldId}
  `
  expect(metric?.observation_id).toBe(oldId)
  const [staging] = await connection<{ observation_id: string }[]>`
    select observation_id::text from eve_module_market.market_observations
    where observation_id = ${failedId}
  `
  expect(staging).toBeUndefined()
  expect(
    await observations.cleanupMarketObservationBacklog({
      now: now.toISOString(),
    }),
  ).toStrictEqual({
    outcome: 'checked',
  })
  const [remaining] = await connection<{ count: string }[]>`
    select count(*)::text as count from eve_module_market.market_observations
    where profile_id = ${profileId}
  `
  expect(remaining?.count).toBe('2')
})

test('converges hourly adjusted and average references without treating them as quotes', async () => {
  const observedHour = new Date()
  observedHour.setUTCMinutes(0, 0, 0)
  const validatedAt = new Date(observedHour.getTime() + 60_000).toISOString()
  expect(await referenceReads.readMarketReferencePrices({ typeIds: [34] })).toStrictEqual([])
  expect(
    await referenceWrites.upsertMarketReferencePrices({
      observedHour: observedHour.toISOString(),
      validatedAt,
      prices: [
        { typeId: 34, adjustedPriceIsk: '6.42', averagePriceIsk: null },
        { typeId: 35, adjustedPriceIsk: null, averagePriceIsk: '7.00' },
      ],
    }),
  ).toStrictEqual({ outcome: 'applied' })
  expect(await referenceReads.readMarketReferencePrices({ typeIds: [34, 35] })).toMatchObject([
    { typeId: 34, adjustedPriceIsk: '6.42', averagePriceIsk: null },
    { typeId: 35, adjustedPriceIsk: null, averagePriceIsk: '7.00' },
  ])
  await referenceWrites.upsertMarketReferencePrices({
    observedHour: observedHour.toISOString(),
    validatedAt: new Date(observedHour.getTime() + 120_000).toISOString(),
    prices: [{ typeId: 34, adjustedPriceIsk: '6.50', averagePriceIsk: '6.55' }],
  })
  expect(await referenceReads.readMarketReferencePrices({ typeIds: [34] })).toMatchObject([
    { adjustedPriceIsk: '6.50', averagePriceIsk: '6.55' },
  ])
})

test('bounds public full-region history demand and converges independent daily records', async () => {
  const profileId = randomUUID()
  await profiles.saveMarketProfile({
    profileId,
    regionId: 10000058,
    mode: 'region',
    stationIds: [],
    watchedTypeIds: [],
    enabled: true,
    expectedRevision: 0,
    requestId: randomUUID(),
  })
  expect(await historyReads.readMarketHistory({ profileId, typeId: 34 })).toBeNull()
  for (const typeId of Array.from({ length: 256 }, (_, index) => index + 34)) {
    expect(
      await historyDemand.requestMarketHistoryDemand({
        profileId,
        expectedRevision: 1,
        typeId,
        requestId: randomUUID(),
      }),
    ).toStrictEqual({ outcome: 'accepted' })
  }
  expect(
    await historyDemand.requestMarketHistoryDemand({
      profileId,
      expectedRevision: 1,
      typeId: 34,
      requestId: randomUUID(),
    }),
  ).toStrictEqual({ outcome: 'duplicate' })
  expect(
    await historyDemand.requestMarketHistoryDemand({
      profileId,
      expectedRevision: 1,
      typeId: 290,
      requestId: randomUUID(),
    }),
  ).toStrictEqual({ outcome: 'unavailable' })
  const now = new Date()
  const due = await historyProjection.listDueMarketHistoryProfiles({
    now: now.toISOString(),
  })
  expect(due).toMatchObject([{ profileId, revision: 1 }])
  const types = await historyProjection.listDueMarketHistoryTypes({
    profileId,
    expectedRevision: 1,
    now: now.toISOString(),
  })
  expect(types).toHaveLength(16)
  expect(types.map(({ typeId }) => typeId)).toContain(34)

  const date = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10)
  const freshUntil = new Date(now.getTime() + 86_400_000).toISOString()
  const days = [
    {
      date,
      averageIsk: '6.42',
      highIsk: '7.00',
      lowIsk: '6.00',
      volume: 100,
      orderCount: 9,
    },
  ]
  expect(
    await historyWrites.upsertMarketHistory({
      profileId,
      expectedRevision: 1,
      regionId: 10000058,
      typeId: 34,
      attemptId: randomUUID(),
      validatedAt: now.toISOString(),
      freshUntil,
      days,
    }),
  ).toStrictEqual({ outcome: 'applied' })
  expect(await historyReads.readMarketHistory({ profileId, typeId: 34 })).toMatchObject({
    status: 'observed',
    days: [{ date, averageIsk: '6.42', volume: 100 }],
  })
  const revisedAt = new Date(now.getTime() + 60_000).toISOString()
  expect(
    await historyWrites.upsertMarketHistory({
      profileId,
      expectedRevision: 1,
      regionId: 10000058,
      typeId: 34,
      attemptId: randomUUID(),
      validatedAt: revisedAt,
      freshUntil,
      days: [{ ...days[0]!, averageIsk: '6.50' }],
    }),
  ).toStrictEqual({ outcome: 'applied' })
  expect(
    await historyWrites.upsertMarketHistory({
      profileId,
      expectedRevision: 1,
      regionId: 10000058,
      typeId: 34,
      attemptId: randomUUID(),
      validatedAt: now.toISOString(),
      freshUntil,
      days: [{ ...days[0]!, averageIsk: '9.00' }],
    }),
  ).toStrictEqual({ outcome: 'obsolete' })
  expect(await historyReads.readMarketHistory({ profileId, typeId: 34 })).toMatchObject({
    days: [{ date, averageIsk: '6.50' }],
  })
  expect(
    (
      await historyProjection.listDueMarketHistoryTypes({
        profileId,
        expectedRevision: 1,
        now: now.toISOString(),
      })
    ).map(({ typeId }) => typeId),
  ).not.toContain(34)

  expect(
    await historyWrites.upsertMarketHistory({
      profileId,
      expectedRevision: 1,
      regionId: 10000058,
      typeId: 35,
      attemptId: randomUUID(),
      validatedAt: now.toISOString(),
      freshUntil,
      days: [],
    }),
  ).toStrictEqual({ outcome: 'applied' })
  expect(await historyReads.readMarketHistory({ profileId, typeId: 35 })).toMatchObject({
    status: 'observed',
    days: [],
  })
})

test('reconstructs finite watched history without demand and gates failures by profile revision', async () => {
  const profileId = randomUUID()
  await profiles.saveMarketProfile({
    profileId,
    regionId: 10000058,
    mode: 'watched-types',
    stationIds: [],
    watchedTypeIds: [34, 35],
    enabled: true,
    expectedRevision: 0,
    requestId: randomUUID(),
  })
  const now = new Date()
  expect(
    await historyProjection.listDueMarketHistoryTypes({
      profileId,
      expectedRevision: 1,
      now: now.toISOString(),
    }),
  ).toMatchObject([{ typeId: 34 }, { typeId: 35 }])
  const retryAt = new Date(now.getTime() + 300_000).toISOString()
  expect(
    await historyWrites.recordMarketHistoryFailure({
      profileId,
      expectedRevision: 1,
      failureId: randomUUID(),
      failureClass: 'esi-cooldown',
      retryAt,
    }),
  ).toStrictEqual({ outcome: 'recorded' })
  expect(
    await historyProjection.listDueMarketHistoryProfiles({
      now: now.toISOString(),
    }),
  ).toStrictEqual([])
  expect(
    await historyProjection.listDueMarketHistoryProfiles({
      now: new Date(now.getTime() + 360_000).toISOString(),
    }),
  ).toMatchObject([{ profileId, revision: 1 }])
  await profiles.saveMarketProfile({
    profileId,
    regionId: 10000058,
    mode: 'watched-types',
    stationIds: [],
    watchedTypeIds: [34],
    enabled: false,
    expectedRevision: 1,
    requestId: randomUUID(),
  })
  expect(
    await historyProjection.listDueMarketHistoryProfiles({
      now: new Date(now.getTime() + 360_000).toISOString(),
    }),
  ).toStrictEqual([])
  expect(await historyReads.readMarketHistory({ profileId, typeId: 34 })).toBeNull()
})

test('backs off one requested history type without suspending the profile', async () => {
  const profileId = randomUUID()
  await profiles.saveMarketProfile({
    profileId,
    regionId: 10000058,
    mode: 'watched-types',
    stationIds: [],
    watchedTypeIds: [34, 35],
    enabled: true,
    expectedRevision: 0,
    requestId: randomUUID(),
  })
  const now = new Date()
  const failureId = randomUUID()
  expect(
    await historyWrites.recordMarketHistoryFailure({
      profileId,
      expectedRevision: 1,
      typeId: 34,
      failureId,
      failureClass: 'esi-unavailable',
      retryAt: new Date(now.getTime() + 300_000).toISOString(),
    }),
  ).toStrictEqual({ outcome: 'recorded' })
  const dueTypes = (at: Date, typeId?: number) =>
    historyProjection.listDueMarketHistoryTypes({
      profileId,
      expectedRevision: 1,
      now: at.toISOString(),
      typeId,
    })
  expect(await dueTypes(now)).toMatchObject([{ typeId: 35 }])
  expect(await dueTypes(now, 34)).toStrictEqual([])
  expect(await dueTypes(now, 35)).toMatchObject([{ typeId: 35 }])
  expect(
    await historyProjection.listDueMarketHistoryProfiles({
      now: now.toISOString(),
    }),
  ).toMatchObject([{ profileId, revision: 1 }])
  expect(await historyReads.readMarketHistory({ profileId, typeId: 34 })).toMatchObject({
    status: 'uncollected',
  })
  expect(await dueTypes(new Date(now.getTime() + 360_000), 34)).toMatchObject([{ typeId: 34 }])

  const validatedAt = new Date(now.getTime() + 360_000).toISOString()
  expect(
    await historyWrites.upsertMarketHistory({
      profileId,
      expectedRevision: 1,
      regionId: 10000058,
      typeId: 34,
      attemptId: randomUUID(),
      validatedAt,
      freshUntil: new Date(now.getTime() + 86_400_000).toISOString(),
      days: [],
    }),
  ).toStrictEqual({ outcome: 'applied' })
  expect(await historyReads.readMarketHistory({ profileId, typeId: 34 })).toMatchObject({
    status: 'observed',
  })
  expect(
    await historyWrites.recordMarketHistoryFailure({
      profileId,
      expectedRevision: 1,
      typeId: 34,
      failureId: randomUUID(),
      failureClass: 'response-invalid',
      retryAt: null,
    }),
  ).toStrictEqual({ outcome: 'recorded' })
  const later = new Date(now.getTime() + 2 * 86_400_000)
  expect(await dueTypes(later, 34)).toStrictEqual([])
  expect(await dueTypes(later, 35)).toMatchObject([{ typeId: 35 }])
  expect(
    await historyWrites.recordMarketHistoryFailure({
      profileId,
      expectedRevision: 2,
      typeId: 34,
      failureId: randomUUID(),
      failureClass: 'esi-unavailable',
      retryAt: null,
    }),
  ).toStrictEqual({ outcome: 'obsolete' })
})

test('prunes obsolete history demand bindings without erasing daily source statistics', async () => {
  const profileId = randomUUID()
  const input = {
    profileId,
    regionId: 10000058,
    mode: 'region' as const,
    stationIds: [],
    watchedTypeIds: [],
    enabled: true,
    expectedRevision: 0,
    requestId: randomUUID(),
  }
  await profiles.saveMarketProfile(input)
  await historyDemand.requestMarketHistoryDemand({
    profileId,
    expectedRevision: 1,
    typeId: 34,
    requestId: randomUUID(),
  })
  const now = new Date()
  await historyWrites.upsertMarketHistory({
    profileId,
    expectedRevision: 1,
    regionId: 10000058,
    typeId: 34,
    attemptId: randomUUID(),
    validatedAt: now.toISOString(),
    freshUntil: new Date(now.getTime() + 86_400_000).toISOString(),
    days: [
      {
        date: now.toISOString().slice(0, 10),
        averageIsk: '6.42',
        highIsk: '7.00',
        lowIsk: '6.00',
        volume: 100,
        orderCount: 9,
      },
    ],
  })
  await profiles.saveMarketProfile({
    ...input,
    expectedRevision: 1,
    requestId: randomUUID(),
  })
  expect(await historyReads.readMarketHistory({ profileId, typeId: 34 })).toBeNull()
  expect(await historyWrites.cleanupMarketHistoryDemands({ now: now.toISOString() })).toStrictEqual(
    {
      outcome: 'checked',
    },
  )
  const [obsoleteDemand] = await connection<{ type_id: string }[]>`
    select type_id::text from eve_module_market.market_history_demands
    where profile_id = ${profileId} and type_id = 34
  `
  expect(obsoleteDemand).toBeUndefined()
  const [daily] = await connection<{ average: string }[]>`
    select average::text from eve_module_market.market_daily_history
    where region_id = 10000058 and type_id = 34
  `
  expect(daily?.average).toBe('6.42')
})

test('keeps private structure books complete and isolated by lifecycle and generation', async () => {
  const characterId = 90000001
  const subjectLifecycleId = randomUUID()
  const structureId = 1020000000000
  const now = new Date()
  const validatedAt = now.toISOString()
  const freshUntil = new Date(now.getTime() + 300_000).toISOString()
  const order = (orderId: number) => ({
    orderId,
    typeId: 34,
    locationId: structureId,
    solarSystemId: null,
    side: 'sell' as const,
    price: '6.42',
    volumeRemain: 10,
    issuedAt: validatedAt,
    durationDays: 90,
    minimumVolume: 1,
    range: 'station',
  })
  const failed = randomUUID()
  expect(
    await structureWrites.beginStructureObservation({
      observationId: failed,
      characterId,
      subjectLifecycleId,
      authorizationGeneration: 3,
      organizationVersion: 7,
      structureId,
      expectedPages: 2,
      startedAt: validatedAt,
    }),
  ).toStrictEqual({ outcome: 'started' })
  for (const page of [1, 2]) {
    expect(
      await structureWrites.stageStructurePage({
        observationId: failed,
        page,
        expectedPages: 2,
        validatedAt,
        freshUntil,
        orders: [order(1)],
      }),
    ).toStrictEqual({ outcome: 'staged' })
  }
  expect(
    await structureWrites.publishStructureObservation({
      observationId: failed,
    }),
  ).toStrictEqual({
    outcome: 'incomplete',
  })
  const current = randomUUID()
  await structureWrites.beginStructureObservation({
    observationId: current,
    characterId,
    subjectLifecycleId,
    authorizationGeneration: 3,
    organizationVersion: 7,
    structureId,
    expectedPages: 1,
    startedAt: validatedAt,
  })
  await structureWrites.stageStructurePage({
    observationId: current,
    page: 1,
    expectedPages: 1,
    validatedAt,
    freshUntil,
    orders: [order(2)],
  })
  expect(
    await structureWrites.publishStructureObservation({
      observationId: current,
    }),
  ).toStrictEqual({
    outcome: 'published',
  })
  const newerGeneration = randomUUID()
  await structureWrites.beginStructureObservation({
    observationId: newerGeneration,
    characterId,
    subjectLifecycleId,
    authorizationGeneration: 4,
    organizationVersion: 7,
    structureId,
    expectedPages: 1,
    startedAt: new Date(now.getTime() + 1_000).toISOString(),
  })
  await structureWrites.stageStructurePage({
    observationId: newerGeneration,
    page: 1,
    expectedPages: 1,
    validatedAt: new Date(now.getTime() + 1_000).toISOString(),
    freshUntil,
    orders: [order(3)],
  })
  expect(
    await structureWrites.publishStructureObservation({
      observationId: newerGeneration,
    }),
  ).toStrictEqual({ outcome: 'published' })
  const pointers = await connection<
    {
      authorization_generation: number
      observation_id: string
    }[]
  >`
    select authorization_generation, observation_id::text
    from eve_module_market.market_structure_current
    where character_id = ${characterId} and structure_id = ${structureId}
    order by authorization_generation
  `
  expect(pointers).toMatchObject([
    { authorization_generation: 3, observation_id: current },
    { authorization_generation: 4, observation_id: newerGeneration },
  ])
  const read = (
    authorizationGeneration: number,
    organizationVersion: number,
    lifecycleId = subjectLifecycleId,
  ) =>
    structureReads.readStructureBook({
      characterId,
      subjectLifecycleId: lifecycleId,
      authorizationGeneration,
      organizationVersion,
      structureId,
      typeId: 34,
      side: 'sell',
      limit: 100,
      cursorPrice: null,
      cursorIssuedAt: null,
      cursorOrderId: null,
    })
  expect(await read(3, 7)).toMatchObject({
    observationId: current,
    rows: [{ orderId: 2, price: '6.42' }],
  })
  expect(await read(4, 7)).toMatchObject({
    observationId: newerGeneration,
    rows: [{ orderId: 3 }],
  })
  expect(await read(4, 8)).toBeNull()
  expect(await read(4, 7, randomUUID())).toBeNull()
})

test('bounds exact-character structure demand and releases failed queue reservations', async () => {
  const characterId = 90000001
  const subjectLifecycleId = randomUUID()
  const base = {
    characterId,
    subjectLifecycleId,
    authorizationGeneration: 4,
    organizationVersion: 7,
  }
  const reservations: Array<typeof base & { structureId: number; requestId: string }> = []
  for (let index = 0; index < 4; index += 1) {
    const demand = {
      ...base,
      structureId: 1020000000000 + index,
      requestId: randomUUID(),
    }
    expect(await structureReads.reserveStructureDemand(demand)).toStrictEqual({
      outcome: 'reserved',
    })
    reservations.push(demand)
  }
  const extra = {
    ...base,
    structureId: 1020000000004,
    requestId: randomUUID(),
  }
  expect(await structureReads.reserveStructureDemand(extra)).toStrictEqual({
    outcome: 'full',
  })
  expect(
    await structureReads.reserveStructureDemand({
      ...reservations[0]!,
      requestId: randomUUID(),
    }),
  ).toStrictEqual({ outcome: 'recent' })
  expect(await structureReads.releaseStructureDemand(reservations[0]!)).toStrictEqual({
    outcome: 'released',
  })
  expect(await structureReads.reserveStructureDemand(extra)).toStrictEqual({
    outcome: 'reserved',
  })
  expect(
    await structureWrites.cleanupStructureDemands({
      now: new Date(Date.now() + 25 * 60 * 60_000).toISOString(),
    }),
  ).toStrictEqual({ outcome: 'checked' })
  const [remaining] = await connection<{ count: string }[]>`
    select count(*)::text as count from eve_module_market.market_structure_demands
    where character_id = ${characterId}
  `
  expect(remaining?.count).toBe('0')
})

const batchOrder = (orderId: number, issuedAt: string) => ({
  orderId,
  typeId: 34,
  locationId: 60003760,
  solarSystemId: 30000142,
  side: 'sell' as const,
  price: '6.42',
  volumeRemain: 10,
  issuedAt,
  durationDays: 90,
  minimumVolume: 1,
  range: 'station',
})

const batchCounts = async (observationId: string) => {
  const [counts] = await connection<{ pages: number; orders: number }[]>`
    select (select count(*)::integer from eve_module_market.market_observation_pages
      where observation_id = ${observationId}) as pages,
      (select count(*)::integer from eve_module_market.market_observation_orders
      where observation_id = ${observationId}) as orders
  `
  return counts
}

const batchFixture = async (expectedPages = 3) => {
  const profileId = randomUUID()
  const observationId = randomUUID()
  const previousId = randomUUID()
  const validatedAt = new Date().toISOString()
  const previousAt = new Date(Date.parse(validatedAt) - 1_000).toISOString()
  const freshUntil = new Date(Date.parse(validatedAt) + 300_000).toISOString()
  const profile = {
    profileId,
    regionId: 10000002,
    mode: 'watched-types' as const,
    stationIds: [],
    watchedTypeIds: [34],
    enabled: true,
  }
  await profiles.saveMarketProfile({ ...profile, expectedRevision: 0, requestId: randomUUID() })
  const begin = async (id: string, pages: number, at: string) =>
    observations.beginMarketObservation({
      observationId: id,
      profileId,
      profileRevision: 1,
      marketKey: `${profileId}:34`,
      typeId: 34,
      expectedPages: pages,
      startedAt: at,
    })
  await begin(previousId, 1, previousAt)
  await observations.stageMarketPages({
    observationId: previousId,
    expectedPages: 1,
    pages: [
      { page: 1, validatedAt: previousAt, freshUntil, orders: [batchOrder(10000, previousAt)] },
    ],
  })
  await observations.publishCollectedMarketObservation({ observationId: previousId })
  await begin(observationId, expectedPages, validatedAt)
  const page = (number: number, ids = [number]) => ({
    page: number,
    validatedAt,
    freshUntil,
    orders: ids.map((id) => batchOrder(id, validatedAt)),
  })
  const stage = (pages: ReturnType<typeof page>[]) =>
    observations.stageMarketPages({ observationId, expectedPages, pages })
  const publish = () => observations.publishCollectedMarketObservation({ observationId })
  const current = () =>
    bookReads.readMarketObservation({ profileId, typeId: 34, observationId: null })
  return {
    profile,
    profileId,
    observationId,
    previousId,
    validatedAt,
    freshUntil,
    page,
    stage,
    publish,
    current,
  }
}

test('publishes multi-batch replacements and converges replay across batch boundaries', async () => {
  const fixture = await batchFixture(4)
  const { page, stage, publish, current, observationId } = fixture
  expect(await stage([page(1), page(2)])).toEqual({ outcome: 'staged' })
  expect(await publish()).toEqual({ outcome: 'incomplete' })
  expect(await current()).toMatchObject({ observationId: fixture.previousId })
  expect(
    await stage([
      { ...page(1), freshUntil: new Date(Date.parse(fixture.freshUntil) + 1_000).toISOString() },
      page(3),
    ]),
  ).toEqual({ outcome: 'obsolete' })
  expect(await batchCounts(observationId)).toEqual({ pages: 2, orders: 2 })
  expect(await stage([page(2), page(3)])).toEqual({ outcome: 'staged' })
  expect(await stage([page(1), page(3)])).toEqual({ outcome: 'staged' })
  expect(await stage([page(4)])).toEqual({ outcome: 'staged' })
  expect(await batchCounts(observationId)).toEqual({ pages: 4, orders: 4 })
  expect(await publish()).toEqual({ outcome: 'published' })
  const stored = await current()
  expect(stored).toMatchObject({ observationId, totalBookOrders: 4, expectedPages: 4 })
  expect(Date.parse(stored!.validatedAt)).toBe(Date.parse(fixture.validatedAt))
  expect(Date.parse(stored!.freshUntil)).toBe(Date.parse(fixture.freshUntil))
})

test.each(['within', 'across'])(
  'retains the prior book when orders repeat %s batches',
  async (kind) => {
    const fixture = await batchFixture()
    await fixture.stage([fixture.page(1)])
    const second = kind === 'within' ? fixture.page(2, [2, 2]) : fixture.page(2, [1])
    await fixture.stage([second, fixture.page(3)])
    expect(await fixture.publish()).toEqual({ outcome: 'incomplete' })
    expect(await fixture.current()).toMatchObject({
      observationId: fixture.previousId,
      totalBookOrders: 1,
    })
  },
)

test('rolls back metadata and orders for an entire failed batch while retaining earlier batches', async () => {
  const fixture = await batchFixture()
  await fixture.stage([fixture.page(1)])
  await connection`alter table eve_module_market.market_observation_orders
    add constraint market_batch_fault check (order_id <> 99999999)`
  try {
    await expect(fixture.stage([fixture.page(2), fixture.page(3, [99999999])])).rejects.toThrow(
      'execution',
    )
    expect(await batchCounts(fixture.observationId)).toEqual({ pages: 1, orders: 1 })
    expect(await fixture.publish()).toEqual({ outcome: 'incomplete' })
    expect(await fixture.current()).toMatchObject({ observationId: fixture.previousId })
  } finally {
    await connection`alter table eve_module_market.market_observation_orders drop constraint market_batch_fault`
  }
  expect(await fixture.stage([fixture.page(2), fixture.page(3)])).toEqual({ outcome: 'staged' })
  expect(await fixture.publish()).toEqual({ outcome: 'published' })
})

test.each([
  { enabled: false, afterFinalBatch: false },
  { enabled: true, afterFinalBatch: false },
  { enabled: false, afterFinalBatch: true },
  { enabled: true, afterFinalBatch: true },
])(
  'fences profile changes before later batches and publication %j',
  async ({ enabled, afterFinalBatch }) => {
    const fixture = await batchFixture()
    await fixture.stage([fixture.page(1), fixture.page(2)])
    if (afterFinalBatch) await fixture.stage([fixture.page(3)])
    const before = await batchCounts(fixture.observationId)
    await profiles.saveMarketProfile({
      ...fixture.profile,
      enabled,
      expectedRevision: 1,
      requestId: randomUUID(),
    })
    expect(await fixture.stage([fixture.page(3)])).toEqual({ outcome: 'obsolete' })
    expect(await batchCounts(fixture.observationId)).toEqual(before)
    expect(await fixture.publish()).toEqual({ outcome: 'incomplete' })
    const [pointer] = await connection<{ observationId: string }[]>`
    select observation_id::text as "observationId" from eve_module_market.market_current_observations
    where market_key = ${`${fixture.profileId}:34`}
  `
    expect(pointer?.observationId).toBe(fixture.previousId)
  },
)

const createBatchLatch = () => {
  let resolve!: () => void
  let reject!: (reason: Error) => void
  const promise = new Promise<void>((accept, deny) => {
    resolve = accept
    reject = deny
  })
  return { promise, resolve, reject }
}

test('holds batch eligibility through commit while a concurrent profile update waits', async () => {
  const fixture = await batchFixture()
  const staged = createBatchLatch()
  const release = createBatchLatch()
  const batch = connection.begin(async (transaction) => {
    const scope = createTransactionScopedModulePersistenceOperationInvoker(
      transaction,
      moduleId,
      installedModulePersistenceOperations,
    )
    const writes = installedModulePersistenceCapabilityFactories.resourceMaterializations[
      'market/orders'
    ](scope.invoke)
    try {
      await writes.stageMarketPages({
        observationId: fixture.observationId,
        expectedPages: 3,
        pages: [fixture.page(1), fixture.page(2)],
      })
      staged.resolve()
      await release.promise
    } finally {
      scope.close()
    }
  })
  void batch.catch(staged.reject)
  await staged.promise
  const update = profiles.saveMarketProfile({
    ...fixture.profile,
    enabled: false,
    expectedRevision: 1,
    requestId: randomUUID(),
  })
  try {
    await vi.waitFor(async () => {
      const [waiting] = await connection<{ count: number }[]>`
        select count(*)::integer as count from pg_stat_activity
        where wait_event_type = 'Lock' and query like '%persist_save_market_profile%'
      `
      expect(waiting?.count).toBe(1)
    })
  } finally {
    release.resolve()
  }
  await batch
  expect(await update).toMatchObject({ outcome: 'saved', revision: 2 })
  expect(await batchCounts(fixture.observationId)).toEqual({ pages: 2, orders: 2 })
  expect(await fixture.stage([fixture.page(3)])).toEqual({ outcome: 'obsolete' })
  expect(await fixture.publish()).toEqual({ outcome: 'incomplete' })
})

test('serializes concurrent identical batch replay without duplicating pages or orders', async () => {
  const fixture = await batchFixture()
  const pages = [fixture.page(1), fixture.page(2), fixture.page(3)]
  expect(await Promise.all([fixture.stage(pages), fixture.stage(pages)])).toEqual([
    { outcome: 'staged' },
    { outcome: 'staged' },
  ])
  expect(await batchCounts(fixture.observationId)).toEqual({ pages: 3, orders: 3 })
  expect(await fixture.publish()).toEqual({ outcome: 'published' })
})

test('upgrades and attests batch staging without losing complete or staged observations', async () => {
  await connection`create database market_batch_upgrade`
  const upgraded = postgres(
    `postgres://eve_space:${databasePassword}@${container.getHost()}:${container.getMappedPort(5432)}/market_batch_upgrade`,
    { onnotice: () => {} },
  )
  try {
    await runMigrations(upgraded)
    const [currentSet] = await loadMarketMigrationSets()
    const oldOperations = currentSet!.persistenceOperations!.filter(
      (operation) => operation.migration !== 'market-003-batch-staging.sql',
    )
    await runModuleMigrationSets(upgraded, [
      {
        ...currentSet!,
        migrations: currentSet!.migrations.slice(0, 2),
        persistenceOperations: oldOperations,
      },
    ])
    const invoke = createStandaloneModulePersistenceOperationInvoker(
      upgraded,
      moduleId,
      installedModulePersistenceOperations,
    )
    const configured =
      installedModulePersistenceCapabilityFactories.routes['market/profiles'](invoke)
    const writes =
      installedModulePersistenceCapabilityFactories.resourceMaterializations['market/orders'](
        invoke,
      )
    const reads =
      installedModulePersistenceCapabilityFactories.routes['market/public-books'](invoke)
    const oldStage = installedModulePersistenceOperations.find(
      (operation) =>
        operation.moduleId === moduleId && operation.operationId === 'stage-market-page',
    )!
    const profileId = randomUUID()
    const previous = randomUUID()
    const replacement = randomUUID()
    const validatedAt = new Date().toISOString()
    const freshUntil = new Date(Date.parse(validatedAt) + 300_000).toISOString()
    await configured.saveMarketProfile({
      profileId,
      regionId: 10000002,
      mode: 'watched-types',
      stationIds: [],
      watchedTypeIds: [34],
      enabled: true,
      expectedRevision: 0,
      requestId: randomUUID(),
    })
    for (const observationId of [previous, replacement]) {
      const at =
        observationId === previous
          ? new Date(Date.parse(validatedAt) - 1_000).toISOString()
          : validatedAt
      const expectedPages = observationId === previous ? 1 : 2
      await writes.beginMarketObservation({
        observationId,
        profileId,
        profileRevision: 1,
        marketKey: `${profileId}:34`,
        typeId: 34,
        expectedPages,
        startedAt: at,
      })
      await invoke(oldStage, {
        observationId,
        expectedPages,
        page: 1,
        validatedAt: at,
        freshUntil,
        orders: [batchOrder(1, at)],
      })
      expect(await writes.publishCollectedMarketObservation({ observationId })).toEqual({
        outcome: observationId === previous ? 'published' : 'incomplete',
      })
    }
    await runModuleMigrationSets(upgraded, [currentSet!])
    const operations = installedModulePersistenceOperations.filter(
      (operation) => operation.moduleId === moduleId,
    )
    const fingerprint = persistenceContractFingerprintFor(operations, [moduleId])
    await reconcileInstalledModulePersistenceContract(upgraded, fingerprint, operations, [moduleId])
    await assertInstalledModulePersistenceContract(upgraded, fingerprint, operations, [moduleId])
    expect(
      await reads.readMarketObservation({ profileId, typeId: 34, observationId: null }),
    ).toMatchObject({ observationId: previous, totalBookOrders: 1 })
    expect(
      await writes.stageMarketPages({
        observationId: replacement,
        expectedPages: 2,
        pages: [{ page: 2, validatedAt, freshUntil, orders: [batchOrder(2, validatedAt)] }],
      }),
    ).toEqual({ outcome: 'staged' })
    expect(await writes.publishCollectedMarketObservation({ observationId: replacement })).toEqual({
      outcome: 'published',
    })
    expect(
      await reads.readMarketObservation({ profileId, typeId: 34, observationId: null }),
    ).toMatchObject({ observationId: replacement, totalBookOrders: 2 })
  } finally {
    await upgraded.end()
    await connection`drop database market_batch_upgrade`
  }
})
