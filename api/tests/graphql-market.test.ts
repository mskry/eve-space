import { beforeEach, expect, it, vi } from 'vitest'
import { createSchema } from 'graphql-yoga'
import { graphql } from 'graphql'
import { z } from 'zod'
import type { PlatformInstalledGraphQLContribution } from '@eve-space/platform-module-contract/graphql'
import { graphqlCoreTypeDefs } from '@eve-space/platform-module-conformance/graphql'

const fixture = vi.hoisted(() => ({
  enabled: true,
  factory: vi.fn(),
  marketCatalogue: vi.fn(),
  staticLocationLabels: vi.fn(),
  listMarketProfiles: vi.fn(),
  readMarketObservation: vi.fn(),
  readMarketReplacementStatus: vi.fn(),
  readMarketOrderRows: vi.fn(),
  readMarketHistory: vi.fn(),
  readMarketReferencePrices: vi.fn(),
}))
vi.mock('../src/auth/read-admission.js', () => ({
  admitOwnedRead: vi.fn(),
  sessionAdmissionDenial: vi.fn(),
}))
vi.mock('../src/organization/read-admission.js', () => ({ admitOrganizationRead: vi.fn() }))
vi.mock('../src/organization/session-context.js', () => ({
  loadOrganizationSessionContext: vi.fn(),
}))
vi.mock('../src/platform/module-settings.js', () => ({
  isInstalledModuleContributionEnabled: async () => fixture.enabled,
}))
vi.mock('../src/platform/module-route-capabilities.js', () => ({
  createPlatformModuleReadCapabilities: fixture.factory,
}))

import { installedGraphQLContributions } from '../src/generated/platform/installed-module-graphql.js'
import { createContributionResolvers } from '../src/graphql/contribution-resolvers.js'
import { applicationScalars } from '../src/graphql/scalars.js'
import { createGraphQLReadExecution } from '../src/graphql/request-execution.js'
import {
  analyzeGraphQLSelection,
  type GraphQLFieldPolicy,
} from '../src/graphql/execution-policy.js'

const contribution: PlatformInstalledGraphQLContribution = installedGraphQLContributions.find(
  (item) => item.moduleId === 'market',
)!
const profileId = '00000000-0000-4000-8000-000000000001'
const observationId = '00000000-0000-4000-8000-000000000002'
const revision = { buildNumber: 42, ingestVersion: 6, ingestedAt: '2026-09-28 12:00:00.123456+00' }
const now = new Date().toISOString()
const future = new Date(Date.now() + 300_000).toISOString()
const observation = {
  profileId,
  observationId,
  regionId: 10000058,
  typeId: 34,
  observedAt: now,
  validatedAt: now,
  freshUntil: future,
  expectedPages: 1,
  totalBookOrders: 2,
}
const row = {
  orderId: 1000000000001,
  side: 'sell',
  price: '999999999999999.99',
  volumeRemain: 10,
  locationId: 1000000000002,
  solarSystemId: 30000142,
  issuedAt: now,
  durationDays: 90,
  minimumVolume: 1,
  range: 'station',
}
const schema = createSchema({
  typeDefs: [graphqlCoreTypeDefs, contribution.definition.typeDefs],
  resolvers: { ...applicationScalars, ...createContributionResolvers(contribution) },
})
const policies: GraphQLFieldPolicy[] = contribution.reads.map((read) => ({
  field: read.field,
  protected: false,
  cost: read.cost,
  sourceCost: read.sourceCost,
  list: read.list ? { ...read.list, argument: read.list.argument ?? '' } : undefined,
}))
const context = () => {
  const liveSession = vi.fn()
  const cache = { publicUntil: vi.fn(), noStore: vi.fn() }
  return {
    liveSession,
    cache,
    execution: createGraphQLReadExecution({
      signal: new AbortController().signal,
      liveSession,
      cache,
    }),
  }
}
const execute = (source: string, request = context()) =>
  graphql({ schema, source, contextValue: request })
