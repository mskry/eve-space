import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listCorporationHistory: vi.fn(),
  resolveNames: vi.fn(),
}))

vi.mock('@evespace/esi-client/domains/character', () => ({
  createCharacterClient: () => ({ listCorporationHistory: mocks.listCorporationHistory }),
}))

vi.mock('@evespace/esi-client/domains/universe', () => ({
  createUniverseClient: () => ({ resolveNames: mocks.resolveNames }),
}))

import { getCharacterEmploymentHistory } from '../src/character-history-service.js'

beforeEach(() => {
  mocks.listCorporationHistory.mockResolvedValue([])
  mocks.resolveNames.mockResolvedValue([])
})

describe('character employment history service', () => {
  test('deduplicates corporation IDs and resolves names without reordering ESI records', async () => {
    mocks.listCorporationHistory.mockResolvedValue([
      { corporation_id: 2, record_id: 2, start_date: '2020-01-01T00:00:00Z' },
      { corporation_id: 1, record_id: 3, start_date: '2024-01-01T00:00:00Z' },
      { corporation_id: 2, record_id: 1, start_date: '2018-01-01T00:00:00Z' },
    ])
    mocks.resolveNames.mockResolvedValue([
      { category: 'corporation', id: 2, name: 'Second Corporation' },
      { category: 'character', id: 1, name: 'Wrong category' },
      { category: 'corporation', id: 1, name: 'First Corporation' },
    ])

    const history = await getCharacterEmploymentHistory(90_000_101)

    expect(mocks.resolveNames).toHaveBeenCalledWith({ body: [2, 1] })
    expect(history.map((entry) => entry.recordId)).toEqual([2, 3, 1])
    expect(history[0]?.corporation.name).toBe('Second Corporation')
    expect(history[1]?.corporation.name).toBe('First Corporation')
  })

  test('retains deleted and unresolved records when name enrichment fails', async () => {
    mocks.listCorporationHistory.mockResolvedValue([
      {
        corporation_id: 3,
        is_deleted: true,
        record_id: 2,
        start_date: '2022-01-01T00:00:00Z',
      },
      { corporation_id: 4, record_id: 1, start_date: '2020-01-01T00:00:00Z' },
    ])
    mocks.resolveNames.mockRejectedValue(new Error('ESI unavailable'))

    const history = await getCharacterEmploymentHistory(90_000_102)

    expect(mocks.resolveNames).toHaveBeenCalledWith({ body: [4] })
    expect(history).toEqual([
      {
        recordId: 2,
        startDate: '2022-01-01T00:00:00Z',
        isDeleted: true,
        corporation: { id: 3, name: 'Deleted corporation', isNpc: true },
      },
      {
        recordId: 1,
        startDate: '2020-01-01T00:00:00Z',
        isDeleted: false,
        corporation: { id: 4, name: 'Unknown corporation', isNpc: true },
      },
    ])
  })

  test('does not split transient name-resolution failures into additional ESI requests', async () => {
    mocks.listCorporationHistory.mockResolvedValue([
      { corporation_id: 10, record_id: 3, start_date: '2024-01-01T00:00:00Z' },
      { corporation_id: 20, record_id: 2, start_date: '2023-01-01T00:00:00Z' },
      { corporation_id: 30, record_id: 1, start_date: '2022-01-01T00:00:00Z' },
    ])
    mocks.resolveNames.mockRejectedValue({ status: 503 })

    const history = await getCharacterEmploymentHistory(90_000_106)

    expect(history.map((entry) => entry.corporation.name)).toEqual([
      'Unknown corporation',
      'Unknown corporation',
      'Unknown corporation',
    ])
    expect(mocks.resolveNames).toHaveBeenCalledOnce()
    expect(mocks.resolveNames).toHaveBeenCalledWith({ body: [10, 20, 30] })
  })

  test('splits deterministic invalid-ID batches so valid names survive', async () => {
    mocks.listCorporationHistory.mockResolvedValue([
      { corporation_id: 40, record_id: 3, start_date: '2024-01-01T00:00:00Z' },
      { corporation_id: 50, record_id: 2, start_date: '2023-01-01T00:00:00Z' },
      { corporation_id: 60, record_id: 1, start_date: '2022-01-01T00:00:00Z' },
    ])
    mocks.resolveNames.mockImplementation(async ({ body }: { body: number[] }) => {
      if (body.includes(50)) throw { status: 404 }
      return body.map((id) => ({ category: 'corporation', id, name: `Corporation ${id}` }))
    })

    const history = await getCharacterEmploymentHistory(90_000_107)

    expect(history.map((entry) => entry.corporation.name)).toEqual([
      'Corporation 40',
      'Unknown corporation',
      'Corporation 60',
    ])
    expect(mocks.resolveNames).toHaveBeenCalledTimes(5)
  })

  test('flags NPC corporations by ID range', async () => {
    mocks.listCorporationHistory.mockResolvedValue([
      { corporation_id: 1_000_166, record_id: 2, start_date: '2024-01-01T00:00:00Z' },
      { corporation_id: 98_571_108, record_id: 1, start_date: '2020-01-01T00:00:00Z' },
    ])

    const history = await getCharacterEmploymentHistory(90_000_105)

    expect(history.map((entry) => entry.corporation.isNpc)).toEqual([true, false])
  })

  test('does not resolve names for empty history and reuses cached results', async () => {
    const first = await getCharacterEmploymentHistory(90_000_103)
    const second = await getCharacterEmploymentHistory(90_000_103)

    expect(first).toEqual([])
    expect(second).toBe(first)
    expect(mocks.listCorporationHistory).toHaveBeenCalledOnce()
    expect(mocks.resolveNames).not.toHaveBeenCalled()
  })

  test('chunks unusually large corporation ID sets', async () => {
    mocks.listCorporationHistory.mockResolvedValue(
      Array.from({ length: 501 }, (_, index) => ({
        corporation_id: index + 1,
        record_id: index + 1,
        start_date: new Date(index * 1_000).toISOString(),
      })),
    )

    await getCharacterEmploymentHistory(90_000_104)

    expect(mocks.resolveNames).toHaveBeenCalledTimes(2)
    expect(mocks.resolveNames.mock.calls[0]?.[0].body).toHaveLength(500)
    expect(mocks.resolveNames.mock.calls[1]?.[0].body).toEqual([501])
  })
})
