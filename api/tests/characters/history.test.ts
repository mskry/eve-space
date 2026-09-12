import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createFeatureExecutionMock } from '../support/mock-feature-execution.js'

const mocks = vi.hoisted(() => ({
  callOperation: vi.fn(),
  executeRepresentation: vi.fn(),
}))

vi.mock('../../src/esi-gateway/feature-execution.js', () =>
  createFeatureExecutionMock(mocks.executeRepresentation),
)
vi.mock('../../src/universe/resolution-cache.js', () => ({
  readUniverseNames: () => ({ fresh: new Map(), stale: new Map(), suppressed: new Set() }),
  writeUniverseNames: vi.fn(),
  suppressUniverseNameIds: vi.fn(),
}))

const employmentHistoryFixture = [
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
]

beforeEach(() => {
  mocks.executeRepresentation.mockResolvedValue(response(employmentHistoryFixture))
})

describe('character employment history service', () => {
  test('maps history using callable employment and name reads', async () => {
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
    expect(mocks.executeRepresentation.mock.calls[0]?.[0]).toMatchObject({
      operation: 'employment-history',
    })
  })

  test('does not produce cacheable unknown names after a transient resolution failure', async () => {
    mocks.executeRepresentation.mockRejectedValue(
      Object.assign(new Error('Unavailable'), { status: 503 }),
    )
    const { getCharacterEmploymentHistory } = await import('../../src/characters/history.js')

    await expect(getCharacterEmploymentHistory(90_000_101)).rejects.toMatchObject({ status: 503 })
  })
})

function response<Data>(data: Data) {
  return {
    data,
    cachedUntil: '2026-08-20T12:01:00.000Z',
    validatedAt: '',
    quota: {},
    source: 'esi' as const,
    stale: false,
  }
}
