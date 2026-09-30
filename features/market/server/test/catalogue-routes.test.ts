import { gzipSync } from 'node:zlib'
import { describe, expect, test, vi } from 'vitest'
import { catalogueRoutes } from '../src/catalogue-routes.js'

const revision = {
  buildNumber: 3542233,
  ingestVersion: 5,
  ingestedAt: '2026-09-24 12:00:00.123456+00',
}
const tree = {
  kind: 'tree',
  complete: true,
  revision,
  groups: [{ id: 19, parentId: null, name: 'Trade Goods', iconId: null, directTypeCount: 1 }],
}
const page = {
  kind: 'group-types',
  groupId: 19,
  revision,
  nextCursor: null,
  items: [{ id: 47450, groupId: 19, name: 'Compressed Capsule Shell' }],
}
const index = { kind: 'search-index', complete: true, revision, types: page.items }
const typeById = { kind: 'type-by-id', complete: true, revision, item: page.items[0] }

const routes = (
  marketCatalogue = vi.fn(async ({ kind }: { kind: string }) => {
    if (kind === 'tree') return tree
    if (kind === 'group-types') return page
    if (kind === 'type-by-id') return typeById
    return index
  }),
) => ({
  app: catalogueRoutes({
    coreData: { marketCatalogue },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }),
  marketCatalogue,
})

describe('public Market catalogue routes', () => {
  test('revalidates discovery and caches tree, page, and search independently', async () => {
    const { app, marketCatalogue } = routes()
    const discovery = await app.request('/revision')
    expect(discovery.status).toBe(200)
    expect(discovery.headers.get('Cache-Control')).toBe('public, max-age=30, must-revalidate')
    const { key } = await discovery.json()
    const revised = await app.request('/revision', {
      headers: { 'If-None-Match': discovery.headers.get('ETag')! },
    })
    expect(revised.status).toBe(304)

    for (const [path, expected] of [
      [`/body/${key}/tree`, tree],
      [`/body/${key}/groups/19/types`, page],
      [`/body/${key}/search-index`, index],
      [`/body/${key}/types/47450`, typeById],
    ] as const) {
      const response = await app.request(path)
      expect(response.status).toBe(200)
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
      expect(await response.json()).toEqual(expected)
      const revalidated = await app.request(path, {
        headers: { 'If-None-Match': response.headers.get('ETag')! },
      })
      expect(revalidated.status).toBe(304)
      expect(revalidated.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    }
    expect(marketCatalogue).toHaveBeenCalledTimes(10)
    const nextPage = await app.request(`/body/${key}/groups/19/types?cursor=t_abc`)
    expect(nextPage.status).toBe(200)
    expect(marketCatalogue).toHaveBeenLastCalledWith({
      kind: 'group-types',
      groupId: 19,
      cursor: 't_abc',
    })
  })

  test('rejects an old same-build URL instead of returning a new revision body', async () => {
    let currentRevision = revision
    const marketCatalogue = vi.fn(async ({ kind }: { kind: string }) => ({
      ...(kind === 'tree' ? tree : index),
      revision: currentRevision,
    }))
    const { app } = routes(marketCatalogue)
    const { key } = await (await app.request('/revision')).json()
    currentRevision = { ...revision, ingestedAt: '2026-09-24 12:01:00.000001+00' }
    const old = await app.request(`/body/${key}/tree`)
    expect(old.status).toBe(404)
    expect(old.headers.get('Cache-Control')).toBe('no-store')
    const next = await (await app.request('/revision')).json()
    expect(next.key).not.toBe(key)
  })

  test('validates group and cursor before product reads and reports unavailability', async () => {
    const { app, marketCatalogue } = routes()
    const { key } = await (await app.request('/revision')).json()
    marketCatalogue.mockClear()
    const badGroup = await app.request(`/body/${key}/groups/invalid/types`)
    const badCursor = await app.request(`/body/${key}/groups/19/types?cursor=nope`)
    const badType = await app.request(`/body/${key}/types/0`)
    expect(badGroup.status).toBe(400)
    expect(badCursor.status).toBe(400)
    expect(badType.status).toBe(400)
    expect(marketCatalogue).not.toHaveBeenCalled()

    const unavailable = routes(vi.fn().mockRejectedValue(new Error('database unavailable')))
    const response = await unavailable.app.request('/revision')
    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  test('reports a no-longer-marketable direct type without treating it as an empty book', async () => {
    const marketCatalogue = vi.fn(async ({ kind }: { kind: string }) =>
      kind === 'tree' ? tree : { ...typeById, item: null },
    )
    const { app } = routes(marketCatalogue)
    const { key } = await (await app.request('/revision')).json()
    const response = await app.request(`/body/${key}/types/47450`)
    expect(response.status).toBe(404)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ code: 'MARKET_TYPE_UNAVAILABLE' })
  })

  test('bounds a 32,000-type search-index representation on intent', async () => {
    const types = Array.from({ length: 32_000 }, (_, number) => ({
      id: number + 1,
      groupId: 19,
      name: `Synthetic Market Type ${number}`,
    }))
    const marketCatalogue = vi.fn(async ({ kind }: { kind: string }) =>
      kind === 'tree' ? tree : { ...index, types },
    )
    const { app } = routes(marketCatalogue)
    const { key } = await (await app.request('/revision')).json()
    const response = await app.request(`/body/${key}/search-index`)
    const bytes = await response.text()
    expect(response.status).toBe(200)
    expect(new TextEncoder().encode(bytes).byteLength).toBeLessThan(3_000_000)
    expect(gzipSync(bytes).byteLength).toBeLessThan(350_000)
    expect(marketCatalogue).toHaveBeenCalledTimes(2)
  })

  test.each([
    't_0',
    't_000000000000',
    't_zzzzzzzzzzzz',
    `t_${(Number.MAX_SAFE_INTEGER + 1).toString(36)}`,
  ])('rejects out-of-range cursor %s before calling the product', async (cursor) => {
    const { app, marketCatalogue } = routes(
      vi.fn(() => {
        throw new TypeError('Product must not receive invalid input')
      }),
    )
    const response = await app.request(`/body/revision/groups/19/types?cursor=${cursor}`)
    expect(response.status).toBe(400)
    expect(await response.text()).toBe('Invalid market group cursor')
    expect(marketCatalogue).not.toHaveBeenCalled()
  })

  test.each(['t_1', `t_${Number.MAX_SAFE_INTEGER.toString(36)}`])(
    'accepts positive safe-integer cursor %s',
    async (cursor) => {
      const { app, marketCatalogue } = routes()
      const { key } = await (await app.request('/revision')).json()
      const response = await app.request(`/body/${key}/groups/19/types?cursor=${cursor}`)
      expect(response.status).toBe(200)
      expect(marketCatalogue).toHaveBeenLastCalledWith({ kind: 'group-types', groupId: 19, cursor })
    },
  )

  test('rejects unsafe group IDs before calling the catalogue product', async () => {
    const { app, marketCatalogue } = routes()
    const { key } = await (await app.request('/revision')).json()
    marketCatalogue.mockClear()
    const response = await app.request(`/body/${key}/groups/9007199254740992/types`)
    expect(response.status).toBe(400)
    expect(marketCatalogue).not.toHaveBeenCalled()
  })
})
