import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  innerJoin: vi.fn(),
  limit: vi.fn(),
  orderBy: vi.fn(),
  results: [] as unknown[][],
  select: vi.fn(),
  where: vi.fn(),
}))

vi.mock('../src/db/client.js', () => ({ db: { select: mocks.select } }))

beforeEach(() => {
  mocks.results.splice(0)
  mocks.select.mockReturnValue({ from: mocks.from })
  mocks.from.mockReturnValue({ innerJoin: mocks.innerJoin, where: mocks.where })
  mocks.innerJoin.mockReturnValue({ where: mocks.where })
  mocks.where.mockReturnValue({ limit: mocks.limit, orderBy: mocks.orderBy })
  mocks.orderBy.mockReturnValue({ limit: mocks.limit })
  mocks.limit.mockImplementation(async () => mocks.results.shift() ?? [])
})

describe('owned-character core reads', () => {
  test('returns only request-bound affiliation fields', async () => {
    mocks.results.push([
      {
        characterId: 90_000_001,
        corporationId: 98_000_001,
        allianceId: 99_000_001,
        checkedAt: new Date('2026-08-25T12:00:00Z'),
        resolutionState: 'resolved',
      },
    ])
    const { createOwnedCharacterCoreReads } =
      await import('../src/platform/core-read-capabilities.js')

    await expect(
      createOwnedCharacterCoreReads({
        userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
        characterId: 90_000_001,
        subjectLifecycleId: 'de1e1285-0d02-4dd0-9ca4-c3b7a28e0011',
      }).loadAffiliation(),
    ).resolves.toEqual({
      characterId: 90_000_001,
      corporationId: 98_000_001,
      allianceId: 99_000_001,
      checkedAt: '2026-08-25T12:00:00.000Z',
      resolutionState: 'resolved',
    })
  })

  test('returns null when the bound ownership no longer exists', async () => {
    mocks.results.push([])
    const { createOwnedCharacterCoreReads } =
      await import('../src/platform/core-read-capabilities.js')

    await expect(
      createOwnedCharacterCoreReads({
        userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
        characterId: 90_000_001,
        subjectLifecycleId: 'de1e1285-0d02-4dd0-9ca4-c3b7a28e0011',
      }).loadAffiliation(),
    ).resolves.toBeNull()
  })
})

describe('SDE core reads', () => {
  test('returns complete published type and group references', async () => {
    mocks.results.push([
      { typeId: 34, typeName: 'Tritanium', groupId: 18, groupName: 'Mineral' },
      { typeId: 35, typeName: 'Pyerite', groupId: 18, groupName: 'Mineral' },
    ])
    const { sdeCoreReads } = await import('../src/platform/core-read-capabilities.js')

    await expect(sdeCoreReads.loadPublishedTypeGroups([35, 34, 35])).resolves.toEqual([
      { typeId: 34, typeName: 'Tritanium', groupId: 18, groupName: 'Mineral' },
      { typeId: 35, typeName: 'Pyerite', groupId: 18, groupName: 'Mineral' },
    ])
    expect(mocks.select).toHaveBeenCalledOnce()
  })

  test('returns an empty result without querying PostgreSQL', async () => {
    const { sdeCoreReads } = await import('../src/platform/core-read-capabilities.js')

    await expect(sdeCoreReads.loadPublishedTypeGroups([])).resolves.toEqual([])
    expect(mocks.select).not.toHaveBeenCalled()
  })

  test.each([
    [[0], 'positive safe integers'],
    [[1.5], 'positive safe integers'],
    [[Number.MAX_SAFE_INTEGER + 1], 'positive safe integers'],
    [Array.from({ length: 501 }, (_, index) => index + 1), 'cannot exceed 500 IDs'],
  ])('rejects unbounded or invalid IDs before querying PostgreSQL', async (typeIds, message) => {
    const { sdeCoreReads } = await import('../src/platform/core-read-capabilities.js')

    await expect(sdeCoreReads.loadPublishedTypeGroups(typeIds)).rejects.toThrow(message)
    expect(mocks.select).not.toHaveBeenCalled()
  })
})
