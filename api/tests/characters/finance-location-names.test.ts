import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ resolveUniverseNames: vi.fn() }))

vi.mock('../../src/universe/names.js', () => ({
  resolveUniverseNames: mocks.resolveUniverseNames,
}))

beforeEach(() => {
  mocks.resolveUniverseNames.mockReset()
  mocks.resolveUniverseNames.mockResolvedValue(new Map())
})

describe('finance location names', () => {
  test('resolves station identifiers once each and maps them to their names', async () => {
    mocks.resolveUniverseNames.mockResolvedValue(
      new Map([
        [60_000_001, { id: 60_000_001, name: 'Jita IV - Moon 4', category: 'station' }],
        [60_000_002, { id: 60_000_002, name: 'Amarr VIII', category: 'station' }],
      ]),
    )
    const { financeLocationName, loadFinanceLocationNames } =
      await import('../../src/characters/finance-location-names.js')

    const names = await loadFinanceLocationNames([60_000_001, 60_000_002, 60_000_001])

    expect(mocks.resolveUniverseNames).toHaveBeenCalledWith([60_000_001, 60_000_002])
    expect(financeLocationName(60_000_001, names)).toBe('Jita IV - Moon 4')
    expect(financeLocationName(60_000_002, names)).toBe('Amarr VIII')
  })

  test('never submits Upwell structure identifiers the requested scopes cannot resolve', async () => {
    const { loadFinanceLocationNames } =
      await import('../../src/characters/finance-location-names.js')

    const names = await loadFinanceLocationNames([1_035_466_617_946, 0, -1, Number.NaN])

    expect(mocks.resolveUniverseNames).not.toHaveBeenCalled()
    expect(names.size).toBe(0)
  })

  test('degrades to unnamed locations when resolution fails', async () => {
    mocks.resolveUniverseNames.mockRejectedValue(new Error('universe resolution unavailable'))
    const { financeLocationName, loadFinanceLocationNames } =
      await import('../../src/characters/finance-location-names.js')

    const names = await loadFinanceLocationNames([60_000_001])

    expect(names.size).toBe(0)
    expect(financeLocationName(60_000_001, names)).toBeNull()
  })
})
