import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  where: vi.fn(),
}))

vi.mock('../../src/db/client.js', () => ({ db: { select: mocks.select } }))

beforeEach(() => {
  mocks.select.mockReturnValue({ from: mocks.from })
  mocks.from.mockReturnValue({ where: mocks.where })
  mocks.where.mockResolvedValue([])
})

describe('Finance type-name lookup', () => {
  test('deduplicates IDs and returns query rows by identity rather than row order', async () => {
    mocks.where.mockResolvedValue([
      { typeId: 36, typeName: 'Mexallon' },
      { typeId: 34, typeName: 'Tritanium' },
    ])
    const { financeTypeName, loadFinanceTypeNames } =
      await import('../../src/characters/finance-type-names.js')

    const names = await loadFinanceTypeNames([34, 36, 34])

    expect(names).toEqual(
      new Map([
        [36, 'Mexallon'],
        [34, 'Tritanium'],
      ]),
    )
    expect(financeTypeName(34, names)).toBe('Tritanium')
    expect(financeTypeName(35, names)).toBe('Unknown type 35')
    expect(mocks.select).toHaveBeenCalledOnce()
    expect(mocks.where).toHaveBeenCalledOnce()
  })

  test('does not query for an empty collection', async () => {
    const { loadFinanceTypeNames } = await import('../../src/characters/finance-type-names.js')

    await expect(loadFinanceTypeNames([])).resolves.toEqual(new Map())
    expect(mocks.select).not.toHaveBeenCalled()
  })

  test('loads more than 1,000 unique IDs in bounded query batches', async () => {
    mocks.where
      .mockResolvedValueOnce([{ typeId: 1, typeName: 'First type' }])
      .mockResolvedValueOnce([{ typeId: 1_001, typeName: 'Next batch type' }])
    const { loadFinanceTypeNames } = await import('../../src/characters/finance-type-names.js')

    await expect(
      loadFinanceTypeNames(Array.from({ length: 1_001 }, (_, index) => index + 1)),
    ).resolves.toEqual(
      new Map([
        [1, 'First type'],
        [1_001, 'Next batch type'],
      ]),
    )
    expect(mocks.select).toHaveBeenCalledTimes(2)
    expect(mocks.where).toHaveBeenCalledTimes(2)
  })

  test.each([0, -1, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid type ID %s before querying',
    async (typeId) => {
      const { loadFinanceTypeNames } = await import('../../src/characters/finance-type-names.js')

      await expect(loadFinanceTypeNames([typeId])).rejects.toThrow(
        'Finance type lookup IDs must be positive safe integers',
      )
      expect(mocks.select).not.toHaveBeenCalled()
    },
  )
})
