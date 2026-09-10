import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  callOperation: vi.fn(),
  executeRepresentation: vi.fn(),
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
  esiExecutionLayer: { executeRepresentation: mocks.executeRepresentation },
}))
vi.mock('../../src/universe/resolution-cache.js', () => ({
  readUniverseNames: () => ({ fresh: new Map(), stale: new Map(), suppressed: new Set() }),
  writeUniverseNames: vi.fn(),
  suppressUniverseNameIds: vi.fn(),
}))

import { executeRepresentationFixture } from '../support/execute-representation.js'

const employmentHistoryFixture = [
  { corporation_id: 2, record_id: 2, start_date: '2020-01-01T00:00:00Z' },
  { corporation_id: 1, record_id: 1, start_date: '2024-01-01T00:00:00Z' },
]
const resolvedNamesFixture = [
  { category: 'corporation', id: 2, name: 'Second Corporation' },
  { category: 'corporation', id: 1, name: 'First Corporation' },
]

beforeEach(() => {
  mocks.executeRepresentation.mockImplementation(async (representation, input) => ({
    ...(await executeRepresentationFixture(representation, input)),
    cachedUntil: '2026-08-20T12:01:00.000Z',
  }))
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
    expect(
      mocks.executeRepresentation.mock.calls.map(([representation]) => representation.operation),
    ).toEqual(['employment-history', 'universe-resolve-names'])
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
