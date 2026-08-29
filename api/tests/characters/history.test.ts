import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  listCorporationHistory: vi.fn(),
  resolveNames: vi.fn(),
}))

vi.mock('@evespace/esi-client/domains/character', () => ({
  createCharacterClient: () => ({
    withMetadata: () => ({ listCorporationHistory: mocks.listCorporationHistory }),
  }),
}))
vi.mock('@evespace/esi-client/domains/universe', () => ({
  createUniverseClient: () => ({ withMetadata: () => ({ resolveNames: mocks.resolveNames }) }),
}))
vi.mock('../../src/esi-resilience/resilience.js', () => ({
  getEsiResilienceLayer: () => ({ getPublic: mocks.get }),
}))
vi.mock('../../src/esi-resilience/transport.js', () => ({ createEsiTransport: vi.fn() }))

beforeEach(() => {
  mocks.get.mockImplementation(async (resource) => {
    const loaded = await resource.load({})
    return {
      data: loaded.data,
      cachedUntil: '2026-08-20T12:01:00.000Z',
      quota: {},
      source: 'esi',
      stale: false,
    }
  })
  mocks.listCorporationHistory.mockResolvedValue(
    response([
      { corporation_id: 2, record_id: 2, start_date: '2020-01-01T00:00:00Z' },
      { corporation_id: 1, record_id: 1, start_date: '2024-01-01T00:00:00Z' },
    ]),
  )
  mocks.resolveNames.mockResolvedValue(
    response([
      { category: 'corporation', id: 2, name: 'Second Corporation' },
      { category: 'corporation', id: 1, name: 'First Corporation' },
    ]),
  )
})

describe('character employment history service', () => {
  test('maps history using registered resilient employment and name resources', async () => {
    const { getCharacterEmploymentHistory } = await import('../../src/characters/history.js')

    await expect(getCharacterEmploymentHistory(90_000_101)).resolves.toEqual([
      {
        recordId: 2,
        startDate: '2020-01-01T00:00:00Z',
        isDeleted: false,
        corporation: { id: 2, name: 'Second Corporation', isNpc: true },
      },
      {
        recordId: 1,
        startDate: '2024-01-01T00:00:00Z',
        isDeleted: false,
        corporation: { id: 1, name: 'First Corporation', isNpc: true },
      },
    ])
    expect(mocks.get.mock.calls.map(([resource]) => resource.operation)).toEqual([
      'employment-history',
      'universe-resolve-names',
    ])
  })

  test('does not produce cacheable unknown names after a transient resolution failure', async () => {
    mocks.resolveNames.mockRejectedValueOnce(
      Object.assign(new Error('Unavailable'), { status: 503 }),
    )
    const { getCharacterEmploymentHistory } = await import('../../src/characters/history.js')

    await expect(getCharacterEmploymentHistory(90_000_101)).rejects.toMatchObject({ status: 503 })
  })
})

function response<Data>(data: Data) {
  return { data, meta: { headers: {} } }
}