const bookQuery = `book(profileId: "${profileId}", typeId: "34")`
const ordersQuery = `orders(profileId: "${profileId}", typeId: "34", observationId: "${observationId}", side: sell`
const historyQuery = `history(profileId: "${profileId}", typeId: "34")`

beforeEach(() => {
  fixture.enabled = true
  const persistenceMethods = {
    'list-market-profiles': fixture.listMarketProfiles,
    'read-market-observation': fixture.readMarketObservation,
    'read-market-replacement-status': fixture.readMarketReplacementStatus,
    'read-market-order-rows': fixture.readMarketOrderRows,
    'read-market-history': fixture.readMarketHistory,
    'read-market-reference-prices': fixture.readMarketReferencePrices,
  }
  const coreDataMethods = {
    'market-catalogue': fixture.marketCatalogue,
    'static-location-labels': fixture.staticLocationLabels,
  }
  fixture.factory.mockImplementation((declaration, products: string[]) => ({
    persistence: Object.fromEntries(
      Object.entries(persistenceMethods)
        .filter(([operationId]) =>
          declaration.operations.some(
            (operation: { operationId: string }) => operation.operationId === operationId,
          ),
        )
        .map(([id, method]) => [
          id.replaceAll(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()),
          method,
        ]),
    ),
    coreData: Object.fromEntries(
      Object.entries(coreDataMethods)
        .filter(([id]) => products.includes(id))
        .map(([id, method]) => [
          id.replaceAll(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()),
          method,
        ]),
    ),
  }))
  fixture.marketCatalogue.mockResolvedValue({ kind: 'revision', revision })
  fixture.listMarketProfiles.mockResolvedValue([
    {
      profileId,
      revision: 7,
      regionId: 10000058,
      mode: 'watched-types',
      stationIds: [],
      watchedTypeIds: [34],
      lastFailureClass: null,
    },
  ])
  fixture.readMarketObservation.mockResolvedValue(observation)
  fixture.readMarketReplacementStatus.mockResolvedValue(null)
  fixture.readMarketOrderRows.mockResolvedValue({ rows: [row], hasMore: true })
  fixture.staticLocationLabels.mockResolvedValue({
    rows: [
      {
        locationId: 30000142,
        name: 'Jita',
        solarSystemSecurityStatus: 0.9,
      },
    ],
    complete: false,
  })
  fixture.readMarketHistory.mockResolvedValue({
    status: 'uncollected',
    regionId: 10000058,
    typeId: 34,
    validatedAt: null,
    freshUntil: null,
    days: [],
  })
  fixture.readMarketReferencePrices.mockResolvedValue([])
})

it('composes the installed public inventory without I/O and reads revision without loading the tree', async () => {
  expect(fixture.factory).not.toHaveBeenCalled()
  fixture.listMarketProfiles.mockResolvedValue([])
  const request = context()
  const result = await execute(
    '{ market { catalogueRevision { key buildNumber ingestVersion ingestedAt } profiles { profileId } } }',
    request,
  )
  expect(result.errors).toBeUndefined()
  expect(result.data?.market).toMatchObject({
    catalogueRevision: {
      buildNumber: '42',
      ingestVersion: 6,
      ingestedAt: '2026-09-28T12:00:00.123456Z',
    },
    profiles: [],
  })
  expect(fixture.marketCatalogue).toHaveBeenCalledExactlyOnceWith({ kind: 'revision' })
  expect(request.liveSession).not.toHaveBeenCalled()
})

