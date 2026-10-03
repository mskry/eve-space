import { readFile } from 'node:fs/promises'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { compress } from 'hono/compress'
import { cors } from 'hono/cors'

const port = Number(process.env.MARKET_FIXTURE_PORT ?? 9876)
const webOrigin = process.env.MARKET_PREVIEW_ORIGIN ?? 'http://localhost:3002'
const data = process.env.MARKET_FIXTURE_DATA_PATH
  ? JSON.parse(await readFile(process.env.MARKET_FIXTURE_DATA_PATH, 'utf8'))
  : null
const revision = {
  buildNumber: 3542233,
  ingestVersion: 5,
  ingestedAt: '2026-09-24 12:00:00.123456+00',
}
const key = 'fixture-revision'
let currentKey = key
let currentRevision = revision
const groups = data?.groups ?? [
  { id: 1, parentId: null, name: 'Ships', iconId: null, directTypeCount: 0 },
  { id: 2, parentId: 1, name: 'Frigates', iconId: null, directTypeCount: 0 },
  { id: 3, parentId: 2, name: 'Minmatar', iconId: null, directTypeCount: 228 },
]
const types = data?.types ?? [
  { id: 587, groupId: 3, name: 'Rifter' },
  { id: 40520, groupId: 3, name: 'Large Skill Injector' },
  { id: 44992, groupId: 3, name: 'PLEX' },
  ...Array.from({ length: 19_999 }, (_, index) => ({
    id: index + 1_000_000,
    groupId: 3,
    name: `Synthetic Market Item ${index}`,
  })),
]
const profileA = '00000000-0000-4000-8000-000000000001'
const profileB = '00000000-0000-4000-8000-000000000003'
const profileC = '00000000-0000-4000-8000-000000000004'
const observationId = '00000000-0000-4000-8000-000000000002'
let bookState = 'complete'
let historyState = 'complete'
let disabled = false
const profileRows = [
  {
    profileId: profileA,
    revision: 1,
    regionId: 10000002,
    marketScope: 'region',
    mode: 'watched-types',
    stationIds: [],
    watchedTypeIds: [587],
  },
  {
    profileId: profileB,
    revision: 1,
    regionId: 10000043,
    marketScope: 'region',
    mode: 'watched-types',
    stationIds: [],
    watchedTypeIds: [587],
  },
  {
    profileId: profileC,
    revision: 1,
    regionId: 19000001,
    marketScope: 'global-plex',
    mode: 'watched-types',
    stationIds: [],
    watchedTypeIds: [44992],
  },
]
const order = (orderId, side, price) => ({
  orderId,
  side,
  price,
  volumeRemain: 10,
  locationId: 60003760,
  solarSystemId: 30000142,
  locationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
  solarSystemSecurityStatus: 0.945913,
  issuedAt: '2026-09-28T00:00:00.000Z',
  durationDays: 90,
  expiryAt: '2026-12-27T00:00:00.000Z',
  minimumVolume: side === 'buy' ? 5 : 1,
  range: side === 'buy' ? 'region' : 'station',
})
const bookOrderRows = (typeId, empty) => {
  if (empty)
    return {
      sellers: { rows: [], hasMore: false },
      buyers: { rows: [], hasMore: false },
    }
  const alternate = typeId === 1
  if (typeId === 40520) {
    return {
      sellers: {
        rows: Array.from({ length: 100 }, (_, index) =>
          order(index + 1, 'sell', `${index + 1}.00`),
        ),
        hasMore: true,
      },
      buyers: { rows: [], hasMore: false },
    }
  }
  if (typeId === 44992) {
    return {
      sellers: { rows: [order(10, 'sell', '4921000.00')], hasMore: false },
      buyers: { rows: [order(11, 'buy', '4672000.00')], hasMore: false },
    }
  }
  return {
    sellers: {
      rows: [
        order(1, 'sell', alternate ? '99.00' : '5.00'),
        order(2, 'sell', alternate ? '98.00' : '2.00'),
      ],
      hasMore: false,
    },
    buyers: { rows: [order(3, 'buy', '1.00')], hasMore: false },
  }
}
const observationOrderCount = (typeId, empty) => {
  if (empty) return 0
  if (typeId === 40520) return 103
  return typeId === 44992 ? 2 : 3
}
const days = Array.from({ length: 21 }, (_, index) => ({
  date: new Date(Date.UTC(2026, 8, index + 1)).toISOString().slice(0, 10),
  averageIsk: `${index + 1}.00`,
  highIsk: `${index + 2}.00`,
  lowIsk: `${index}.00`,
  volume: 100 + index,
  orderCount: 10 + index,
}))

