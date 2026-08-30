import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const values = new Map<string, string>()
  return {
    values,
    mget: vi.fn(async (...keys: string[]) => keys.map((key) => values.get(key) ?? null)),
    multi: vi.fn(() => {
      const commands: Array<() => void> = []
      const transaction = {
        set: vi.fn((key: string, value: string) => {
          commands.push(() => values.set(key, value))
          return transaction
        }),
        del: vi.fn((key: string) => {
          commands.push(() => values.delete(key))
          return transaction
        }),
        exec: vi.fn(async () => {
          for (const command of commands) command()
          return []
        }),
      }
      return transaction
    }),
  }
})

vi.mock('../../src/env.js', () => ({ env: { ESI_COMPATIBILITY_DATE: '2026-08-23' } }))
vi.mock('../../src/esi-resilience/cache-redis.js', () => ({
  getSharedCacheRedisConnection: () => ({ mget: mocks.mget, multi: mocks.multi }),
}))

beforeEach(() => {
  mocks.values.clear()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('universe resolution cache', () => {
  test('persists successful names independently and reuses them as fresh values', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-30T09:00:00.000Z')
    const { readUniverseNames, writeUniverseNames } =
      await import('../../src/universe/resolution-cache.js')
    const entry = { category: 'character', id: 90_666_561, name: 'Pilot' }

    await writeUniverseNames([entry])

    const cached = await readUniverseNames([entry.id])
    expect(cached.fresh).toEqual(new Map([[entry.id, entry]]))
    expect(cached.stale).toEqual(new Map())
    const transaction = mocks.multi.mock.results[0]!.value
    expect(transaction.set).toHaveBeenCalledWith(
      expect.stringContaining(':name:positive:90666561'),
      JSON.stringify({ freshUntil: Date.parse('2026-08-30T10:00:00.000Z'), value: entry }),
      'EX',
      7_200,
    )
  })

  test('keeps a positive value available when a negative marker suppresses refresh', async () => {
    const { readUniverseNames, suppressUniverseNameIds, writeUniverseNames } =
      await import('../../src/universe/resolution-cache.js')
    const entry = { category: 'character', id: 90_666_561, name: 'Pilot' }
    await writeUniverseNames([entry])
    const positiveKey = [...mocks.values.keys()].find((key) => key.includes(':positive:'))!
    const positive = JSON.parse(mocks.values.get(positiveKey)!)
    mocks.values.set(positiveKey, JSON.stringify({ ...positive, freshUntil: Date.now() - 1 }))

    await suppressUniverseNameIds([entry.id])

    const cached = await readUniverseNames([entry.id])
    expect(cached.stale).toEqual(new Map([[entry.id, entry]]))
    expect(cached.suppressed).toEqual(new Set([entry.id]))
    const transaction = mocks.multi.mock.results[1]!.value
    expect(transaction.set).toHaveBeenCalledWith(
      expect.stringContaining(':name:negative:90666561'),
      '1',
      'EX',
      120,
    )
  })

  test('stores ID lookups by normalized input name', async () => {
    const { readUniverseIds, writeUniverseIds } =
      await import('../../src/universe/resolution-cache.js')
    const entry = { category: 'character', id: 7, name: 'Known Pilot' }
    await writeUniverseIds(new Map([['Known Pilot', [entry]]]))

    const cached = await readUniverseIds(['  known pilot  '])

    expect(cached.fresh.get('  known pilot  ')).toEqual([entry])
  })

  test('uses locale-independent persisted keys for ID lookups', async () => {
    const { readUniverseIds, writeUniverseIds } =
      await import('../../src/universe/resolution-cache.js')
    const entry = { category: 'corporation', id: 7, name: 'IPO Holdings' }
    const localeSpy = vi.spyOn(String.prototype, 'toLocaleLowerCase').mockReturnValue('wrong')

    await writeUniverseIds(new Map([['IPO Holdings', [entry]]]))
    localeSpy.mockRestore()

    const cached = await readUniverseIds(['IPO Holdings'])
    expect(cached.fresh.get('IPO Holdings')).toEqual([entry])
  })
})