it('pins catalogue type and bounded group pages, preserving continuation after a short requested page', async () => {
  const discovery = await execute('{ market { catalogueRevision { key } } }')
  const key = z
    .object({ market: z.object({ catalogueRevision: z.object({ key: z.string() }) }) })
    .parse(discovery.data).market.catalogueRevision.key
  fixture.marketCatalogue.mockResolvedValue({
    kind: 'group-types',
    revision,
    groupId: 18,
    items: Array.from({ length: 1 }, (_, index) => ({
      id: 34 + index,
      groupId: 18,
      name: 'Type',
    })),
    nextCursor: 't_y',
  })
  const source = `{ market { catalogueGroupTypes(revision: "${key}", groupId: "18", first: 1) { revision items { id name } nextCursor } } }`
  expect(analyzeGraphQLSelection(schema, source, undefined, {}, policies).cost).toBeLessThan(5000)
  const result = await execute(source)
  expect(fixture.marketCatalogue).toHaveBeenLastCalledWith({
    kind: 'group-types',
    groupId: 18,
    cursor: undefined,
    pageSize: 1,
  })
  expect(result.errors).toBeUndefined()
  expect(result.data?.market).toMatchObject({
    catalogueGroupTypes: { revision: key, items: [{ id: '34', name: 'Type' }], nextCursor: 't_y' },
  })
  fixture.marketCatalogue.mockResolvedValue({
    kind: 'type-by-id',
    revision,
    complete: true,
    item: null,
  })
  const missing = await execute(
    `{ market { catalogueType(revision: "${key}", typeId: "34") { item { id } } } }`,
  )
  expect(missing.errors?.[0]?.extensions.code).toBe('MARKET_TYPE_UNAVAILABLE')
  const obsolete = await execute(
    '{ market { catalogueType(revision: "obsolete", typeId: "34") { item { id } } } }',
  )
  expect(obsolete.errors?.[0]?.extensions.code).toBe('MARKET_CATALOGUE_REVISION_MISSING')
})

it('selects complete book state and incomplete replacement without order or label reads', async () => {
  fixture.readMarketReplacementStatus.mockResolvedValue({ attemptedAt: now })
  const request = context()
  const result = await execute(
    `{ market { ${bookQuery} { status profileRevision replacement { status } observation { observationId freshUntil } } } }`,
    request,
  )
  expect(result.errors).toBeUndefined()
  expect(result.data?.market).toMatchObject({
    book: {
      status: 'current',
      profileRevision: '7',
      replacement: { status: 'incomplete' },
      observation: { observationId, freshUntil: future },
    },
  })
  expect(fixture.readMarketOrderRows).not.toHaveBeenCalled()
  expect(fixture.staticLocationLabels).not.toHaveBeenCalled()
  expect(request.cache.noStore).toHaveBeenCalled()
})

it('keeps explicit order pages and opaque continuation pinned, with one public label batch', async () => {
  const result = await execute(
    `{ market { ${ordersQuery}, first: 1) { observationId nextCursor rows { orderId price locationId locationName expiryAt } } } }`,
  )
  expect(result.errors).toBeUndefined()
  const page = z
    .object({
      market: z.object({
        orders: z.object({ nextCursor: z.string(), rows: z.array(z.unknown()) }),
      }),
    })
    .parse(result.data).market.orders
  expect(page.rows).toMatchObject([
    {
      orderId: '1000000000001',
      price: row.price,
      locationId: '1000000000002',
      locationName: 'Jita · Location 1000000000002',
    },
  ])
  expect(fixture.staticLocationLabels).toHaveBeenCalledExactlyOnceWith({
    locationIds: [row.locationId, row.solarSystemId],
  })
  fixture.readMarketOrderRows.mockClear()
  fixture.readMarketObservation.mockClear()
  await execute(`{ market { ${ordersQuery}, after: "${page.nextCursor}") { rows { orderId } } } }`)
  expect(fixture.readMarketObservation).toHaveBeenCalledExactlyOnceWith({
    profileId,
    typeId: 34,
    observationId,
  })
  expect(fixture.readMarketOrderRows).toHaveBeenCalledWith(
    expect.objectContaining({ observationId, cursorPrice: row.price, cursorOrderId: row.orderId }),
  )
  fixture.readMarketObservation.mockResolvedValue(null)
  const removed = await execute(
    `{ market { ${ordersQuery}, after: "${page.nextCursor}") { rows { orderId } } } }`,
  )
  expect(removed.errors?.[0]?.extensions.code).toBe('MARKET_OBSERVATION_UNAVAILABLE')
  fixture.staticLocationLabels.mockResolvedValue({ rows: [], complete: false })
  fixture.readMarketObservation.mockResolvedValue(observation)
  const unknown = await execute(`{ market { ${ordersQuery}) { rows { locationName } } } }`)
  expect(unknown.data?.market).toMatchObject({
    orders: { rows: [{ locationName: `Location ${row.locationId}` }] },
  })
})

