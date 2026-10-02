import { expect, it, vi } from 'vitest'
import { marketCatalogueRevisionKey, readMarketCatalogue } from '../src/catalogue-reads.js'

const revision = { buildNumber: 42, ingestVersion: 6, ingestedAt: '2026-09-28T12:00:00Z' }
const page = {
  kind: 'group-types' as const,
  groupId: 18,
  revision,
  items: [{ id: 34, groupId: 18, name: 'Tritanium' }],
  nextCursor: 'opaque-continuation',
}
const key = marketCatalogueRevisionKey(page)

it('returns a correlated short page with the continuation owned by core', async () => {
  const coreData = { marketCatalogue: vi.fn().mockResolvedValue(page) }
  const request = { kind: 'group-types' as const, groupId: 18, pageSize: 1 }
  const outcome = await readMarketCatalogue(coreData, request, key)
  expect(outcome).toEqual({ ok: true, key, value: page })
  expect(coreData.marketCatalogue).toHaveBeenCalledWith(request)
  if (!outcome.ok) throw new Error('Expected a catalogue page')
  expect(outcome.value.nextCursor).toBe('opaque-continuation')
})

it('classifies revision mismatch before a missing type', async () => {
  const coreData = {
    marketCatalogue: vi
      .fn()
      .mockResolvedValue({ kind: 'type-by-id', revision, complete: true, item: null }),
  }
  await expect(
    readMarketCatalogue(coreData, { kind: 'type-by-id', typeId: 34 }, 'obsolete'),
  ).resolves.toEqual({ ok: false, code: 'MARKET_CATALOGUE_REVISION_MISSING', status: 404 })
  await expect(
    readMarketCatalogue(coreData, { kind: 'type-by-id', typeId: 34 }, key),
  ).resolves.toEqual({ ok: false, code: 'MARKET_TYPE_UNAVAILABLE', status: 404 })
})

it('classifies unavailable and mismatched source results at the read seam', async () => {
  const coreData = {
    marketCatalogue: vi
      .fn()
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValue(page),
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await expect(readMarketCatalogue(coreData, { kind: 'revision' })).resolves.toEqual({
      ok: false,
      code: 'MARKET_CATALOGUE_UNAVAILABLE',
      status: 503,
    })
  }
})
