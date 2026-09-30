import { describe, expect, test, vi } from 'vitest'
import { createMarketSearch } from '../src/runtime/app/market-search'
import type { MarketType } from '../src/runtime/app/market-catalogue-types'

const items: MarketType[] = [
  { id: 587, groupId: 1, name: 'Rifter' },
  { id: 34, groupId: 2, name: 'Tritanium' },
  { id: 588, groupId: 1, name: 'Rifter Blueprint' },
  { id: 999, groupId: 3, name: 'Compressed Capsule Shell' },
]

describe('revision-keyed Market search', () => {
  test('ranks exact ID/name and prefix ahead of fuzzy suggestions', async () => {
    const worker = {
      search: vi.fn(async () => [
        { item: items[3]!, score: 0.01 },
        { item: items[2]!, score: 0.02 },
        { item: items[0]!, score: 0.8 },
      ]),
      terminate: vi.fn(),
    }
    const search = createMarketSearch(items, worker)
    expect((await search.search('rifter')).map(({ id }) => id)).toEqual([587, 588, 999])
    expect((await search.search('587'))[0]?.id).toBe(587)
    expect(worker.search).toHaveBeenCalledWith('587', { limit: 100 })
    search.dispose()
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  test('keeps multi-token and minor-typo candidates', async () => {
    const worker = {
      search: vi.fn(async () => [{ item: items[3]!, score: 0.2 }]),
      terminate: vi.fn(),
    }
    const search = createMarketSearch(items, worker)
    expect((await search.search('capsule shell'))[0]?.id).toBe(999)
    expect((await search.search('riftr'))[0]?.id).toBe(999)
    search.dispose()
    expect(await search.search('Rifter')).toEqual([])
  })

  test('limits visible results to twenty without a network request', async () => {
    const many = Array.from({ length: 100 }, (_, id) => ({
      id: id + 1,
      groupId: 1,
      name: `Ore ${id}`,
    }))
    const worker = {
      search: vi.fn(async () => many.map((item) => ({ item, score: 0.1 }))),
      terminate: vi.fn(),
    }
    const search = createMarketSearch(many, worker)
    expect(await search.search('ore')).toHaveLength(20)
    expect(worker.search).toHaveBeenCalledOnce()
  })
})