it.each([0, 101])('rejects order and catalogue page size %i before backend work', async (first) => {
  const result = await execute(
    `{ market { ${ordersQuery}, first: ${first}) { hasMore } catalogueGroupTypes(revision: "key", groupId: "18", first: ${first}) { nextCursor } } }`,
  )
  expect(result.errors).toHaveLength(2)
  expect(fixture.readMarketOrderRows).not.toHaveBeenCalled()
  expect(fixture.listMarketProfiles).not.toHaveBeenCalled()
  expect(fixture.marketCatalogue).not.toHaveBeenCalled()
})

it.each(['garbage', 'x'.repeat(1025)])(
  'rejects malformed bounded order cursors before reads',
  async (after) => {
    const result = await execute(`{ market { ${ordersQuery}, after: "${after}") { hasMore } } }`)
    expect(result.errors).toHaveLength(1)
    expect(fixture.readMarketObservation).not.toHaveBeenCalled()
  },
)

it('rejects a cursor reused for a different side or observation before any backend work', async () => {
  const first = await execute(`{ market { ${ordersQuery}) { nextCursor } } }`)
  const cursor = z
    .object({ market: z.object({ orders: z.object({ nextCursor: z.string() }) }) })
    .parse(first.data).market.orders.nextCursor
  fixture.listMarketProfiles.mockClear()
  fixture.readMarketObservation.mockClear()
  const result = await execute(
    `{ market { ${ordersQuery.replace('side: sell', 'side: buy')}, after: "${cursor}") { hasMore } } }`,
  )
  expect(result.errors).toHaveLength(1)
  expect(fixture.listMarketProfiles).not.toHaveBeenCalled()
  expect(fixture.readMarketObservation).not.toHaveBeenCalled()
})

it('retains independent book/history/reference clocks, exact prices and historical average semantics', async () => {
  const stale = '2026-01-01T00:00:00.000Z'
  const days = Array.from({ length: 365 }, () => ({
    date: '2026-01-01',
    averageIsk: '6.42',
    highIsk: '7.00',
    lowIsk: '5.00',
    volume: 100,
    orderCount: 20,
  }))
  fixture.readMarketHistory.mockResolvedValue({
    status: 'observed',
    regionId: 10000058,
    typeId: 34,
    validatedAt: stale,
    freshUntil: stale,
    days,
  })
  fixture.readMarketReferencePrices.mockResolvedValue([
    {
      typeId: 34,
      adjustedPriceIsk: '1.23456789',
      averagePriceIsk: null,
      sourceHour: stale,
      validatedAt: now,
    },
  ])
  const result = await execute(
    `{ market { ${bookQuery} { status observation { freshUntil } } ${historyQuery} { profileRevision freshness days { averageIsk volume } } referencePrices(typeIds: ["34"]) { kind rows { adjustedPriceIsk averagePriceIsk sourceHour validatedAt } } } }`,
  )
  expect(result.errors).toBeUndefined()
  expect(result.data?.market).toMatchObject({
    book: { status: 'current' },
    history: { profileRevision: '7', freshness: 'stale', days: expect.any(Array) },
    referencePrices: {
      kind: 'non-executable-reference',
      rows: [
        {
          adjustedPriceIsk: '1.23456789',
          averagePriceIsk: null,
          sourceHour: stale,
          validatedAt: now,
        },
      ],
    },
  })
  expect(
    z
      .object({ market: z.object({ history: z.object({ days: z.array(z.unknown()) }) }) })
      .parse(result.data).market.history.days,
  ).toHaveLength(365)
  expect(contribution.definition.typeDefs).not.toContain('median')
})