export const app = new Hono()
app.use('*', cors({ origin: [webOrigin], credentials: true }))
app.use('*', compress({ encoding: 'gzip' }))
app.use('/api/modules/market/*', async (context, next) => {
  if (disabled) return context.json({ code: 'MODULE_DISABLED' }, 404)
  await next()
})
app.get('/api/modules', (context) =>
  context.json({
    enabledModuleIds: disabled ? [] : ['market'],
    enabledSections: [],
    shellNavigationOrder: { dashboard: [], character: [] },
  }),
)
app.post('/__fixture/revision', (context) => {
  currentKey = `${key}-v2`
  currentRevision = { ...revision, ingestedAt: '2026-09-24 12:01:00.000001+00' }
  return context.json({ key: currentKey, revision: currentRevision })
})
app.post('/__fixture/market-state', async (context) => {
  const input = await context.req.json()
  if (input.book) bookState = input.book
  if (input.history) historyState = input.history
  if (input.disabled === true) disabled = true
  if (input.disabled === false) disabled = false
  return context.json({ bookState, historyState, disabled })
})
app.get('/api/modules/market/catalogue/revision', (context) => {
  const etag = `W/"${currentKey}"`
  context.header('ETag', etag)
  context.header('Cache-Control', 'public, max-age=30, must-revalidate')
  if (context.req.header('If-None-Match') === etag) return context.body(null, 304)
  return context.json({ key: currentKey, revision: currentRevision })
})
app.get('/api/modules/market/catalogue/body/:revision/tree', (context) => {
  if (context.req.param('revision') !== currentKey)
    return context.json({ code: 'REVISION_MISSING' }, 404)
  const etag = `W/"${currentKey}-tree"`
  context.header('ETag', etag)
  context.header('Cache-Control', 'public, max-age=31536000, immutable')
  if (context.req.header('If-None-Match') === etag) return context.body(null, 304)
  return context.json({ kind: 'tree', complete: true, revision: currentRevision, groups })
})
app.get('/api/modules/market/catalogue/body/:revision/groups/:groupId/types', (context) => {
  if (context.req.param('revision') !== currentKey)
    return context.json({ code: 'REVISION_MISSING' }, 404)
  const cursor = context.req.query('cursor')
  const start = cursor ? Number.parseInt(cursor.slice(2), 36) + 1 : 1
  const items = Array.from({ length: 100 }, (_, index) => ({
    id: start + index,
    groupId: 3,
    name: `Group item ${start + index}`,
  }))
  return context.json({
    kind: 'group-types',
    groupId: 3,
    revision: currentRevision,
    items,
    nextCursor: start + 100 < 229 ? `t_${(start + 99).toString(36)}` : null,
  })
})
app.get('/api/modules/market/catalogue/body/:revision/search-index', (context) => {
  if (context.req.param('revision') !== currentKey)
    return context.json({ code: 'REVISION_MISSING' }, 404)
  return context.json({ kind: 'search-index', complete: true, revision: currentRevision, types })
})
app.get('/api/modules/market/catalogue/body/:revision/types/:typeId', (context) => {
  if (context.req.param('revision') !== currentKey)
    return context.json({ code: 'REVISION_MISSING' }, 404)
  const id = Number(context.req.param('typeId'))
  const item =
    types.find((entry) => entry.id === id) ??
    (id >= 1 && id <= 228 ? { id, groupId: 3, name: `Group item ${id}` } : null)
  if (!item) return context.json({ code: 'MARKET_TYPE_UNAVAILABLE' }, 404)
  return context.json({ kind: 'type-by-id', complete: true, item, revision: currentRevision })
})
app.get('/api/modules/market/books/profiles', (context) => {
  context.header('Cache-Control', 'no-store')
  return context.json({ profiles: profileRows })
})
app.get('/api/modules/market/books/profiles/:profileId/types/:typeId/observation', (context) => {
  context.header('Cache-Control', 'no-store')
  if (
    !profileRows.some((entry) => entry.profileId === context.req.param('profileId')) ||
    bookState === 'unavailable'
  )
    return context.json({ code: 'MARKET_PROFILE_UNAVAILABLE' }, 404)
  if (bookState === 'uncollected')
    return context.json({ status: 'uncollected', collectionStatus: 'ready', replacement: null })
  const typeId = Number(context.req.param('typeId'))
  const empty =
    bookState === 'empty' ||
    typeId === 35 ||
    (typeId === 44992 && context.req.param('profileId') !== profileC)
  return context.json({
    status: bookState === 'stale' || bookState === 'failed' ? 'stale' : 'current',
    collectionStatus: bookState === 'failed' ? 'profile-failed' : 'ready',
    replacement:
      bookState === 'failed'
        ? { status: 'incomplete', attemptedAt: '2026-09-29T00:00:00.000Z' }
        : null,
    observation: {
      observationId,
      profileId: context.req.param('profileId'),
      regionId: context.req.param('profileId') === profileC ? 19000001 : 10000002,
      typeId,
      observedAt: '2026-09-28T00:00:00.000Z',
      validatedAt: '2026-09-28T00:01:00.000Z',
      freshUntil:
        bookState === 'complete' || empty ? '2099-01-01T00:00:00.000Z' : '2026-09-28T00:05:00.000Z',
      expectedPages: 1,
      totalBookOrders: observationOrderCount(typeId, empty),
    },
    ...bookOrderRows(typeId, empty),
  })
})
app.get(
  '/api/modules/market/books/profiles/:profileId/types/:typeId/observations/:observationId/orders',
  (context) => {
    context.header('Cache-Control', 'no-store')
    if (
      context.req.param('observationId') !== observationId ||
      context.req.param('typeId') !== '40520'
    )
      return context.json({ code: 'MARKET_OBSERVATION_UNAVAILABLE' }, 404)
    return context.json({
      observationId,
      rows: [101, 102, 103].map((id) => order(id, 'sell', `${id}.00`)),
      hasMore: false,
    })
  },
)
app.get('/api/modules/market/history/profiles/:profileId/types/:typeId', (context) => {
  context.header('Cache-Control', 'no-store')
  if (historyState === 'unavailable')
    return context.json({ code: 'MARKET_HISTORY_PROFILE_UNAVAILABLE' }, 404)
  return context.json({
    status: historyState === 'uncollected' ? 'uncollected' : 'observed',
    freshness: historyState === 'uncollected' ? 'uncollected' : 'current',
    regionId: context.req.param('profileId') === profileC ? 19000001 : 10000002,
    typeId: Number(context.req.param('typeId')),
    validatedAt: historyState === 'uncollected' ? null : '2026-09-28T00:00:00.000Z',
    freshUntil: historyState === 'uncollected' ? null : '2099-01-01T00:00:00.000Z',
    days:
      historyState === 'uncollected' ? [] : historyState === 'one-day' ? days.slice(0, 1) : days,
  })
})
app.notFound((context) => context.json({ code: 'NOT_FOUND' }, 404))

if (import.meta.main) serve({ fetch: app.fetch, port })
