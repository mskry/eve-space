import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  callOperation: vi.fn(),
  executePublicRepresentation: vi.fn(),
  get: vi.fn(),
}))

vi.mock('@evespace/esi-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@evespace/esi-client')>()),
  EsiClient: class {
    callOperation(...arguments_: unknown[]) {
      return mocks.callOperation(...arguments_)
    }
  },
}))
vi.mock('../../src/esi-resilience/layer.js', () => ({
  getEsiResilienceLayer: () => ({
    executePublicRepresentation: mocks.executePublicRepresentation,
    getPublic: mocks.get,
  }),
}))
vi.mock('../../src/esi-resilience/request-transport.js', () => ({ createEsiTransport: vi.fn() }))
vi.mock('../../src/universe/resolution-cache.js', () => ({
  readUniverseNames: () => ({ fresh: new Map(), stale: new Map(), suppressed: new Set() }),
  writeUniverseNames: vi.fn(),
  suppressUniverseNameIds: vi.fn(),
}))

const employmentHistoryFixture = [
  { corporation_id: 2, record_id: 2, start_date: '2020-01-01T00:00:00Z' },
  { corporation_id: 1, record_id: 1, start_date: '2024-01-01T00:00:00Z' },
]
const resolvedNamesFixture = [
  { category: 'corporation', id: 2, name: 'Second Corporation' },
  { category: 'corporation', id: 1, name: 'First Corporation' },
]

beforeEach(() => {
  mocks.executePublicRepresentation.mockImplementation((_representation, resource) =>
    mocks.get(resource),
  )
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
  mocks.callOperation.mockImplementation((operationId: string) => {
    switch (operationId) {
      case 'GetCharactersCharacterIdCorporationhistory':
        return response(employmentHistoryFixture)
      case 'PostUniverseNames':
        return response(resolvedNamesFixture)
      default:
        throw new Error(`Unexpected operation ${operationId}`)
    }
  })
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
    mocks.callOperation.mockImplementation((operationId: string) => {
      if (operationId === 'PostUniverseNames')
        return Promise.reject(Object.assign(new Error('Unavailable'), { status: 503 }))
      return response(employmentHistoryFixture)
    })
    const { getCharacterEmploymentHistory } = await import('../../src/characters/history.js')

    await expect(getCharacterEmploymentHistory(90_000_101)).rejects.toMatchObject({ status: 503 })
  })
})

function response<Data>(data: Data) {
  return { data, meta: { headers: {} } }
}