it('reuses aliased uncollected history without collection intent and closes reads after disablement', async () => {
  const request = context()
  const source = `{ market { a: ${historyQuery} { status freshness } b: ${historyQuery} { status freshness } } }`
  const result = await execute(source, request)
  expect(result.errors).toBeUndefined()
  expect(result.data?.market).toMatchObject({
    a: { status: 'uncollected', freshness: 'uncollected' },
    b: { status: 'uncollected' },
  })
  expect(fixture.readMarketHistory).toHaveBeenCalledOnce()
  expect(
    contribution.reads.flatMap((read) =>
      read.persistenceOperations.map(({ operationId }) => operationId),
    ),
  ).not.toContain('request-market-history-demand')
  const calls = fixture.factory.mock.calls.length
  fixture.enabled = false
  expect((await execute(source, request)).errors).toHaveLength(1)
  expect(fixture.factory).toHaveBeenCalledTimes(calls)
  expect(fixture.readMarketHistory).toHaveBeenCalledOnce()
})

it('bounds reference reads to 100 distinct types and performs no work for invalid lists', async () => {
  const ids = Array.from({ length: 100 }, (_, index) => `"${index + 1}"`).join(',')
  expect(
    (await execute(`{ market { referencePrices(typeIds: [${ids}]) { kind } } }`)).errors,
  ).toBeUndefined()
  expect(fixture.readMarketReferencePrices).toHaveBeenCalledOnce()
  for (const invalid of ['[]', '["34", "34"]', `[${ids}, "101"]`]) {
    const result = await execute(`{ market { referencePrices(typeIds: ${invalid}) { kind } } }`)
    expect(result.errors).toHaveLength(1)
  }
  expect(fixture.readMarketReferencePrices).toHaveBeenCalledOnce()
})

it('projects null persistence history as uncollected for an enabled full-region profile', async () => {
  fixture.listMarketProfiles.mockResolvedValue([
    { profileId, revision: 7, regionId: 10000058, mode: 'region', watchedTypeIds: [] },
  ])
  fixture.readMarketHistory.mockResolvedValue(null)
  const request = context()
  const result = await execute(
    `{ market { ${historyQuery} { status freshness profileRevision regionId typeId days { date } } } }`,
    request,
  )
  expect(result.errors).toBeUndefined()
  expect(result.data?.market).toMatchObject({
    history: {
      status: 'uncollected',
      freshness: 'uncollected',
      profileRevision: '7',
      regionId: '10000058',
      typeId: '34',
      days: [],
    },
  })
  expect(request.cache.noStore).toHaveBeenCalled()
})

it.each([
  null,
  {
    status: 'observed',
    regionId: 10000002,
    typeId: 34,
    validatedAt: now,
    freshUntil: future,
    days: [],
  },
])('rejects history when the profile changes during the source read', async (history) => {
  fixture.listMarketProfiles
    .mockResolvedValueOnce([
      { profileId, revision: 7, regionId: 10000058, mode: 'region', watchedTypeIds: [] },
    ])
    .mockResolvedValue([
      { profileId, revision: 8, regionId: 10000002, mode: 'region', watchedTypeIds: [] },
    ])
  fixture.readMarketHistory.mockResolvedValue(history)
  const result = await execute(`{ market { ${historyQuery} { profileRevision regionId } } }`)
  expect(result.errors?.[0]?.extensions.code).toBe('MARKET_HISTORY_PROFILE_CHANGED')
  expect(result.data?.market).toMatchObject({ history: null })
})

it.each([
  { profiles: [] },
  {
    profiles: [
      { profileId, revision: 7, regionId: 10000058, mode: 'watched-types', watchedTypeIds: [35] },
    ],
  },
])(
  'rejects unavailable or ineligible history profiles before the source read',
  async ({ profiles }) => {
    fixture.listMarketProfiles.mockResolvedValue(profiles)
    const result = await execute(`{ market { ${historyQuery} { status } } }`)
    expect(result.errors?.[0]?.extensions.code).toBe('MARKET_HISTORY_PROFILE_UNAVAILABLE')
    expect(fixture.readMarketHistory).not.toHaveBeenCalled()
  },
)
