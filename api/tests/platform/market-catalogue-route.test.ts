import { gunzipSync } from 'node:zlib'
import type {
  MarketCatalogueRequest,
  MarketCatalogueResult,
  MarketCatalogueTreeResult,
} from '@eve-space/core-data-contract'
import { catalogueRoutes } from '@eve-space/market-server'
import { Hono } from 'hono'
import { beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ isInstalledModuleContributionEnabled: vi.fn() }))
vi.mock('../../src/platform/module-settings.js', () => ({
  isInstalledModuleContributionEnabled: mocks.isInstalledModuleContributionEnabled,
}))

import { platformModuleRouteComposers } from '../../src/platform/module-route-composition.js'

const tree = {
  kind: 'tree',
  complete: true,
  groups: [{ id: 19, parentId: null, name: 'Trade Goods', iconId: null, directTypeCount: 1 }],
  revision: { buildNumber: 3542233, ingestVersion: 5, ingestedAt: '2026-09-24 12:00:00+00' },
} satisfies MarketCatalogueTreeResult
const marketCatalogue = vi.fn(
  async (request: MarketCatalogueRequest): Promise<MarketCatalogueResult> => {
    if (request.kind === 'group-types') {
      return {
        kind: 'group-types',
        groupId: 19,
        items: [],
        nextCursor: null,
        revision: tree.revision,
      }
    }
    if (request.kind === 'search-index') {
      return { kind: 'search-index', complete: true, types: [], revision: tree.revision }
    }
    if (request.kind === 'type-by-id') {
      return {
        kind: 'type-by-id',
        complete: true,
        item: { id: request.typeId, groupId: 19, name: 'Published item' },
        revision: tree.revision,
      }
    }
    return tree
  },
)
const app = new Hono().route(
  '/api/modules/market/catalogue',
  platformModuleRouteComposers.public(
    'market',
    catalogueRoutes({
      coreData: { marketCatalogue },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }),
  ),
)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isInstalledModuleContributionEnabled.mockResolvedValue(true)
})

test('serves conditional public Market headers through the host composer', async () => {
  const discovery = await app.request('/api/modules/market/catalogue/revision')
  expect(discovery.status).toBe(200)
  expect(discovery.headers.get('Cache-Control')).toBe('public, max-age=30, must-revalidate')
  const { key } = await discovery.json()
  const body = await app.request(`/api/modules/market/catalogue/body/${key}/tree`)
  expect(body.status).toBe(200)
  expect(body.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
  const revalidated = await app.request(`/api/modules/market/catalogue/body/${key}/tree`, {
    headers: { 'If-None-Match': body.headers.get('ETag')! },
  })
  expect(revalidated.status).toBe(304)
  expect(revalidated.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
  for (const path of [
    `/api/modules/market/catalogue/body/${key}/groups/19/types`,
    `/api/modules/market/catalogue/body/${key}/search-index`,
    `/api/modules/market/catalogue/body/${key}/types/34`,
  ]) {
    const response = await app.request(path)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
  }
  expect(marketCatalogue).toHaveBeenCalledTimes(6)
})

test('blocks the disabled release before it can read the catalogue', async () => {
  mocks.isInstalledModuleContributionEnabled.mockResolvedValue(false)
  const response = await app.request('/api/modules/market/catalogue/revision')
  expect(response.status).toBe(404)
  expect((await app.request('/api/modules/market/catalogue/body/old/types/35912')).status).toBe(404)
  expect(marketCatalogue).not.toHaveBeenCalled()
})

test('validates type IDs and rejects unavailable and obsolete type bodies', async () => {
  const { key } = await (await app.request('/api/modules/market/catalogue/revision')).json()
  marketCatalogue.mockClear()
  expect((await app.request(`/api/modules/market/catalogue/body/${key}/types/0`)).status).toBe(400)
  expect(marketCatalogue).not.toHaveBeenCalled()
  expect((await app.request('/api/modules/market/catalogue/body/old/types/35912')).status).toBe(404)
  marketCatalogue.mockResolvedValueOnce({
    kind: 'type-by-id',
    complete: true,
    item: null,
    revision: tree.revision,
  })
  const missing = await app.request(`/api/modules/market/catalogue/body/${key}/types/35912`)
  expect(missing.status).toBe(404)
  expect(missing.headers.get('Cache-Control')).toBe('no-store')
  expect(await missing.json()).toEqual({ code: 'MARKET_TYPE_UNAVAILABLE' })
})

test('compresses a public body on the wire while keeping revision-pinned cache identity', async () => {
  const largeTree = {
    ...tree,
    groups: Array.from({ length: 200 }, (_, id) => ({
      id: id + 1,
      parentId: null,
      name: `Market Group ${id}`,
      iconId: null,
      directTypeCount: 0,
    })),
  }
  marketCatalogue.mockResolvedValueOnce(tree).mockResolvedValueOnce(largeTree)
  const { key } = await (await app.request('/api/modules/market/catalogue/revision')).json()
  const response = await app.request(`/api/modules/market/catalogue/body/${key}/tree`, {
    headers: { 'Accept-Encoding': 'gzip' },
  })
  expect(response.status).toBe(200)
  expect(response.headers.get('Content-Encoding')).toBe('gzip')
  expect(response.headers.get('Vary')).toContain('Accept-Encoding')
  expect(response.headers.get('ETag')).toMatch(/^W\//)
  const decoded = JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())).toString())
  expect(decoded).toEqual(largeTree)
})
